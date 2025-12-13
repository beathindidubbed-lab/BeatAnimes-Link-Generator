// ============================================
// ULTIMATE TELEGRAM PERMANENT LINK BOT (V6 - WITH BATCH LINKS)
// INCLUDES: Small Caps Style, Multi-Channel Force Sub, Batch/Sequential Links,
//          Full Admin Panel, Streaming/Download Links, Copy Message Welcome
// ============================================

import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import fetch from 'node-fetch'; // Used for fetching files from Telegram URL

// ============================================
// CONFIGURATION & INITIALIZATION
// ============================================
// Ensure environment variables are set
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-app.onrender.com';
const PORT = process.env.PORT || 3000;

// Admin Configuration
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id)) : [];

// Welcome message settings
const WELCOME_SOURCE_CHANNEL = process.env.WELCOME_SOURCE_CHANNEL || null;
const WELCOME_SOURCE_MESSAGE_ID = process.env.WELCOME_SOURCE_MESSAGE_ID ? parseInt(process.env.WELCOME_SOURCE_MESSAGE_ID) : null;
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@YourChannel';
const ADMIN_CONTACT_USERNAME = process.env.ADMIN_CONTACT_USERNAME || 'YourAdmin';

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN is required! Please set the BOT_TOKEN environment variable.');
    process.exit(1);
}

// ============================================
// DATABASE & STATE (In-memory storage)
// ============================================
const FILE_DATABASE = new Map(); // Stores single files
const BATCH_DATABASE = new Map(); // Stores batch links
const USER_DATABASE = new Map();
const URL_CACHE = new Map();
const URL_CACHE_DURATION = 23 * 60 * 60 * 1000; // 23 hours
const USER_STATE = new Map(); // Tracks multi-step admin actions

// Global mutable config (Force Sub Channels)
const CONFIG_STATE = {
    FORCE_SUB_CHANNEL_IDS: process.env.MANDATORY_CHANNEL_IDS
        ? process.env.MANDATORY_CHANNEL_IDS.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
        : []
};

// Cache for channel details
const CHANNEL_DETAILS_CACHE = new Map();

// Analytics
const ANALYTICS = {
    totalViews: 0,
    totalDownloads: 0,
    totalFiles: 0,
    totalBatches: 0,
    totalUsers: 0,
    startTime: Date.now()
};

// ============================================
// TELEGRAM BOT INITIALIZATION
// ============================================
const bot = new TelegramBot(BOT_TOKEN, {
    polling: true
});

// Get bot info for later use
let BOT_INFO = null;
bot.getMe().then(info => {
    BOT_INFO = info;
    console.log(`✅ Bot started successfully! @${info.username} (ID: ${info.id})`);
}).catch(err => {
    console.error('❌ Failed to get bot info:', err);
});

// Set up bot commands
bot.setMyCommands([
    { command: 'start', description: 'Start the bot and open the main menu' },
    { command: 'stats', description: 'Check your usage statistics' },
    { command: 'files', description: 'View and manage your uploaded files' },
    { command: 'batch', description: 'Create batch/sequential links' },
    { command: 'admin', description: 'Open the admin control panel (Admins only)' },
]).then(() => console.log('✅ Telegram commands set.'));

// ============================================
// CORE UTILITY FUNCTIONS
// ============================================

function toSmallCaps(text) {
    const map = {
        'a': 'ᴀ', 'b': 'ʙ', 'c': 'ᴄ', 'd': 'ᴅ', 'e': 'ᴇ', 'f': 'ғ', 'g': 'ɢ', 'h': 'ʜ', 'i': 'ɪ',
        'j': 'ᴊ', 'k': 'ᴋ', 'l': 'ʟ', 'm': 'ᴍ', 'n': 'ɴ', 'o': 'ᴏ', 'p': 'ᴘ', 'q': 'ǫ', 'r': 'ʀ',
        's': 's', 't': 'ᴛ', 'u': 'ᴜ', 'v': 'ᴠ', 'w': 'ᴡ', 'x': 'x', 'y': 'ʏ', 'z': 'ᴢ',
        ' ': ' '
    };
    if (typeof text !== 'string') return text; // Handle non-string inputs gracefully
    return text.toLowerCase().split('').map(char => map[char] || char).join('');
}

function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

function registerUser(userId, username, firstName) {
    if (!USER_DATABASE.has(userId)) {
        USER_DATABASE.set(userId, {
            userId: userId,
            username: username || 'Unknown',
            firstName: firstName || 'User',
            joinedAt: Date.now(),
            totalUploads: 0,
            lastActive: Date.now(),
            isBlocked: false
        });
        ANALYTICS.totalUsers++;
    } else {
        const user = USER_DATABASE.get(userId);
        user.lastActive = Date.now();
    }
    return USER_DATABASE.get(userId);
}

function generateUniqueId() {
    // Generate a reasonably unique 26-character ID
    return Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15);
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    let parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours % 24 > 0) parts.push(`${hours % 24}h`);
    if (minutes % 60 > 0) parts.push(`${minutes % 60}m`);

    return parts.length > 0 ? parts.join(' ') : '<1m';
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getFreshFileUrl(fileData) {
    const cacheKey = fileData.fileId;
    const cached = URL_CACHE.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp) < URL_CACHE_DURATION) {
        return cached.url;
    }

    try {
        const fileInfo = await bot.getFile(fileData.fileId);
        if (!fileInfo.file_path) {
             throw new Error("File path is undefined, Telegram may have expired the file.");
        }
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;

        URL_CACHE.set(cacheKey, {
            url: fileUrl,
            timestamp: Date.now()
        });

        return fileUrl;
    } catch (error) {
        console.error('❌ Error getting file URL from Telegram:', error);
        URL_CACHE.delete(cacheKey);
        throw new Error('Failed to get file from Telegram API');
    }
}

// ============================================
// FORCE SUBSCRIPTION LOGIC
// ============================================

async function getChannelDetails(channelId) {
    if (CHANNEL_DETAILS_CACHE.has(channelId)) {
        return CHANNEL_DETAILS_CACHE.get(channelId);
    }
    try {
        const chatInfo = await bot.getChat(channelId);
        const username = chatInfo.username ? `@${chatInfo.username}` : null;
        const details = { title: chatInfo.title, username: username, id: channelId };
        CHANNEL_DETAILS_CACHE.set(channelId, details);
        return details;
    } catch (e) {
        console.error(`Error fetching chat details for ${channelId}: ${e.message}`);
        return { title: `Unknown Channel (${channelId})`, username: null, id: channelId, error: true };
    }
}

async function checkForceSubscription(userId) {
    if (CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.length === 0) {
        return { required: false, channels: [] };
    }

    const requiredChannels = [];
    let isSubscribed = true;

    for (const channelId of CONFIG_STATE.FORCE_SUB_CHANNEL_IDS) {
        try {
            const memberStatus = await bot.getChatMember(channelId, userId);
            const status = memberStatus.status;

            if (status !== 'member' && status !== 'administrator' && status !== 'creator') {
                const details = await getChannelDetails(channelId);
                requiredChannels.push(details);
                isSubscribed = false;
            }
        } catch (e) {
            console.error(`Error checking sub for ${channelId}: ${e.message}`);
            // If the bot isn't an admin/member, this throws an error. We treat this as "required" but may be unjoinable.
            const details = await getChannelDetails(channelId);
            requiredChannels.push(details);
            isSubscribed = false;
        }
    }

    return { required: !isSubscribed, channels: requiredChannels };
}

async function forceSubRequired(msg, action) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;

    if (isAdmin(userId)) {
        return action();
    }

    const subCheck = await checkForceSubscription(userId);

    if (subCheck.required) {
        const channelList = subCheck.channels.map((c, i) =>
            `${i + 1}. **${toSmallCaps(c.title)}** ${c.username ? `(${c.username})` : toSmallCaps('(Private)')}`
        ).join('\n');

        const inlineKeyboard = subCheck.channels.map(c => ([
            { text: toSmallCaps(`🔗 Join ${c.title.substring(0, 20)}...`), url: c.username ? `https://t.me/${c.username.substring(1)}` : `https://t.me/${CHANNEL_USERNAME.substring(1)}` }
        ]));

        inlineKeyboard.push([{ text: toSmallCaps('🔄 I have joined!'), callback_data: 'check_sub' }]);

        await bot.sendMessage(chatId,
            `⚠️ <b>${toSmallCaps('Subscription Required')}</b>\n\n` +
            `${toSmallCaps('Please join the following channels to use the bot:')}\n\n` +
            channelList,
            {
                parse_mode: 'HTML',
                reply_to_message_id: msg.message_id,
                reply_markup: {
                    inline_keyboard: inlineKeyboard
                }
            }
        );
    } else {
        return action();
    }
}

// ============================================
// KEYBOARD & MESSAGE HELPERS
// ============================================

function getMainMenuKeyboard(userId) {
    const keyboard = [
        [{ text: toSmallCaps('📁 My Files'), callback_data: 'my_files' }, { text: toSmallCaps('📦 Create Batch'), callback_data: 'create_batch' }],
        [{ text: toSmallCaps('📊 Stats'), callback_data: 'my_stats' }, { text: toSmallCaps('❓ Help'), callback_data: 'help' }],
    ];
    if (isAdmin(userId)) {
        keyboard.push([{ text: toSmallCaps('👑 Admin Panel'), callback_data: 'admin_panel' }]);
    }
    return { inline_keyboard: keyboard };
}

function getAdminKeyboard() {
    return {
        inline_keyboard: [
            [{ text: toSmallCaps('📊 Global Stats'), callback_data: 'admin_stats' }],
            [{ text: toSmallCaps('🔗 Mandatory Channels'), callback_data: 'admin_list_channels' }],
            [{ text: toSmallCaps('📢 Broadcast Message'), callback_data: 'admin_broadcast_start' }],
            [{ text: toSmallCaps('🗑️ Clean URL Cache'), callback_data: 'admin_clean' }],
            [{ text: toSmallCaps('🔙 Back to Main Menu'), callback_data: 'start' }]
        ]
    };
}

async function editMessage(text, replyMarkup = {}, preventNotFound = false) {
    const { chatId, messageId } = replyMarkup;
    try {
        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: replyMarkup.inline_keyboard ? replyMarkup : undefined,
            parse_mode: 'HTML'
        });
    } catch (e) {
        if (preventNotFound && e.message.includes('message is not modified')) {
            // Ignore if the message content hasn't changed
            return;
        }
        if (preventNotFound && (e.message.includes('message to edit not found') || e.message.includes('message can\'t be edited'))) {
            // Ignore if the message was deleted or can't be edited
            return;
        }
        console.error('Error editing message:', e.message);
    }
}


// ============================================
// COMMAND HANDLERS
// ============================================

bot.onText(/\/start (.+)/, async (msg, match) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const payload = match[1];

    registerUser(userId, msg.from.username, msg.from.first_name);

    const action = async () => {
        const parts = payload.split('_');
        const type = parts[0];
        const uniqueId = parts[1];
        let fileData, batchData;
        let responseText = ``;
        let keyboard = [[{ text: toSmallCaps('🔙 Main Menu'), callback_data: 'start' }]];

        if (type === 'file') {
            fileData = FILE_DATABASE.get(uniqueId);
            if (!fileData) {
                responseText = `❌ <b>${toSmallCaps('File Not Found')}</b>\n\n${toSmallCaps('The requested file link is invalid or has expired.')}`;
            } else {
                ANALYTICS.totalViews++;
                fileData.views++;
                fileData.lastAccessed = Date.now();

                const streamLink = `${WEBAPP_URL}/stream/${uniqueId}`;
                const downloadLink = `${WEBAPP_URL}/download/${uniqueId}`;

                responseText = `
✅ <b>${toSmallCaps('File Details')}</b>

📁 <b>${toSmallCaps('Name')}:</b> ${fileData.fileName}
💾 <b>${toSmallCaps('Size')}:</b> ${formatFileSize(fileData.fileSize)}
👁️ <b>${toSmallCaps('Views')}:</b> ${fileData.views}

${toSmallCaps('Use the buttons below to access the file.')}
                `;
                keyboard = [
                    [{ text: toSmallCaps('📺 Stream'), url: streamLink }, { text: toSmallCaps('⬇️ Download'), url: downloadLink }],
                    [{ text: toSmallCaps('🔙 Main Menu'), callback_data: 'start' }]
                ];
            }

        } else if (type === 'batch' || type === 'forward' || type === 'sequential' || type === 'custom') {
            batchData = BATCH_DATABASE.get(uniqueId);
            if (!batchData) {
                responseText = `❌ <b>${toSmallCaps('Batch Not Found')}</b>\n\n${toSmallCaps('The requested batch link is invalid or has expired.')}`;
            } else {
                ANALYTICS.totalViews++;
                batchData.views++;
                batchData.lastAccessed = Date.now();

                const typeLabel = (type === 'forward' || type === 'single_forward') ? 'Single Forward' : (type === 'sequential') ? 'Sequential' : 'Custom';
                const fileCount = batchData.messageIds.length;

                // Send the files/messages
                for (let i = 0; i < batchData.messageIds.length; i++) {
                    const messageId = batchData.messageIds[i];
                    try {
                        await bot.copyMessage(chatId, batchData.fromChatId, messageId);
                        await sleep(500); // Telegram API rate limit mitigation
                    } catch (e) {
                        console.error(`Failed to copy message ${messageId}: ${e.message}`);
                    }
                }

                responseText = `
✅ <b>${toSmallCaps('Batch Sent!')}</b>

📦 <b>${toSmallCaps('Type')}:</b> ${toSmallCaps(typeLabel)}
📋 <b>${toSmallCaps('Messages')}:</b> ${fileCount}

${toSmallCaps('The files/messages have been sent to you above.')}
                `;
            }
        } else {
            responseText = `❌ <b>${toSmallCaps('Invalid Link Type')}</b>`;
        }

        await bot.sendMessage(chatId, responseText, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: keyboard }
        });
    };

    await forceSubRequired(msg, action);
});

bot.onText(/\/start|\/admin|\/stats|\/files|\/batch/, async (msg, match) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const command = match[0];
    registerUser(userId, msg.from.username, msg.from.first_name);

    const action = async () => {
        if (command === '/admin' && !isAdmin(userId)) {
            return bot.sendMessage(chatId, `❌ ${toSmallCaps('Unauthorized.')}`);
        }

        let welcomeMessage = `
👋 <b>${toSmallCaps('Welcome to Link Generator!')}</b>

${toSmallCaps('I can help you create permanent, direct streaming and batch links for your Telegram files.')}

<b>${toSmallCaps('How to use')}:</b>
1️⃣ ${toSmallCaps('Send me a file (Video, Doc, Photo).')}
2️⃣ ${toSmallCaps('I send you a permanent link.')}

${toSmallCaps('Use the menu below to explore features.')}
        `;

        // Check for Copy Message Welcome Source
        if (WELCOME_SOURCE_CHANNEL && WELCOME_SOURCE_MESSAGE_ID) {
            try {
                await bot.copyMessage(chatId, WELCOME_SOURCE_CHANNEL, WELCOME_SOURCE_MESSAGE_ID);
                welcomeMessage = `
👋 <b>${toSmallCaps('Welcome to Link Generator!')}</b>
${toSmallCaps('The welcome message has been sent above. Use the menu below to explore features.')}
                `;
            } catch (e) {
                console.error('Error copying welcome message:', e.message);
                // Fallback to default message
            }
        }

        if (command === '/admin' && isAdmin(userId)) {
            await bot.sendMessage(chatId, `👑 <b>${toSmallCaps('Admin Panel')}</b>\n\n${toSmallCaps('Welcome Admin! Choose an option below')}:`, { parse_mode: 'HTML', reply_markup: getAdminKeyboard() });
        } else if (command === '/stats') {
            // Re-use logic from callback query
            const userData = USER_DATABASE.get(userId);
            const statsText = `
📊 <b>${toSmallCaps('Your Statistics')}</b>

👤 <b>${toSmallCaps('Joined')}:</b> ${formatDate(userData.joinedAt)}
📤 <b>${toSmallCaps('Total Uploads')}:</b> ${userData.totalUploads}
📄 <b>${toSmallCaps('Active Files')}:</b> ${Array.from(FILE_DATABASE.values()).filter(f => f.uploadedBy === userId).length}
📦 <b>${toSmallCaps('Active Batches')}:</b> ${Array.from(BATCH_DATABASE.values()).filter(b => b.createdBy === userId).length}

${toSmallCaps('Keep generating links!')}
        `;
            await bot.sendMessage(chatId, statsText, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: toSmallCaps('🔙 Back'), callback_data: 'start' }]] } });

        } else if (command === '/files' || command === '/batch') {
            // Force /files or /batch logic via callback
            const data = command === '/files' ? 'my_files' : 'create_batch';
            await handleCallbackQuery({ id: 'dummy', from: { id: userId }, message: { chat: { id: chatId }, message_id: msg.message_id + 1 } }, data);
        } else {
            await bot.sendMessage(chatId, welcomeMessage, {
                parse_mode: 'HTML',
                reply_markup: getMainMenuKeyboard(userId)
            });
        }
    };

    if (command !== '/admin') {
        await forceSubRequired(msg, action);
    } else {
        await action();
    }
});


// ============================================
// CALLBACK QUERY HANDLER
// ============================================

bot.on('callback_query', async (query) => {
    const data = query.data;
    const userId = query.from.id;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    const editMessage = async (text, replyMarkup = {}) => {
        try {
            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: replyMarkup.inline_keyboard ? replyMarkup : undefined,
                parse_mode: 'HTML'
            });
        } catch (e) {
            // Ignore "message is not modified" or "message to edit not found" errors
            if (!e.message.includes('message is not modified') && !e.message.includes('message to edit not found')) {
                console.error('Error editing message in callback:', e.message);
            }
        }
    };

    if (data === 'check_sub') {
        const subCheck = await checkForceSubscription(userId);

        if (!subCheck.required) {
            await editMessage(
                `✅ <b>${toSmallCaps('Subscription Confirmed!')}</b>\n\n${toSmallCaps('Thank you for joining. You can now use the bot features.')}`,
                getMainMenuKeyboard(userId)
            );
        } else {
            const channelList = subCheck.channels.map((c, i) =>
                `${i + 1}. **${toSmallCaps(c.title)}** ${c.username ? `(${c.username})` : toSmallCaps('(Private)')}`
            ).join('\n');

            const inlineKeyboard = subCheck.channels.map(c => ([
                { text: toSmallCaps(`🔗 Join ${c.title.substring(0, 20)}...`), url: c.username ? `https://t.me/${c.username.substring(1)}` : `https://t.me/${CHANNEL_USERNAME.substring(1)}` }
            ]));

            inlineKeyboard.push([{ text: toSmallCaps('🔄 I have joined!'), callback_data: 'check_sub' }]);

            await editMessage(
                `⚠️ <b>${toSmallCaps('Subscription Required')}</b>\n\n${toSmallCaps('Please join the following channels to use the bot:')}\n\n` + channelList,
                { inline_keyboard: inlineKeyboard }
            );
        }
    }

    else if (data === 'start') {
        let welcomeMessage = `
👋 <b>${toSmallCaps('Welcome to Link Generator!')}</b>

${toSmallCaps('I can help you create permanent, direct streaming and batch links for your Telegram files.')}

<b>${toSmallCaps('How to use')}:</b>
1️⃣ ${toSmallCaps('Send me a file (Video, Doc, Photo).')}
2️⃣ ${toSmallCaps('I send you a permanent link.')}

${toSmallCaps('Use the menu below to explore features.')}
        `;
        await editMessage(welcomeMessage, getMainMenuKeyboard(userId));
    }

    else if (data === 'my_stats') {
        const userData = USER_DATABASE.get(userId);
        const statsText = `
📊 <b>${toSmallCaps('Your Statistics')}</b>

👤 <b>${toSmallCaps('Joined')}:</b> ${formatDate(userData.joinedAt)}
📤 <b>${toSmallCaps('Total Uploads')}:</b> ${userData.totalUploads}
📄 <b>${toSmallCaps('Active Files')}:</b> ${Array.from(FILE_DATABASE.values()).filter(f => f.uploadedBy === userId).length}
📦 <b>${toSmallCaps('Active Batches')}:</b> ${Array.from(BATCH_DATABASE.values()).filter(b => b.createdBy === userId).length}

${toSmallCaps('Keep generating links!')}
        `;
        await editMessage(statsText, { inline_keyboard: [[{ text: toSmallCaps('🔙 Back'), callback_data: 'start' }]] });
    }

    else if (data === 'my_files') {
        const userFiles = Array.from(FILE_DATABASE.values())
            .filter(f => f.uploadedBy === userId)
            .sort((a, b) => b.createdAt - a.createdAt) // Sort newest first
            .slice(0, 10); // Show only the latest 10

        let fileList = '';
        let count = Array.from(FILE_DATABASE.values()).filter(f => f.uploadedBy === userId).length;
        const buttons = [];

        if (userFiles.length > 0) {
            for (let i = 0; i < userFiles.length; i++) {
                const file = userFiles[i];
                const link = `${WEBAPP_URL}/file/${file.uniqueId}`;
                fileList += `${i + 1}. **${toSmallCaps(file.fileName.substring(0, 40))}**\n`;
                fileList += `   💾 ${formatFileSize(file.fileSize)} | 👁️ ${file.views} ${toSmallCaps('views')}\n`;
                fileList += `   🔗 ${toSmallCaps('ID')}: <code>${file.uniqueId}</code>\n\n`;

                buttons.push([{ text: toSmallCaps(`🔗 ${file.fileName.substring(0, 25)}...`), url: link }]);
            }
        }

        let fileHeader = `📁 <b>${toSmallCaps('Your 10 Latest Files')}</b>\n\n`;

        if (count === 0) {
            fileList = toSmallCaps('📭 You haven\'t uploaded any files yet. Send me a file to get started!');
        } else if (count > 10) {
            fileHeader += `\n<i>${toSmallCaps('Showing 10 of')} ${count} ${toSmallCaps('files')}</i>\n\n`;
        }

        await editMessage(fileHeader + fileList, { inline_keyboard: [...buttons, [{ text: toSmallCaps('🔙 Back'), callback_data: 'start' }]] });
    }

    else if (data === 'my_batches') {
        const userBatches = Array.from(BATCH_DATABASE.values())
            .filter(b => b.createdBy === userId)
            .sort((a, b) => b.createdAt - a.createdAt) // Sort newest first
            .slice(0, 10); // Show only the latest 10

        let batchList = `📦 <b>${toSmallCaps('Your 10 Latest Batches')}</b>\n\n`;
        let count = Array.from(BATCH_DATABASE.values()).filter(b => b.createdBy === userId).length;
        const buttons = [];

        if (userBatches.length > 0) {
            let listCount = 0;
            for (const batch of userBatches) {
                listCount++;
                const id = batch.uniqueId;
                const typeLabel = batch.type === 'single_forward' ? 'Forward' : 'Sequential'; // Simplified label
                batchList += `${listCount}. ${typeLabel} ${toSmallCaps('Batch')}\n`;
                batchList += `   📋 ${batch.messageIds.length} ${toSmallCaps('files')} | 👁️ ${batch.views} ${toSmallCaps('views')}\n`;
                batchList += `   🔗 ${toSmallCaps('ID')}: <code>${id}</code>\n\n`;

                buttons.push([{ text: toSmallCaps(`📦 ${typeLabel} (${batch.messageIds.length} files)`), url: `${WEBAPP_URL}/batch/${id}` }]);
            }
        }

        if (count === 0) {
            batchList = toSmallCaps('📭 You haven\'t created any batches yet. Use "Create Batch" to get started!');
        } else if (count > 10) {
            batchList += `\n<i>${toSmallCaps('Showing 10 of')} ${count} ${toSmallCaps('batches')}</i>`;
        }

        buttons.push([{ text: toSmallCaps('🔙 Back'), callback_data: 'start' }]);

        await editMessage(batchList, { inline_keyboard: buttons }, true);
    }

    else if (data === 'create_batch') {
        const helpText = `
📦 <b>${toSmallCaps('Create Batch Link')}</b>

${toSmallCaps('Forward messages from any channel to me, then I\'ll create a batch link.')}

<b>${toSmallCaps('How it works')}:</b>
1️⃣ ${toSmallCaps('Forward messages from a channel')}
2️⃣ ${toSmallCaps('I\'ll detect and group them')}
3️⃣ ${toSmallCaps('Get a permanent batch link')}

<b>${toSmallCaps('Types')}:</b>
• <b>${toSmallCaps('Single Forward')}:</b> ${toSmallCaps('One message')}
• <b>${toSmallCaps('Sequential Batch')}:</b> ${toSmallCaps('Multiple messages in order')}
• <b>${toSmallCaps('Custom Batch')}:</b> ${toSmallCaps('Selected messages')}

${toSmallCaps('Start by forwarding messages now!')}
        `;

        await editMessage(helpText, { inline_keyboard: [[{ text: toSmallCaps('🔙 Back'), callback_data: 'start' }]] });
    }

    else if (data === 'help') {
        const helpText = `
📖 <b>${toSmallCaps('How to Use')}</b>

<b>${toSmallCaps('Single File Links')}:</b>
${toSmallCaps('Send me any video, document, or photo file and I\'ll generate a permanent streaming/download link.')}

<b>${toSmallCaps('Batch Links')}:</b>
${toSmallCaps('Forward messages from channels to create batch links that send multiple files at once.')}

<b>${toSmallCaps('Features')}:</b>
✅ ${toSmallCaps('Permanent links that never expire')}
✅ ${toSmallCaps('Direct streaming with seeking support')}
✅ ${toSmallCaps('Batch/Sequential forwarding')}
✅ ${toSmallCaps('Analytics and tracking')}

<b>💡 ${toSmallCaps('Commands')}:</b>
• /files - ${toSmallCaps('View your uploaded files')}
• /batch - ${toSmallCaps('Create batch links')}
• /stats - ${toSmallCaps('View your statistics')}
        `;

        await editMessage(helpText, { inline_keyboard: [[{ text: toSmallCaps('🔙 Back'), callback_data: 'start' }]] });
    }

    // Admin handlers
    else if (data === 'admin_panel' && isAdmin(userId)) {
        await editMessage(`👑 <b>${toSmallCaps('Admin Panel')}</b>\n\n${toSmallCaps('Welcome Admin! Choose an option below')}:`, getAdminKeyboard());
    }

    else if (data === 'admin_stats' && isAdmin(userId)) {
        const uptime = formatDuration(Date.now() - ANALYTICS.startTime);
        const cacheSize = URL_CACHE.size;

        const statsText = `
📊 <b>${toSmallCaps('Bot Global Statistics')}</b>

⚙️ <b>${toSmallCaps('Uptime')}:</b> ${uptime}
👥 <b>${toSmallCaps('Total Users')}:</b> ${USER_DATABASE.size}
📁 <b>${toSmallCaps('Total Files')}:</b> ${FILE_DATABASE.size}
📦 <b>${toSmallCaps('Total Batches')}:</b> ${BATCH_DATABASE.size}
👁️ <b>${toSmallCaps('Total Views')}:</b> ${ANALYTICS.totalViews}
⬇️ <b>${toSmallCaps('Total Downloads')}:</b> ${ANALYTICS.totalDownloads}
🧹 <b>${toSmallCaps('Active URL Cache')}:</b> ${cacheSize}

${toSmallCaps('Channels configured')}: ${CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.length}
        `;

        await editMessage(statsText, { inline_keyboard: [[{ text: toSmallCaps('🔙 Back'), callback_data: 'admin_panel' }]] });
    }

    else if (data === 'admin_list_channels' && isAdmin(userId)) {
        const channelDetails = await Promise.all(CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.map(id => getChannelDetails(id)));

        const listText = `🔗 **${toSmallCaps('Mandatory Channels')}**\n\n` + (channelDetails.length > 0 ? channelDetails.map((d, i) =>
            `${i + 1}. **${toSmallCaps(d.title)}**\n   ${toSmallCaps('ID')}: <code>${d.id}</code>\n   ${toSmallCaps('Username')}: ${d.username || toSmallCaps('N/A (Private)')}${d.error ? `\n   ⚠️ ${toSmallCaps('Bot is not admin/member.')}` : ''}`
        ).join('\n\n') : toSmallCaps('No channels are currently configured.'));

        const keyboard = {
            inline_keyboard: [
                ...channelDetails.map(d => ([{ text: toSmallCaps(`❌ Remove ${d.title.substring(0, 15)}...`), callback_data: `admin_remove_channel_${d.id}` }])),
                [{ text: toSmallCaps('➕ Add Channel'), callback_data: 'admin_add_channel_prompt' }],
                [{ text: toSmallCaps('🔙 Back'), callback_data: 'admin_panel' }]
            ]
        };

        await editMessage(listText, keyboard);
    }

    else if (data === 'admin_add_channel_prompt' && isAdmin(userId)) {
        await editMessage(`🔗 **${toSmallCaps('Add Mandatory Join Channel')}**\n\n${toSmallCaps('Select a method to add the channel.')}`, {
            inline_keyboard: [
                [{ text: toSmallCaps('1. ➡️ Forward a Message'), callback_data: 'admin_add_channel_forward' }],
                [{ text: toSmallCaps('2. 🆔 Send ID/Username'), callback_data: 'admin_add_channel_id' }],
                [{ text: toSmallCaps('❌ Cancel'), callback_data: 'admin_panel' }]
            ]
        });
    }

    else if (data === 'admin_add_channel_forward' && isAdmin(userId)) {
        USER_STATE.set(userId, { state: 'ADDING_JOIN_CHANNEL_FORWARD' });
        await editMessage(`➡️ **${toSmallCaps('Forward a Message')}**\n\n${toSmallCaps('Please forward ANY message from the channel you want to add to this chat now.')}`, {
            inline_keyboard: [[{ text: toSmallCaps('❌ Cancel'), callback_data: 'admin_panel' }]]
        });
    }

    else if (data === 'admin_add_channel_id' && isAdmin(userId)) {
        USER_STATE.set(userId, { state: 'ADDING_JOIN_CHANNEL_ID' });
        await editMessage(`🆔 **${toSmallCaps('Send ID/Username')}**\n\n${toSmallCaps('Send the Channel ID (e.g.,')} \`-100XXXXXXXXXX\` ${toSmallCaps(') or Channel Username (e.g.,')} \`@mychannel\`).`, {
            inline_keyboard: [[{ text: toSmallCaps('❌ Cancel'), callback_data: 'admin_panel' }]]
        });
    }

    else if (data.startsWith('admin_remove_channel_') && isAdmin(userId)) {
        const channelIdToRemove = parseInt(data.substring(21));
        CONFIG_STATE.FORCE_SUB_CHANNEL_IDS = CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.filter(id => id !== channelIdToRemove);
        CHANNEL_DETAILS_CACHE.delete(channelIdToRemove);

        await bot.answerCallbackQuery(query.id, { text: toSmallCaps('✅ Channel removed successfully!'), show_alert: true });
        await editMessage(`🔗 **${toSmallCaps('Channel Removed')}**\n\n${toSmallCaps('Channel ID')} <code>${channelIdToRemove}</code> ${toSmallCaps('is no longer mandatory.')}`, {
            inline_keyboard: [[{ text: toSmallCaps('🔙 Back to Channel List'), callback_data: 'admin_list_channels' }]]
        });
    }

    else if (data === 'admin_broadcast_start' && isAdmin(userId)) {
        USER_STATE.set(userId, { state: 'AWAITING_BROADCAST_MESSAGE' });
        await editMessage(`📢 <b>${toSmallCaps('Universal Broadcast')}</b>\n\n${toSmallCaps('Please send the message (text, photo, video, etc.) you want to broadcast to all')} ${USER_DATABASE.size} ${toSmallCaps('users.')}`, {
            inline_keyboard: [[{ text: toSmallCaps('❌ Cancel'), callback_data: 'admin_panel' }]]
        });
    }

    else if (data === 'admin_clean' && isAdmin(userId)) {
        const cleanedCount = URL_CACHE.size;
        URL_CACHE.clear();

        await bot.answerCallbackQuery(query.id, { text: toSmallCaps(`✅ Cleaned ${cleanedCount} cached URLs.`), show_alert: true });
        await editMessage(`🗑️ <b>${toSmallCaps('Cache Cleanup Complete')}</b>\n\n${toSmallCaps('Successfully cleared all')} ${cleanedCount} ${toSmallCaps('temporary file URLs.')}`, {
            inline_keyboard: [[{ text: toSmallCaps('🔙 Back'), callback_data: 'admin_panel' }]]
        });
    }

    else if (data.startsWith('admin_broadcast_confirm_') && isAdmin(userId)) {
        const broadcastType = data.substring(24);
        const state = USER_STATE.get(userId);
        if (!state || !state.broadcastMsg) {
            return bot.answerCallbackQuery(query.id, { text: toSmallCaps('❌ Broadcast data expired.'), show_alert: true });
        }

        await editMessage(`🚀 <b>${toSmallCaps('Starting Broadcast...')}</b>\n\n${toSmallCaps('This may take some time.')}`, null);

        const broadcastMsg = state.broadcastMsg;
        let successCount = 0;
        let blockCount = 0;
        // Filter out users marked as blocked before broadcasting
        const targetUsers = Array.from(USER_DATABASE.keys()).filter(id => !USER_DATABASE.get(id).isBlocked);

        for (const targetId of targetUsers) {
            if (isAdmin(targetId) && targetId === userId) continue;

            try {
                if (broadcastType === 'text') {
                    await bot.sendMessage(targetId, broadcastMsg.text, { parse_mode: 'HTML' });
                } else if (broadcastType === 'photo') {
                    await bot.sendPhoto(targetId, broadcastMsg.fileId, { caption: broadcastMsg.caption, parse_mode: 'HTML' });
                } else if (broadcastType === 'video') {
                    await bot.sendVideo(targetId, broadcastMsg.fileId, { caption: broadcastMsg.caption, parse_mode: 'HTML' });
                }

                successCount++;
            } catch (error) {
                // Check for 403 Forbidden (bot blocked by user)
                if (error.response && error.response.statusCode === 403) {
                    USER_DATABASE.get(targetId).isBlocked = true;
                    blockCount++;
                } else {
                    console.error(`Broadcast failed for user ${targetId}: ${error.message}`);
                }
            }
            await sleep(50); // Rate limit to 20 messages per second (20*50ms = 1 second)
        }

        USER_STATE.delete(userId);

        // Send results back to admin
        await bot.sendMessage(chatId, `
✅ <b>${toSmallCaps('Broadcast Complete!')}</b>

🟢 ${toSmallCaps('Successful')}: ${successCount}
🔴 ${toSmallCaps('Blocked')}: ${blockCount}
        `, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: toSmallCaps('🔙 Admin'), callback_data: 'admin_panel' }]] }
        });
    }

    await bot.answerCallbackQuery(query.id);
});

// ============================================
// MESSAGE HANDLER
// ============================================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const firstName = msg.from.first_name;

    registerUser(userId, username, firstName);

    // If the message is a command, skip the rest of the message handlers
    if (msg.text && msg.text.startsWith('/')) return;


    // Helper for admins: Displays forwarded message details
    if (isAdmin(userId) && msg.forward_from_chat) {
        const messageId = msg.forward_from_message_id; // Using `forward_from_message_id` which is reliable
        const channelId = msg.forward_from_chat.id;
        const channelUsername = msg.forward_from_chat.username ? `@${msg.forward_from_chat.username}` : null;

        await bot.sendMessage(chatId, `📨 <b>${toSmallCaps('Forwarded Message Details')}:</b>\n\n` +
            `<b>${toSmallCaps('Message ID')}:</b> <code>${messageId}</code>\n` +
            `<b>${toSmallCaps('Channel ID')}:</b> <code>${channelId}</code>\n` +
            `<b>${toSmallCaps('Channel Username')}:</b> ${channelUsername || toSmallCaps('N/A')}\n\n` +
            `${toSmallCaps('For .env')}:\n` +
            `WELCOME_SOURCE_MESSAGE_ID=${messageId}\n` +
            `WELCOME_SOURCE_CHANNEL=${channelId}`, {
            parse_mode: 'HTML'
        });
    }

    // Admin: Adding channel (forward)
    if (isAdmin(userId) && USER_STATE.has(userId) && USER_STATE.get(userId).state === 'ADDING_JOIN_CHANNEL_FORWARD') {
        USER_STATE.delete(userId);

        if (msg.forward_from_chat && (msg.forward_from_chat.type === 'channel' || msg.forward_from_chat.type === 'supergroup')) {
            const newId = msg.forward_from_chat.id;

            if (CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.includes(newId)) {
                return bot.sendMessage(chatId, `❌ ${toSmallCaps('Channel already added.')}`, { parse_mode: 'HTML' });
            }

            try {
                const chatInfo = await bot.getChat(newId);
                const botMember = await bot.getChatMember(newId, BOT_INFO.id);

                if (botMember.status === 'left' || botMember.status === 'kicked') {
                    return bot.sendMessage(chatId, `❌ ${toSmallCaps('Bot must be admin/member in the channel.')}`, { parse_mode: 'HTML' });
                }

                CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.push(newId);
                CHANNEL_DETAILS_CACHE.set(newId, { title: chatInfo.title, username: chatInfo.username ? `@${chatInfo.username}` : null, id: newId });

                return bot.sendMessage(chatId, `✅ <b>${toSmallCaps('Channel Added!')}</b>\n\n${toSmallCaps('Channel')}: **${chatInfo.title}**\n${toSmallCaps('ID')}: <code>${newId}</code>`, { parse_mode: 'HTML' });
            } catch (e) {
                return bot.sendMessage(chatId, `❌ <b>${toSmallCaps('Error:')}</b> ${toSmallCaps(e.message)}`, { parse_mode: 'HTML' });
            }

        } else {
            return bot.sendMessage(chatId, `❌ ${toSmallCaps('Please forward a message from a channel/supergroup.')}`, { parse_mode: 'HTML' });
        }
    }

    // Admin: Adding channel (ID)
    if (isAdmin(userId) && USER_STATE.has(userId) && USER_STATE.get(userId).state === 'ADDING_JOIN_CHANNEL_ID' && msg.text) {
        USER_STATE.delete(userId);
        let targetIdentifier = msg.text.trim();
        // Telegram channel IDs are usually negative and start with -100
        let isId = targetIdentifier.startsWith('-100') && !isNaN(parseInt(targetIdentifier));
        let targetId = isId ? parseInt(targetIdentifier) : targetIdentifier;

        try {
            const chatInfo = await bot.getChat(targetId);
            const actualId = chatInfo.id;

            if (CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.includes(actualId)) {
                return bot.sendMessage(chatId, `❌ ${toSmallCaps('Channel already added.')}`, { parse_mode: 'HTML' });
            }

            if (chatInfo.type === 'channel' || chatInfo.type === 'supergroup') {
                const botMember = await bot.getChatMember(actualId, BOT_INFO.id);
                if (botMember.status === 'left' || botMember.status === 'kicked') {
                    return bot.sendMessage(chatId, `❌ ${toSmallCaps('Bot must be admin/member in the channel.')}`, { parse_mode: 'HTML' });
                }

                CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.push(actualId);
                CHANNEL_DETAILS_CACHE.set(actualId, { title: chatInfo.title, username: chatInfo.username ? `@${chatInfo.username}` : null, id: actualId });

                await bot.sendMessage(chatId, `✅ <b>${toSmallCaps('Channel Added!')}</b>\n\n${toSmallCaps('Channel')}: **${chatInfo.title}**\n${toSmallCaps('ID')}: <code>${actualId}</code>`, { parse_mode: 'HTML' });
            } else {
                return bot.sendMessage(chatId, `❌ ${toSmallCaps('The provided ID/Username must belong to a channel or supergroup.')}`, { parse_mode: 'HTML' });
            }
        } catch (e) {
            return bot.sendMessage(chatId, `❌ <b>${toSmallCaps('Not found/Error:')}</b> ${toSmallCaps(e.message)}`, { parse_mode: 'HTML' });
        }
        return;
    }

    // Admin: Broadcast
    if (isAdmin(userId) && USER_STATE.has(userId) && USER_STATE.get(userId).state === 'AWAITING_BROADCAST_MESSAGE') {
        let broadcastMsg = {};
        let type;

        if (msg.text) {
            broadcastMsg = { text: msg.text };
            type = 'text';
        } else if (msg.photo) {
            broadcastMsg = { fileId: msg.photo[msg.photo.length - 1].file_id, caption: msg.caption || '' };
            type = 'photo';
        } else if (msg.video) {
            broadcastMsg = { fileId: msg.video.file_id, caption: msg.caption || '' };
            type = 'video';
        } else {
            return bot.sendMessage(chatId, toSmallCaps('⚠️ Text, photo, or video only.'));
        }

        USER_STATE.set(userId, { state: 'CONFIRMING_BROADCAST', broadcastMsg });

        await bot.sendMessage(chatId, `⚠️ ${toSmallCaps('Confirm broadcast to')} ${USER_DATABASE.size} ${toSmallCaps('users?')}`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: toSmallCaps('✅ CONFIRM'), callback_data: `admin_broadcast_confirm_${type}` }],
                    [{ text: toSmallCaps('❌ Cancel'), callback_data: 'admin_panel' }]
                ]
            }
        });
        return;
    }

    // Handle forwarded messages (batch creation)
    if (msg.forward_from_chat) {
        const fromChatId = msg.forward_from_chat.id;
        // Use forward_from_message_id as it's the specific message ID in the source chat
        const forwardedMessageId = msg.forward_from_message_id;

        const action = async () => {
            const uniqueId = generateUniqueId();

            // For now, create a single forward batch
            BATCH_DATABASE.set(uniqueId, {
                uniqueId,
                type: 'single_forward',
                fromChatId,
                messageIds: [forwardedMessageId],
                createdBy: userId,
                createdAt: Date.now(),
                views: 0,
                lastAccessed: Date.now()
            });

            ANALYTICS.totalBatches++;

            const batchLink = `${WEBAPP_URL}/batch/${uniqueId}`;

            await bot.sendMessage(chatId, `
✅ <b>${toSmallCaps('Batch Link Created!')}</b>

📦 <b>${toSmallCaps('Type')}:</b> ${toSmallCaps('Single Forward')}
📋 <b>${toSmallCaps('Files')}:</b> 1

🔗 <b>${toSmallCaps('Link')}:</b>
<code>${batchLink}</code>

${toSmallCaps('Share this link to forward the message automatically!')}
            `, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: toSmallCaps('🔗 Open Link'), url: batchLink }]]
                }
            });
        };

        await forceSubRequired(msg, action);
        return;
    }

    // File upload
    const file = msg.video || msg.document || msg.photo;

    if (!file) return;

    const action = async () => {
        const fileData = Array.isArray(file) ? file[file.length - 1] : file;

        try {
            const fileId = fileData.file_id;
            const fileUniqueId = fileData.file_unique_id;
            // Use file attributes for mime/name if available, fallback for photos
            const fileMimeType = fileData.mime_type || (fileData.width ? 'image/jpeg' : 'application/octet-stream');
            const fileName = fileData.file_name || (msg.caption || `file_${fileUniqueId}.${fileMimeType.split('/')[1] || 'dat'}`);
            const fileSize = fileData.file_size || 0;

            const processingMsg = await bot.sendMessage(chatId, `⏳ <b>${toSmallCaps('Processing...')}</b>`, { parse_mode: 'HTML' });

            await sleep(1000); // Simulate processing time

            const uniqueId = generateUniqueId();

            FILE_DATABASE.set(uniqueId, {
                uniqueId,
                fileId,
                fileUniqueId,
                fileName,
                fileSize,
                fileMimeType,
                uploadedBy: userId,
                uploaderName: firstName,
                chatId,
                createdAt: Date.now(),
                views: 0,
                downloads: 0,
                lastAccessed: Date.now()
            });

            USER_DATABASE.get(userId).totalUploads++;
            ANALYTICS.totalFiles++;

            const streamLink = `${WEBAPP_URL}/stream/${uniqueId}`;
            const downloadLink = `${WEBAPP_URL}/download/${uniqueId}`;
            const fileLink = `${WEBAPP_URL}/file/${uniqueId}`;

            await bot.deleteMessage(chatId, processingMsg.message_id);

            await bot.sendMessage(chatId, `
✅ <b>${toSmallCaps('Link Generated!')}</b>

📁 <b>${toSmallCaps('Name')}:</b> ${fileName}
💾 <b>${toSmallCaps('Size')}:</b> ${formatFileSize(fileSize)}

🔗 <b>${toSmallCaps('Shareable Link')}:</b>
<code>${fileLink}</code>

<b>${toSmallCaps('Direct Links')}:</b>
🔗 ${toSmallCaps('Stream')}: <code>${streamLink}</code>
⬇️ ${toSmallCaps('Download')}: <code>${downloadLink}</code>
            `, {
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: toSmallCaps('🔗 Share'), url: fileLink },
                            { text: toSmallCaps('📺 Stream'), url: streamLink }
                        ],
                        [
                            { text: toSmallCaps('⬇️ Download'), url: downloadLink }
                        ]
                    ]
                }
            });

        } catch (error) {
            console.error('❌ Upload error:', error);
            await bot.sendMessage(chatId, `❌ <b>${toSmallCaps('Error generating link. Please try again or contact Admin.')}</b>`, { parse_mode: 'HTML' });
        }
    };

    await forceSubRequired(msg, action);
});

// ============================================
// EXPRESS SERVER
// ============================================
const app = express();
app.use(express.json());
app.use(express.static('public'));

// Headers for CORS and Streaming
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Homepage
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BeatAnimes Link Generator</title>
    <style>
        body { font-family: sans-serif; background: #2c3e50; color: white; text-align: center; padding: 50px; }
        .container { max-width: 600px; margin: 0 auto; background: #34495e; padding: 30px; border-radius: 10px; }
        h1 { font-size: 2.5em; }
        .btn { display: inline-block; padding: 10px 20px; margin: 20px 5px; background: #3498db; color: white; text-decoration: none; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎬 BeatAnimes Link Generator</h1>
        <p>Permanent Streaming & Batch Links</p>
        <p>Users: ${USER_DATABASE.size} | Files: ${FILE_DATABASE.size} | Batches: ${BATCH_DATABASE.size}</p>
        <a href="https://t.me/${BOT_INFO ? BOT_INFO.username : 'bot'}" class="btn">Start Bot 🚀</a>
    </div>
</body>
</html>
    `);
});

// Batch link handler - redirects to bot with deep link
app.get('/batch/:uniqueId', (req, res) => {
    const uniqueId = req.params.uniqueId;
    const batchData = BATCH_DATABASE.get(uniqueId);

    if (!batchData) {
        return res.status(404).send('<h1>❌ Batch link not found or expired</h1>');
    }

    let linkType = 'batch';
    if (batchData.type === 'single_forward') linkType = 'forward';
    else if (batchData.type === 'sequential_batch') linkType = 'sequential';
    else if (batchData.type === 'custom_file_batch') linkType = 'custom';

    const deepLink = `https://t.me/${BOT_INFO ? BOT_INFO.username : 'bot'}?start=${linkType}_${uniqueId}`;
    res.redirect(deepLink);
});

// File link handler - redirects to bot with deep link
app.get('/file/:uniqueId', (req, res) => {
    const uniqueId = req.params.uniqueId;
    const fileData = FILE_DATABASE.get(uniqueId);

    if (!fileData) {
        return res.status(404).send('<h1>❌ File not found or expired</h1>');
    }

    const deepLink = `https://t.me/${BOT_INFO ? BOT_INFO.username : 'bot'}?start=file_${uniqueId}`;
    res.redirect(deepLink);
});

// Download endpoint (Redirects to file URL, triggering a download)
app.get('/download/:id', async (req, res) => {
    const id = req.params.id;
    const fileData = FILE_DATABASE.get(id);

    if (!fileData) {
        return res.status(404).send('File not found');
    }

    try {
        const fileUrl = await getFreshFileUrl(fileData);
        // Track download
        ANALYTICS.totalDownloads++;
        fileData.downloads++;
        fileData.lastAccessed = Date.now();

        // Redirect to the file URL forcing download
        res.set({
            'Content-Disposition': `attachment; filename="${fileData.fileName}"`,
            'Content-Type': fileData.fileMimeType
        });
        res.redirect(302, fileUrl);

    } catch (e) {
        console.error('Error handling download:', e.message);
        res.status(500).send('Error retrieving file');
    }
});

// Stream endpoint (Handles Range requests for seeking)
app.get('/stream/:id', async (req, res) => {
    const id = req.params.id;
    const fileData = FILE_DATABASE.get(id);

    if (!fileData) {
        return res.status(404).send('File not found');
    }

    try {
        // Track view/stream start
        ANALYTICS.totalViews++;
        fileData.views++;
        fileData.lastAccessed = Date.now();

        const fileUrl = await getFreshFileUrl(fileData);
        const range = req.headers.range;
        const fileSize = fileData.fileSize;
        const fileMimeType = fileData.fileMimeType || 'video/mp4';

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const contentLength = (end - start) + 1;

            const headers = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': contentLength,
                'Content-Type': fileMimeType
            };

            // Use node-fetch to make a sub-request for the specific range
            const fileStream = await fetch(fileUrl, {
                headers: { Range: `bytes=${start}-${end}` }
            });

            res.writeHead(206, headers); // 206 Partial Content
            fileStream.body.pipe(res);

        } else {
            // Full stream request
            const headers = {
                'Content-Length': fileSize,
                'Content-Type': fileMimeType
            };

            const fileStream = await fetch(fileUrl);
            res.writeHead(200, headers);
            fileStream.body.pipe(res);
        }
    } catch (error) {
        console.error('Error handling stream:', error.message);
        res.status(500).send('Error retrieving file for streaming');
    }
});

// Start the Express Server
app.listen(PORT, () => {
    console.log(`🚀 Web server listening on port ${PORT} (WEBAPP_URL: ${WEBAPP_URL})`);
});
