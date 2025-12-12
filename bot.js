// ============================================
// ULTIMATE TELEGRAM PERMANENT LINK BOT (V4 - ALL FEATURES & FIXES)
// INCLUDES: Small Caps Style, Multi-Channel Force Sub, Full Admin Panel (Broadcast, Stats, Cleanup, Channel Management),
//           Streaming/Download Links (Range Support), Robust Welcome Photo Handling.
// ============================================

import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import fetch from 'node-fetch';

// ============================================
// CONFIGURATION & INITIALIZATION
// ============================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-app.onrender.com';
const PORT = process.env.PORT || 3000;

// Admin Configuration
// Use a comma-separated list of IDs for ADMIN_IDS environment variable
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id)) : [];
// IMPORTANT: This must be a long, valid Telegram file_id (not '98' as you used before)
const WELCOME_PHOTO_ID = process.env.WELCOME_PHOTO_ID || null; 
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@YourChannel'; 

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN is required! Please set the BOT_TOKEN environment variable.');
    process.exit(1);
}

// ============================================
// DATABASE & STATE (In-memory storage)
// ============================================
const FILE_DATABASE = new Map(); 
const USER_DATABASE = new Map(); 
const URL_CACHE = new Map(); 
const URL_CACHE_DURATION = 23 * 60 * 60 * 1000; // 23 hours cache duration for Telegram file URLs
const USER_STATE = new Map(); // Tracks multi-step admin actions (e.g., adding channel, broadcasting)

// Global mutable config (Force Sub Channels)
const CONFIG_STATE = {
    FORCE_SUB_CHANNEL_IDS: process.env.MANDATORY_CHANNEL_IDS 
        ? process.env.MANDATORY_CHANNEL_IDS.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
        : []
};

// Cache for channel details (title, username)
const CHANNEL_DETAILS_CACHE = new Map(); 

// Analytics
const ANALYTICS = {
    totalViews: 0,
    totalDownloads: 0,
    totalFiles: 0,
    totalUsers: 0,
    startTime: Date.now()
};

// ============================================
// TELEGRAM BOT INITIALIZATION
// FIX: Use polling: true for simple deployment, or switch to webhook entirely
// ============================================
const bot = new TelegramBot(BOT_TOKEN, { 
    polling: true // Use polling for stability unless deploying a dedicated webhook server
});

console.log('✅ Bot started successfully!');

// Set up bot commands for the Telegram menu
bot.setMyCommands([
    { command: 'start', description: 'Start the bot and open the main menu' },
    { command: 'stats', description: 'Check your usage statistics' },
    { command: 'files', description: 'View and manage your uploaded files' },
    { command: 'admin', description: 'Open the admin control panel (Admins only)' },
]).then(() => console.log('✅ Telegram commands set.'));

// ============================================
// CORE UTILITY FUNCTIONS
// ============================================

/**
 * Converts text to a Small Caps style using Unicode characters.
 * FIX: This function was missing in your previous file.
 */
function toSmallCaps(text) {
    const map = {
        'a': 'ᴀ', 'b': 'ʙ', 'c': 'ᴄ', 'd': 'ᴅ', 'e': 'ᴇ', 'f': 'ғ', 'g': 'ɢ', 'h': 'ʜ', 'i': 'ɪ',
        'j': 'ᴊ', 'k': 'ᴋ', 'l': 'ʟ', 'm': 'ᴍ', 'n': 'ɴ', 'o': 'ᴏ', 'p': 'ᴘ', 'q': 'ǫ', 'r': 'ʀ',
        's': 's', 't': 'ᴛ', 'u': 'ᴜ', 'v': 'ᴠ', 'w': 'ᴡ', 'x': 'x', 'y': 'ʏ', 'z': 'ᴢ',
        ' ': ' ' 
    };
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
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
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

/**
 * Utility function to get a fresh, temporary file URL from Telegram
 */
async function getFreshFileUrl(fileData) {
    const cacheKey = fileData.fileId;
    const cached = URL_CACHE.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < URL_CACHE_DURATION) {
        return cached.url;
    }
    
    try {
        const fileInfo = await bot.getFile(fileData.fileId);
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
// FEATURE: MULTI-CHANNEL FORCE SUBSCRIPTION LOGIC
// FIX: This entire section was missing in your previous file.
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
        // Log, but proceed with error flag
        console.error(`Error fetching chat details for ${channelId}: ${e.message}`);
        return { title: `Unknown Channel (${channelId})`, username: null, id: channelId, error: true };
    }
}

/**
 * Checks membership for all required channels.
 */
async function checkAllMemberships(userId) {
    const channelIds = CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.filter(id => id); 
    if (channelIds.length === 0) return { isMember: true, requiredChannels: [] };

    const requiredChannels = [];
    let isSubscribedToAll = true;

    for (const id of channelIds) {
        const details = await getChannelDetails(id);
        requiredChannels.push({ id, ...details });
        
        if (details.error) {
            isSubscribedToAll = false;
            continue; 
        }

        try {
            const member = await bot.getChatMember(id, userId);
            if (member.status === 'left' || member.status === 'kicked') {
                isSubscribedToAll = false;
            }
        } catch (e) {
             isSubscribedToAll = false; 
        }
        
        if (!isSubscribedToAll) break; // Optimization
    }
    
    return { isMember: isSubscribedToAll, requiredChannels };
}

function getForceJoinKeyboard(requiredChannels) {
    const keyboard = [];
    
    for (const ch of requiredChannels) {
        // Creates an invite link
        const url = ch.username ? `https://t.me/${ch.username.replace('@', '')}` : `tg://join?invite=${ch.id.toString().substring(4)}`; 
        
        keyboard.push([{ text: `📢 ${toSmallCaps(ch.title)}`, url: url }]);
    }
    
    keyboard.push([{ text: toSmallCaps('✅ Click to continue'), callback_data: 'verify_subscription' }]);
    
    return { inline_keyboard: keyboard };
}


/**
 * Central function to check for force subscription and intercept execution if failed.
 */
async function forceSubCheckAndIntercept(msg, action) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    if (isAdmin(userId)) {
        await action();
        return true; 
    }

    const { isMember, requiredChannels } = await checkAllMemberships(userId);
    
    if (isMember) {
        await action();
        return true; 
    } else {
        // Intercept: User is NOT a member, send prompt
        const promptText = `
⚠️ <b>${toSmallCaps('ACCESS DENIED - Join Required')}</b>

${toSmallCaps('Hello')} ${msg.from.first_name}, ${toSmallCaps('to use this bot\'s features, you must first join all of our mandatory channels listed below.')}

${toSmallCaps('Please join')} **${toSmallCaps('ALL')}** ${toSmallCaps('channels and then click the')} '${toSmallCaps('Click to continue')}' ${toSmallCaps('button.')}
        `;
        
        // Delete original message if it's a file upload/command to prevent processing
        if (msg.photo || msg.video || msg.document || (msg.text && msg.text.startsWith('/'))) {
             try { await bot.deleteMessage(chatId, msg.message_id); } catch (e) { /* Ignore */ }
        }

        await bot.sendMessage(chatId, promptText, {
            parse_mode: 'HTML',
            reply_markup: getForceJoinKeyboard(requiredChannels)
        });
        return false;
    }
}

// ============================================
// KEYBOARD LAYOUTS (Styled)
// ============================================

function getMainKeyboard(isAdmin = false) {
    const keyboard = [
        [
            { text: toSmallCaps('📊 My Stats'), callback_data: 'my_stats' },
            { text: toSmallCaps('📁 My Files'), callback_data: 'my_files' }
        ],
        [
            { text: toSmallCaps('📖 How to Use'), callback_data: 'help' },
            { text: toSmallCaps('📢 Channel'), url: `https://t.me/${CHANNEL_USERNAME.replace('@', '')}` }
        ]
    ];
    
    if (isAdmin) {
        keyboard.push([
            { text: toSmallCaps('👑 Admin Panel'), callback_data: 'admin_panel' }
        ]);
    }
    
    return { inline_keyboard: keyboard };
}

function getAdminKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: toSmallCaps('📊 Bot Statistics'), callback_data: 'admin_stats' },
                { text: toSmallCaps(`🔗 Manage Channels (${CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.length})`), callback_data: 'admin_list_channels' }
            ],
            [
                { text: toSmallCaps('📢 Universal Broadcast'), callback_data: 'admin_broadcast_start' },
                { text: toSmallCaps('🗑️ Cleanup Cache'), callback_data: 'admin_clean' }
            ],
            [
                { text: toSmallCaps('🔙 Back to Main'), callback_data: 'start' }
            ]
        ]
    };
}

// ============================================
// BOT COMMANDS - START & ADMIN
// ============================================

async function handleStartCommand(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const firstName = msg.from.first_name;
    
    registerUser(userId, username, firstName);
    
    const action = async () => {
        // FIX: Conditional rendering of global stats (if you only want admins to see them)
        const globalStats = isAdmin(userId) ? `
<b>👥 ${toSmallCaps('Users')}:</b> ${USER_DATABASE.size}
<b>📁 ${toSmallCaps('Files')}:</b> ${FILE_DATABASE.size}
<b>👁️ ${toSmallCaps('Total Views')}:</b> ${ANALYTICS.totalViews}
` : '';
        
        const welcomeText = `
🎬 <b>${toSmallCaps('Welcome to BeatAnimes Link Generator!')}</b>

${toSmallCaps(firstName)}, ${toSmallCaps('I\'m here to help you create')} <b>${toSmallCaps('permanent streaming links')}</b> ${toSmallCaps('for your videos! 🚀')}

<b>✨ ${toSmallCaps('Features')}:</b>
✅ ${toSmallCaps('Permanent links that never expire')}
✅ ${toSmallCaps('Direct streaming support')}
✅ ${toSmallCaps('Analytics and tracking')}

<b>🎯 ${toSmallCaps('Quick Start')}:</b>
${toSmallCaps('Just send me any video file, and I\'ll generate a permanent link instantly!')}

${globalStats}

${toSmallCaps('Join our channel')}: ${CHANNEL_USERNAME}
        `;
        
        const keyboard = getMainKeyboard(isAdmin(userId));
        
        if (WELCOME_PHOTO_ID) {
            try {
                // Try to send photo + caption
                await bot.sendPhoto(chatId, WELCOME_PHOTO_ID, {
                    caption: welcomeText,
                    parse_mode: 'HTML',
                    reply_markup: keyboard
                });
            } catch (error) {
                // FIX: Fall back to text if photo fails (e.g., bad ID - your case)
                console.error('❌ Failed to send welcome photo. Falling back to text.', error.message);
                await bot.sendMessage(chatId, welcomeText, { 
                    parse_mode: 'HTML', 
                    reply_markup: keyboard 
                });
            }
        } else {
            // Send text if no photo ID is set
            await bot.sendMessage(chatId, welcomeText, {
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        }
    };

    // Use the interceptor for the /start command
    await forceSubCheckAndIntercept(msg, action);
}

// Command Handlers (using bot.onText for command stability)
bot.onText(/\/start/, handleStartCommand);
// FIX: /stats and /files now use handleStartCommand to ensure Force Sub check and correct menu display
bot.onText(/\/stats/, (msg) => handleStartCommand(msg)); 
bot.onText(/\/files/, (msg) => handleStartCommand(msg)); 

bot.onText(/\/admin/, async (msg) => { 
    if (isAdmin(msg.from.id)) {
        await bot.sendMessage(msg.chat.id, `👑 <b>${toSmallCaps('Admin Panel')}</b>\n\n${toSmallCaps('Welcome Admin! Choose an option below')}:`, {
            parse_mode: 'HTML',
            reply_markup: getAdminKeyboard()
        });
    } else {
        await bot.sendMessage(msg.chat.id, toSmallCaps('❌ You are not authorized!'));
    }
});


// ============================================
// CALLBACK QUERY HANDLER 
// ============================================

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;
    const messageId = query.message.message_id;

    // Helper function for safe message editing
    const editMessage = async (text, keyboard, disablePreview = false) => {
        try {
            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: keyboard,
                disable_web_page_preview: disablePreview
            });
        } catch (e) {
            // FIX: Robust error handling for message is not modified / message not found
            if (!e.message.includes('message is not modified')) {
                 try { await bot.deleteMessage(chatId, messageId); } catch (e) { /* Ignore */ }
                 await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard, disable_web_page_preview: disablePreview });
            }
        }
    };
    
    // --- FORCE SUB VERIFICATION HANDLER ---
    if (data === 'verify_subscription') {
        const { isMember, requiredChannels } = await checkAllMemberships(userId);
        
        if (isMember) {
            try { await bot.deleteMessage(chatId, messageId); } catch (e) { /* Ignore */ }
            await handleStartCommand({ chat: { id: chatId }, from: query.from, text: '/start' });
            return bot.answerCallbackQuery(query.id, { text: toSmallCaps('✅ Access Granted! Welcome!'), show_alert: true });
        } else {
            const promptText = `
⚠️ <b>${toSmallCaps('ACCESS DENIED - Join Required')}</b>

${toSmallCaps('You are still not a member of all required channels. Please join')} **${toSmallCaps('ALL')}** ${toSmallCaps('channels and then click the')} '${toSmallCaps('Click to continue')}' ${toSmallCaps('button.')}
            `;
            const keyboard = getForceJoinKeyboard(requiredChannels);
            await editMessage(promptText, keyboard); 
            return bot.answerCallbackQuery(query.id, { text: toSmallCaps('⚠️ Please join all channels listed above.'), show_alert: true });
        }
    }


    // --- Global Membership Check for All Other Callbacks ---
    const { isMember } = await checkAllMemberships(userId);
    if (!isMember && !isAdmin(userId) && data !== 'start') {
        await bot.answerCallbackQuery(query.id, { text: toSmallCaps('⚠️ You must join the channel(s) to view this menu.'), show_alert: true });
        return; 
    }

    // --- Core Handlers (User) ---
    if (data === 'start') {
        // Back to Start logic: delete old message and execute the full start command logic
        try { await bot.deleteMessage(chatId, messageId); } catch (e) { /* Ignore */ }
        // Re-use the full handler
        await handleStartCommand({ chat: { id: chatId }, from: query.from, text: '/start' }); 
        return bot.answerCallbackQuery(query.id); 
    }
    
    // ... (my_stats, my_files, etc. logic here - fully implemented)
    else if (data === 'my_stats') {
         const user = USER_DATABASE.get(userId);
         let userFiles = 0;
         let userViews = 0;
         for (const file of FILE_DATABASE.values()) {
             if (file.uploadedBy === userId) {
                 userFiles++;
                 userViews += file.views;
             }
         }
            
        const statsText = `
📊 <b>${toSmallCaps('Your Statistics')}</b>

👤 <b>${toSmallCaps('Name')}:</b> ${user.firstName}
🆔 <b>${toSmallCaps('User ID')}:</b> <code>${userId}</code>
📅 <b>${toSmallCaps('Joined')}:</b> ${formatDate(user.joinedAt)}

📁 <b>${toSmallCaps('Total Files')}:</b> ${userFiles}
👁️ <b>${toSmallCaps('Total Views')}:</b> ${userViews}

${toSmallCaps('Keep sharing videos! 🚀')}
        `;
            
        await editMessage(statsText, { inline_keyboard: [[{ text: toSmallCaps('🔙 Back'), callback_data: 'start' }]] });
    }
    
    else if (data === 'my_files') {
        let fileList = `📁 <b>${toSmallCaps('Your Files (Last 10)')}:</b>\n\n`;
        let count = 0;
        const buttons = [];
        
        for (const [id, file] of Array.from(FILE_DATABASE.entries()).reverse()) { // Show most recent first
            if (file.uploadedBy === userId) {
                count++;
                if (count <= 10) {
                    fileList += `${count}. ${toSmallCaps(file.fileName.substring(0, 30))}...\n`;
                    fileList += `   👁️ ${file.views} ${toSmallCaps('views')} | 💾 ${formatFileSize(file.fileSize)}\n`;
                    fileList += `   🔗 ${toSmallCaps('ID')}: <code>${id}</code>\n\n`;
                    
                    buttons.push([{ text: toSmallCaps(`🔗 ${file.fileName.substring(0, 20)}...`), url: `${WEBAPP_URL}/stream/${id}` }]);
                }
            }
        }
        
        if (count === 0) {
            fileList = toSmallCaps('📭 You haven\'t uploaded any files yet. Send me a video to get started!');
        } else if (count > 10) {
            fileList += `\n<i>${toSmallCaps('Showing 10 of')} ${count} ${toSmallCaps('files')}</i>`;
        }
        
        buttons.push([{ text: toSmallCaps('🔙 Back'), callback_data: 'start' }]);
        
        await editMessage(fileList, { inline_keyboard: buttons }, true); 
    }

    else if (data === 'help') {
        const helpText = `
📖 <b>${toSmallCaps('How to Use')}</b>

<b>${toSmallCaps('Step 1: Send File')}</b>
${toSmallCaps('Send me any video, document, or photo file from your device or forward from a channel.')}

<b>${toSmallCaps('Step 2: Get Link')}</b>
${toSmallCaps('I\'ll instantly generate a permanent streaming/download link for you.')}

<b>${toSmallCaps('Step 3: Use Anywhere')}</b>
${toSmallCaps('Copy the link and use it on your website, app, or share it! Links support video seeking.')}

<b>💡 ${toSmallCaps('Pro Tip')}s:</b>
• ${toSmallCaps('Links never expire.')}
• ${toSmallCaps('Use')} /files ${toSmallCaps('to see all your uploads.')}
• ${toSmallCaps('Use')} /stats ${toSmallCaps('for personal analytics.')}
        `;
        
        await editMessage(helpText, { inline_keyboard: [[{ text: toSmallCaps('🔙 Back'), callback_data: 'start' }]] });
    }
    
    // --- Admin Handlers (fully implemented) ---
    else if (data === 'admin_panel' && isAdmin(userId)) {
        await editMessage(`👑 <b>${toSmallCaps('Admin Panel')}</b>\n\n${toSmallCaps('Welcome Admin! Choose an option below')}:`, getAdminKeyboard());
    }
    
    // Admin: Bot Statistics
    else if (data === 'admin_stats' && isAdmin(userId)) {
        const uptime = formatDuration(Date.now() - ANALYTICS.startTime);
        const cacheSize = URL_CACHE.size;
        
        const statsText = `
📊 <b>${toSmallCaps('Bot Global Statistics')}</b>

⚙️ <b>${toSmallCaps('Uptime')}:</b> ${uptime}
👥 <b>${toSmallCaps('Total Users')}:</b> ${USER_DATABASE.size}
📁 <b>${toSmallCaps('Total Files')}:</b> ${FILE_DATABASE.size}
👁️ <b>${toSmallCaps('Total Views')}:</b> ${ANALYTICS.totalViews}
⬇️ <b>${toSmallCaps('Total Downloads')}:</b> ${ANALYTICS.totalDownloads}
🧹 <b>${toSmallCaps('Active URL Cache Entries')}:</b> ${cacheSize}

${toSmallCaps('Channel IDs configured')}: ${CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.length}
        `;
        
        await editMessage(statsText, { inline_keyboard: [[{ text: toSmallCaps('🔙 Back'), callback_data: 'admin_panel' }]] });
    }
    
    // Admin: Manage Channels
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
    
    // Admin: Broadcast Start
    else if (data === 'admin_broadcast_start' && isAdmin(userId)) {
        USER_STATE.set(userId, { state: 'AWAITING_BROADCAST_MESSAGE' });
        await editMessage(`📢 <b>${toSmallCaps('Universal Broadcast')}</b>\n\n${toSmallCaps('Please send the message (text, photo, video, etc.) you want to broadcast to all')} ${USER_DATABASE.size} ${toSmallCaps('users.')}`, {
            inline_keyboard: [[{ text: toSmallCaps('❌ Cancel'), callback_data: 'admin_panel' }]]
        });
    }

    // Admin: Cache Cleanup
    else if (data === 'admin_clean' && isAdmin(userId)) {
        const cleanedCount = URL_CACHE.size;
        URL_CACHE.clear();
        
        await bot.answerCallbackQuery(query.id, { text: toSmallCaps(`✅ Cleaned ${cleanedCount} cached file URLs.`), show_alert: true });
        await editMessage(`🗑️ <b>${toSmallCaps('Cache Cleanup Complete')}</b>\n\n${toSmallCaps('Successfully cleared all')} ${cleanedCount} ${toSmallCaps('temporary Telegram file URLs from the cache.')}`, {
            inline_keyboard: [[{ text: toSmallCaps('🔙 Back'), callback_data: 'admin_panel' }]]
        });
    }

    // Handle broadcast confirmation
    else if (data.startsWith('admin_broadcast_confirm_') && isAdmin(userId)) {
        const broadcastType = data.substring(24);
        const state = USER_STATE.get(userId);
        if (!state || !state.broadcastMsg) {
            return bot.answerCallbackQuery(query.id, { text: toSmallCaps('❌ Broadcast data expired or missing.'), show_alert: true });
        }

        await editMessage(`🚀 <b>${toSmallCaps('Starting Broadcast...')}</b>\n\n${toSmallCaps('This may take some time. I will notify you when it is complete.')}`, null);

        const broadcastMsg = state.broadcastMsg;
        let successCount = 0;
        let blockCount = 0;
        const targetUsers = Array.from(USER_DATABASE.keys());
        
        for (const targetId of targetUsers) {
            if (isAdmin(targetId) && targetId === userId) continue; 
            
            try {
                if (broadcastType === 'text') {
                    await bot.sendMessage(targetId, broadcastMsg.text, { parse_mode: 'HTML', disable_web_page_preview: true });
                } else if (broadcastType === 'photo') {
                    await bot.sendPhoto(targetId, broadcastMsg.fileId, { caption: broadcastMsg.caption, parse_mode: 'HTML' });
                } else if (broadcastType === 'video') {
                     await bot.sendVideo(targetId, broadcastMsg.fileId, { caption: broadcastMsg.caption, parse_mode: 'HTML' });
                }
                
                successCount++;
            } catch (error) {
                if (error.response && (error.response.statusCode === 403 || error.response.body.description.includes('bot was blocked by the user'))) {
                    USER_DATABASE.get(targetId).isBlocked = true;
                    blockCount++;
                } else {
                    console.error(`Error sending broadcast to ${targetId}:`, error.message);
                }
            }
            await sleep(50); // Throttle for safety (20 messages per second limit)
        }
        
        USER_STATE.delete(userId); // Clear state after job done

        const resultText = `
✅ <b>${toSmallCaps('Broadcast Complete!')}</b>

👥 <b>${toSmallCaps('Total Users Attempted')}:</b> ${targetUsers.length}
🟢 <b>${toSmallCaps('Successful Sends')}:</b> ${successCount}
🔴 <b>${toSmallCaps('Bot Blocked')}:</b> ${blockCount}
        `;
        
        await bot.sendMessage(chatId, resultText, {
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: toSmallCaps('🔙 Back to Admin'), callback_data: 'admin_panel' }]] }
        });
    }


    // Always answer the query to dismiss loading state
    await bot.answerCallbackQuery(query.id);
});


// ============================================
// MESSAGE HANDLER (File Upload & Multi-step State)
// ============================================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const firstName = msg.from.first_name;
    
    registerUser(userId, username, firstName); 

    // Ignore commands (they are handled by bot.onText)
    if (msg.text && msg.text.startsWith('/')) return;
    
    // 1. Admin State Check (Adding Join Channel - Forwarded Message)
    if (isAdmin(userId) && USER_STATE.has(userId) && USER_STATE.get(userId).state === 'ADDING_JOIN_CHANNEL_FORWARD') {
        USER_STATE.delete(userId); // Consume state

        if (msg.forward_from_chat && (msg.forward_from_chat.type === 'channel' || msg.forward_from_chat.type === 'supergroup')) {
            const newId = msg.forward_from_chat.id;
            
            if (CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.includes(newId)) {
                return bot.sendMessage(chatId, `❌ **${toSmallCaps('Failed!')}** ${toSmallCaps('Channel is already in the mandatory list.')}`, { parse_mode: 'Markdown' });
            }

            try {
                const chatInfo = await bot.getChat(newId);
                const botMember = await bot.getChatMember(newId, bot.options.id);

                if (botMember.status === 'left' || botMember.status === 'kicked') {
                     return bot.sendMessage(chatId, `❌ **${toSmallCaps('Failed!')}** ${toSmallCaps('The bot must be an administrator or a member in this channel to verify subscriptions.')}`, { parse_mode: 'Markdown' });
                }

                CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.push(newId);
                CHANNEL_DETAILS_CACHE.set(newId, { title: chatInfo.title, username: chatInfo.username ? `@${chatInfo.username}` : null, id: newId });
                
                return bot.sendMessage(chatId, `✅ **${toSmallCaps('Mandatory Join Channel Added!')}**\n\n${toSmallCaps('Channel')}: **${chatInfo.title}**\n${toSmallCaps('ID')}: <code>${newId}</code>`, { parse_mode: 'HTML' });
            } catch (e) {
                // FIX: This now handles the specific error you were seeing when adding a channel
                console.error('Error adding forwarded channel:', e.message);
                return bot.sendMessage(chatId, `❌ **${toSmallCaps('Error adding channel.')}**\n\n${toSmallCaps('Please ensure the bot is an admin/member of the channel.')}\n${toSmallCaps('Reason')}: ${e.message}`, { parse_mode: 'Markdown' });
            }

        } else {
            return bot.sendMessage(chatId, `❌ **${toSmallCaps('Invalid Forward.')}** ${toSmallCaps('Please forward a message directly from the CHANNEL you wish to add.')}`, { parse_mode: 'Markdown' });
        }
    }


    // 2. Admin State Check (Adding Join Channel - ID/Username input)
    if (isAdmin(userId) && USER_STATE.has(userId) && USER_STATE.get(userId).state === 'ADDING_JOIN_CHANNEL_ID' && msg.text) {
        USER_STATE.delete(userId); // Consume state
        let newIdText = msg.text.trim();
        let targetIdentifier = newIdText.startsWith('-100') ? parseInt(newIdText) : newIdText;

        try {
            const chatInfo = await bot.getChat(targetIdentifier);
            const actualId = chatInfo.id;
            
            if (CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.includes(actualId)) {
                return bot.sendMessage(chatId, `❌ **${toSmallCaps('Failed!')}** ${toSmallCaps('This channel is already in the mandatory list.')}`, { parse_mode: 'Markdown' });
            }

            const isChannel = chatInfo.type === 'channel' || chatInfo.type === 'supergroup';
            
            if (isChannel) {
                const botMember = await bot.getChatMember(actualId, bot.options.id);
                if (botMember.status === 'left' || botMember.status === 'kicked') {
                    return bot.sendMessage(chatId, `❌ **${toSmallCaps('Failed!')}** ${toSmallCaps('The bot must be an administrator or a member in this channel to verify subscriptions.')}`, { parse_mode: 'Markdown' });
                }

                CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.push(actualId);
                CHANNEL_DETAILS_CACHE.set(actualId, { title: chatInfo.title, username: chatInfo.username ? `@${chatInfo.username}` : null, id: actualId });
                
                await bot.sendMessage(chatId, `✅ **${toSmallCaps('Mandatory Join Channel Added!')}**\n\n${toSmallCaps('Channel')}: **${chatInfo.title}**\n${toSmallCaps('ID')}: <code>${actualId}</code>`, { parse_mode: 'HTML' });
            } else {
                return bot.sendMessage(chatId, `❌ **${toSmallCaps('Invalid Chat Type!')}** ${toSmallCaps('Please send the ID or Username of a Channel or Supergroup.')}`, { parse_mode: 'Markdown' });
            }
        } catch (e) {
            console.error('Error adding channel by ID/username:', e.message);
            return bot.sendMessage(chatId, `❌ **${toSmallCaps('Channel Not Found!')}** ${toSmallCaps('Please ensure the ID/Username is correct and the bot is an admin/member of the channel.')}\n${toSmallCaps('Reason')}: ${e.message}`, { parse_mode: 'Markdown' });
        }
        return;
    }
    
    // 3. Admin State Check (Awaiting Broadcast Message) - Fully implemented
    if (isAdmin(userId) && USER_STATE.has(userId) && USER_STATE.get(userId).state === 'AWAITING_BROADCAST_MESSAGE') {
        let broadcastMsg = {};
        let type;

        if (msg.text) {
            broadcastMsg = { text: msg.text };
            type = 'text';
        } else if (msg.photo) {
            const photo = msg.photo[msg.photo.length - 1];
            broadcastMsg = { fileId: photo.file_id, caption: msg.caption || '' };
            type = 'photo';
        } else if (msg.video) {
            broadcastMsg = { fileId: msg.video.file_id, caption: msg.caption || '' };
            type = 'video';
        } else {
            return bot.sendMessage(chatId, toSmallCaps('⚠️ Unsupported message type for broadcast. Please send text, photo, or video.'), {
                reply_markup: { inline_keyboard: [[{ text: toSmallCaps('❌ Cancel Broadcast'), callback_data: 'admin_panel' }]] }
            });
        }
        
        // Store message data in state
        USER_STATE.set(userId, { state: 'CONFIRMING_BROADCAST', broadcastMsg: broadcastMsg });

        await bot.sendMessage(chatId, `⚠️ **${toSmallCaps('Confirm Broadcast')}**\n\n${toSmallCaps('You are about to send this message (shown above) to all')} ${USER_DATABASE.size} ${toSmallCaps('users.')}\n\n${toSmallCaps('Type')}: ${type.toUpperCase()}`, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: toSmallCaps('✅ CONFIRM AND SEND'), callback_data: `admin_broadcast_confirm_${type}` }
                    ],
                    [
                        { text: toSmallCaps('❌ Cancel Broadcast'), callback_data: 'admin_panel' }
                    ]
                ]
            }
        });
        return;
    }
    
    // 4. File Upload Logic - WRAPPED IN PROTECTED ACTION
    const file = msg.video || msg.document || msg.photo;
    
    if (!file) return;

    const action = async () => {
        const fileData = Array.isArray(file) ? file[file.length - 1] : file;
        
        try {
            const fileId = fileData.file_id;
            const fileUniqueId = fileData.file_unique_id;
            const fileMimeType = fileData.mime_type || (fileData.mime_type || (fileData.width && fileData.height ? 'image/jpeg' : 'application/octet-stream'));
            // FIX: Robust file name handling
            const fileName = fileData.file_name || (msg.caption || `${toSmallCaps('file')}_${fileUniqueId}.${fileMimeType.split('/')[1] || 'dat'}`);
            const fileSize = fileData.file_size || 0;
            
            // Processing animation
            const processingMsg = await bot.sendMessage(chatId, `⏳ <b>${toSmallCaps('Processing your file...')}</b>`, {
                parse_mode: 'HTML'
            });
            
            await sleep(1000);
            
            const uniqueId = generateUniqueId();
            
            FILE_DATABASE.set(uniqueId, {
                uniqueId: uniqueId,
                fileId: fileId,
                fileUniqueId: fileUniqueId,
                fileName: fileName,
                fileSize: fileSize,
                fileMimeType: fileMimeType, 
                uploadedBy: userId,
                uploaderName: firstName,
                chatId: chatId,
                createdAt: Date.now(),
                views: 0,
                downloads: 0,
                lastAccessed: Date.now()
            });
            
            const user = USER_DATABASE.get(userId);
            user.totalUploads++;
            ANALYTICS.totalFiles++;
            
            const streamLink = `${WEBAPP_URL}/stream/${uniqueId}`;
            const downloadLink = `${WEBAPP_URL}/download/${uniqueId}`;
            
            await bot.deleteMessage(chatId, processingMsg.message_id);
            
            const successText = `
✅ <b>${toSmallCaps('Permanent Link Generated Successfully!')}</b>

📁 <b>${toSmallCaps('File Name')}:</b> ${fileName}
💾 <b>${toSmallCaps('File Size')}:</b> ${formatFileSize(fileSize)}

🔗 <b>${toSmallCaps('Streaming Link')}:</b>
<code>${streamLink}</code>

⬇️ <b>${toSmallCaps('Download Link')}:</b>
<code>${downloadLink}</code>

<b>✨ ${toSmallCaps('Link Status')}:</b> ${toSmallCaps('PERMANENT')}
            `;
            
            await bot.sendMessage(chatId, successText, {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: toSmallCaps('🔗 Open Stream'), url: streamLink },
                            { text: toSmallCaps('⬇️ Download'), url: downloadLink }
                        ]
                    ]
                }
            });
            
        } catch (error) {
            console.error('❌ Upload error:', error);
            await bot.sendMessage(chatId, `❌ <b>${toSmallCaps('Error generating link.')}</b>\n\n${toSmallCaps('Please try again or contact admin.')}`, {
                parse_mode: 'HTML'
            });
        }
    };
    
    // Intercept file upload
    await forceSubCheckAndIntercept(msg, action);
});


// ============================================
// EXPRESS SERVER (HTTP/Streaming Handlers)
// ============================================
const app = express();
app.use(express.json());
// Ensure you have a 'public' folder if you plan to use express.static
app.use(express.static('public'));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Range, Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Home page (Fully styled)
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${toSmallCaps('BeatAnimes Link Generator')}</title>
    <style>
        body { font-family: sans-serif; background: #2c3e50; color: white; text-align: center; padding: 50px; }
        .container { max-width: 600px; margin: 0 auto; background: #34495e; padding: 30px; border-radius: 10px; }
        h1 { font-size: 2.5em; margin-bottom: 20px; }
        p { font-size: 1.1em; margin-bottom: 10px; opacity: 0.8; }
        .btn { display: inline-block; padding: 10px 20px; margin-top: 20px; background: #3498db; color: white; text-decoration: none; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎬 ${toSmallCaps('BeatAnimes Link Generator')}</h1>
        <p>${toSmallCaps('Generate Permanent Streaming Links for Your Videos.')}</p>
        <p>${toSmallCaps('Total Users')}: ${USER_DATABASE.size} | ${toSmallCaps('Total Files')}: ${FILE_DATABASE.size} | ${toSmallCaps('Total Views')}: ${ANALYTICS.totalViews}</p>
        <a href="https://t.me/${bot.options.username || 'YourBotUsername'}" class="btn">${toSmallCaps('Start Using Bot 🚀')}</a>
    </div>
</body>
</html>
    `);
});


// Stream video with range support (CORE FEATURE)
app.get('/stream/:id', async (req, res) => {
    const id = req.params.id;
    const fileData = FILE_DATABASE.get(id);

    if (!fileData) {
        return res.status(404).send(toSmallCaps('File not found or has expired.'));
    }

    try {
        const fileUrl = await getFreshFileUrl(fileData);
        const range = req.headers.range;
        
        const fileMimeType = fileData.fileMimeType || 'video/mp4'; 

        if (range) {
            // Range request (for seeking/partial content)
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileData.fileSize - 1;
            const contentLength = (end - start) + 1;
            
            const headers = {
                'Content-Range': `bytes ${start}-${end}/${fileData.fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': contentLength,
                'Content-Type': fileMimeType
            };
            
            const fetchOptions = { headers: { Range: `bytes=${start}-${end}` } };
            const fileResponse = await fetch(fileUrl, fetchOptions);

            res.writeHead(206, headers);
            fileResponse.body.pipe(res);

        } else {
            // Full file request
            const headers = {
                'Content-Length': fileData.fileSize,
                'Content-Type': fileMimeType,
                'Accept-Ranges': 'bytes'
            };
            
            const fileResponse = await fetch(fileUrl);
            res.writeHead(200, headers);
            fileResponse.body.pipe(res);
        }

        fileData.views++;
        fileData.lastAccessed = Date.now();
        ANALYTICS.totalViews++;

    } catch (error) {
        console.error('❌ Streaming Error:', error.message);
        res.status(500).send(toSmallCaps('Streaming failed: Could not retrieve file from Telegram.'));
    }
});


// Download video
app.get('/download/:id', async (req, res) => {
    const id = req.params.id;
    const fileData = FILE_DATABASE.get(id);

    if (!fileData) {
        return res.status(404).send(toSmallCaps('File not found or has expired.'));
    }

    try {
        const fileUrl = await getFreshFileUrl(fileData);
        const fileResponse = await fetch(fileUrl);
        
        res.setHeader('Content-Disposition', `attachment; filename="${fileData.fileName}"`);
        res.setHeader('Content-Type', fileResponse.headers.get('content-type') || 'application/octet-stream');
        res.setHeader('Content-Length', fileData.fileSize);
        
        fileResponse.body.pipe(res);

        fileData.downloads++;
        fileData.lastAccessed = Date.now();
        ANALYTICS.totalDownloads++;

    } catch (error) {
        console.error('❌ Download Error:', error.message);
        res.status(500).send(toSmallCaps('Download failed: Could not retrieve file from Telegram.'));
    }
});


// ============================================
// START SERVER AND MAINTENANCE LOOP
// ============================================

app.listen(PORT, () => {
    console.log('═══════════════════════════════════════');
    console.log(`🎬 ${toSmallCaps('BeatAnimes Link Generator Bot')}`);
    console.log('═══════════════════════════════════════');
    console.log(`✅ ${toSmallCaps('Server running on port')} ${PORT}`);
    console.log(`📡 ${toSmallCaps('URL')}: ${WEBAPP_URL}`);
    console.log(`👑 ${toSmallCaps('Admins')}: ${ADMIN_IDS.length}`);
    console.log(`🤖 ${toSmallCaps('Bot is ready!')}`);
    console.log(`🔗 ${toSmallCaps('Mandatory Channels')}: ${CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.length}`);
    console.log('═══════════════════════════════════════');
});

// Maintenance: Clean up expired cache every hour
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, value] of URL_CACHE.entries()) {
        if (now - value.timestamp > URL_CACHE_DURATION) {
            URL_CACHE.delete(key);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`🧹 ${toSmallCaps('Cleaned')} ${cleaned} ${toSmallCaps('expired cache entries')}`);
    }
}, 60 * 60 * 1000); // 1 hour

// Graceful shutdown
process.on('SIGINT', () => {
    console.log(`\n⏸️ ${toSmallCaps('Shutting down gracefully...')}`);
    bot.stopPolling();
    process.exit(0);
});
