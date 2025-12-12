// ============================================
// ADVANCED TELEGRAM PERMANENT LINK BOT
// With Dual Links, Batch Forwarding, Limits, and Auto-Delete
// ============================================

import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import fetch from 'node-fetch';

// ============================================
// CONFIGURATION
// ============================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-app.onrender.com';
const PORT = process.env.PORT || 3000;
const BOT_USERNAME = process.env.BOT_USERNAME || 'BeatAnimesBot'; // Must be set to your bot's username!

// Admin Configuration
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id)) : [];
const WELCOME_PHOTO_ID = process.env.WELCOME_PHOTO_ID || null; 

// Channel Configuration (Source of media for Direct Links & Force Join)
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || 'YourPrivateChannel'; // Public or private channel username
const CHANNEL_ID = process.env.CHANNEL_ID || -1002530952988; // **CRITICAL:** Get your channel's actual ID

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN is required!');
    process.exit(1);
}

// Link Limits Configuration
const LINK_LIMITS = {
    NORMAL: 10,
    PREMIUM: 40,
    ADMIN: Infinity
};

// ============================================
// DATABASE & STATE (IN-MEMORY - NON-PERSISTENT)
// WARNING: Data will be lost on bot restart!
// ============================================
const FILE_DATABASE = new Map(); // Stores link data: { linkType, fileId, messageIds, ... }
const USER_DATABASE = new Map(); // Stores user data: { userId, userType, totalUploads, lastMessageId, ... }
const USER_STATE = new Map();    // Stores multi-step command state: { step, data }
const URL_CACHE = new Map();
const URL_CACHE_DURATION = 23 * 60 * 60 * 1000;

// Analytics
const ANALYTICS = {
    totalViews: 0,
    totalDownloads: 0,
    totalFiles: 0,
    totalUsers: 0,
    startTime: Date.now()
};

// ============================================
// TELEGRAM BOT
// ============================================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('✅ Bot object created.');

// ============================================
// HELPER FUNCTIONS
// ============================================

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
            isBlocked: false,
            userType: 'NORMAL', // Default tier
            lastMessageId: null 
        });
        ANALYTICS.totalUsers++;
    } else {
        const user = USER_DATABASE.get(userId);
        user.lastActive = Date.now();
    }
    return USER_DATABASE.get(userId);
}

function getUserStats(userId) {
    let files = 0;
    let views = 0;
    
    for (const file of FILE_DATABASE.values()) {
        if (file.uploadedBy === userId) {
            files++;
            views += file.views;
        }
    }
    
    return { files, views };
}

function canGenerateLink(userId) {
    const user = USER_DATABASE.get(userId);
    if (isAdmin(userId)) return { allowed: true, limit: LINK_LIMITS.ADMIN };
    
    const limit = LINK_LIMITS[user.userType] || LINK_LIMITS.NORMAL;
    const isAllowed = user.totalUploads < limit;

    return { allowed: isAllowed, limit: limit, current: user.totalUploads };
}

async function isMember(userId) {
    try {
        const member = await bot.getChatMember(CHANNEL_ID, userId);
        const status = member.status;
        return status === 'member' || status === 'administrator' || status === 'creator';
    } catch (e) {
        // Assume not a member if API call fails for this purpose
        return false;
    }
}

async function deletePreviousMessage(chatId, userId) {
    const user = USER_DATABASE.get(userId);
    if (user && user.lastMessageId) {
        try {
            // Attempt to delete the message
            await bot.deleteMessage(chatId, user.lastMessageId);
            user.lastMessageId = null; 
        } catch (e) {
            // Error ignored: message already deleted or bot lacks permission
        }
    }
}

// Helper to delete previous message and send a new one, saving the new ID
async function sendNewMessage(chatId, userId, text, options = {}) {
    await deletePreviousMessage(chatId, userId);
    
    // Default options for styling and tidiness
    const defaultOptions = { 
        parse_mode: 'HTML', 
        disable_web_page_preview: true 
    };

    const mergedOptions = { ...defaultOptions, ...options };
    
    const sentMessage = await bot.sendMessage(chatId, text, mergedOptions);
    USER_DATABASE.get(userId).lastMessageId = sentMessage.message_id;
    return sentMessage;
}

// ============================================
// KEYBOARD LAYOUTS
// ============================================

function getMainKeyboard(isAdmin = false) {
    const keyboard = [
        [
            { text: '🔗 Direct Link Generator', callback_data: 'direct_link_menu' }
        ],
        [
            { text: '📊 My Stats', callback_data: 'my_stats' },
            { text: '📁 My Files', callback_data: 'my_files' }
        ],
        [
            { text: '📖 How to Use', callback_data: 'help' },
            { text: '📢 Channel', url: `https://t.me/${CHANNEL_USERNAME.replace('@', '')}` }
        ]
    ];
    
    if (isAdmin) {
        keyboard.push([
            { text: '👑 Admin Panel', callback_data: 'admin_panel' }
        ]);
    }
    
    return { inline_keyboard: keyboard };
}

function getDirectLinkMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: 'Single Message (/getlink)', callback_data: 'start_getlink' }],
            [{ text: 'Message Range (/batch)', callback_data: 'start_batch' }],
            [{ text: 'Custom Messages (/custom_batch)', callback_data: 'start_custom_batch' }],
            [{ text: '🔙 Back to Main Menu', callback_data: 'start' }]
        ]
    };
}

function getAdminKeyboard() {
    return {
        inline_keyboard: [
            [
                { text: '📊 Statistics', callback_data: 'admin_stats' },
                { text: '👥 Users', callback_data: 'admin_users' }
            ],
            [
                { text: '📁 All Files', callback_data: 'admin_files' },
                { text: '🗑️ Clean Cache', callback_data: 'admin_clean' }
            ],
            [
                { text: '📢 Broadcast', callback_data: 'admin_broadcast' },
                { text: '⚙️ Settings', callback_data: 'admin_settings' }
            ],
            [
                { text: '🔙 Back', callback_data: 'start' }
            ]
        ]
    };
}

function getFileActionsKeyboard(fileId) {
    const file = FILE_DATABASE.get(fileId);
    
    const actions = [
        [
            { text: '📊 Stats', callback_data: `file_stats_${fileId}` },
            { text: '🗑️ Delete', callback_data: `delete_file_${fileId}` }
        ]
    ];
    
    if (file.linkType === 'STREAMABLE') {
        actions.unshift([
            { text: '🔗 Open Stream', url: `${WEBAPP_URL}/stream/${fileId}` },
            { text: '⬇️ Download', url: `${WEBAPP_URL}/download/${fileId}` }
        ]);
    } else if (file.linkType === 'DIRECT') {
        const tgLink = `${WEBAPP_URL}/direct/${fileId}`;
         actions.unshift([
            { text: '🔗 Open Direct Link', url: tgLink },
            { text: '📋 Copy Deep Link', callback_data: `copy_tg_link_${fileId}` }
        ]);
    }
    
    actions.push([
        { text: '🔙 Back', callback_data: 'my_files' }
    ]);
    
    return { inline_keyboard: actions };
}

// ============================================
// CORE HANDLER: FORCE JOIN CHECK
// ============================================

async function checkMembershipAndProceed(msg, handler) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;

    registerUser(userId, msg.from.username, msg.from.first_name);

    const memberStatus = await isMember(userId);
    if (!memberStatus) {
        await deletePreviousMessage(chatId, userId);
        const joinMsg = await bot.sendMessage(chatId, `
🚫 <b>Access Denied</b>

To use the bot, you must first join our channel: <b>${CHANNEL_USERNAME}</b>.

Click the button below to join and then click "I Have Joined."
        `, {
            parse_mode: 'HTML',
            reply_markup: getForceJoinKeyboard()
        });
        USER_DATABASE.get(userId).lastMessageId = joinMsg.message_id;
        return; 
    }

    // Clear any previous multi-step state before starting a new command
    if (msg.text && (msg.text.startsWith('/getlink') || msg.text.startsWith('/batch') || msg.text.startsWith('/custom_batch'))) {
        USER_STATE.delete(userId);
    }

    await handler(msg);
}

// ============================================
// BOT COMMANDS - START
// ============================================

bot.onText(/\/start/, (msg) => checkMembershipAndProceed(msg, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name;
    const userId = msg.from.id;
    
    USER_STATE.delete(userId);

    const welcomeText = `
🎬 <b>Welcome to BeatAnimes Link Generator!</b>

*${firstName}*, I'm here to help you create _permanent streaming links_ for your videos! 🚀

<b>✨ Features:</b>
✅ **Streamable Links** (Permanent)
✅ **Direct Links** (Channel Forward)
✅ Batch and Custom Link Generation
✅ User Limits (Normal/Premium)
✅ Analytics and Tracking

<b>🎯 Quick Start:</b>
Send me any video file for a **Streamable Link**, or use the Direct Link menu below!

<b>👥 Users:</b> ${ANALYTICS.totalUsers}
<b>📁 Links:</b> ${ANALYTICS.totalFiles}
<b>👁️ Total Views:</b> ${ANALYTICS.totalViews}
    `;
    
    const keyboard = getMainKeyboard(isAdmin(userId));
    
    const options = {
        caption: welcomeText,
        parse_mode: 'HTML',
        reply_markup: keyboard
    };

    if (WELCOME_PHOTO_ID) {
        try {
            await deletePreviousMessage(chatId, userId);
            const sentMessage = await bot.sendPhoto(chatId, WELCOME_PHOTO_ID, options);
            USER_DATABASE.get(userId).lastMessageId = sentMessage.message_id;
        } catch (error) {
            // Fallback to text if photo fails
            await sendNewMessage(chatId, userId, welcomeText, { reply_markup: keyboard });
        }
    } else {
        await sendNewMessage(chatId, userId, welcomeText, { reply_markup: keyboard });
    }
}));


// ============================================
// DIRECT LINK COMMANDS
// ============================================

bot.onText(/\/getlink/, (msg) => checkMembershipAndProceed(msg, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    const limitCheck = canGenerateLink(userId);
    if (!limitCheck.allowed) {
        return sendNewMessage(chatId, userId, `❌ **Link Generation Failed**\nYou have reached your limit of **${limitCheck.limit}** links.`, { parse_mode: 'Markdown' });
    }

    USER_STATE.set(userId, { step: 'awaiting_single_msg', data: {} });
    await sendNewMessage(chatId, userId, '➡️ **Mode: Single Direct Link**\n\n**Action:** Forward the message from your channel to me now, or paste the message link/ID.', { parse_mode: 'Markdown' });
}));

bot.onText(/\/batch/, (msg) => checkMembershipAndProceed(msg, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    const limitCheck = canGenerateLink(userId);
    if (!limitCheck.allowed) {
        return sendNewMessage(chatId, userId, `❌ **Link Generation Failed**\nYou have reached your limit of **${limitCheck.limit}** links.`, { parse_mode: 'Markdown' });
    }

    USER_STATE.set(userId, { step: 'awaiting_batch_start', data: {} });
    await sendNewMessage(chatId, userId, '➡️ **Mode: Message Range Batch**\n\n**Action:** Send the **Message ID** of the **first** post in your range.', { parse_mode: 'Markdown' });
}));

bot.onText(/\/custom_batch/, (msg) => checkMembershipAndProceed(msg, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    const limitCheck = canGenerateLink(userId);
    if (!limitCheck.allowed) {
        return sendNewMessage(chatId, userId, `❌ **Link Generation Failed**\nYou have reached your limit of **${limitCheck.limit}** links.`, { parse_mode: 'Markdown' });
    }

    USER_STATE.set(userId, { step: 'awaiting_custom_msgs', data: { messageIds: [] } });
    await sendNewMessage(chatId, userId, '➡️ **Mode: Custom Message Batch**\n\n**Action:** Forward all the messages you want to include, one by one. Send the command `/done` when finished.', { parse_mode: 'Markdown' });
}));

// ============================================
// DIRECT LINK GENERATION FUNCTION
// ============================================
async function generateDirectLink(msg, messageIds, batchType) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    USER_STATE.delete(userId);
    
    if (messageIds.length === 0) {
        return sendNewMessage(chatId, userId, '❌ No messages found to link! Please try again.', { parse_mode: 'Markdown' });
    }

    const uniqueId = generateUniqueId();
    
    FILE_DATABASE.set(uniqueId, {
        linkType: 'DIRECT',
        batchType: batchType,
        messageIds: messageIds,
        channelId: CHANNEL_ID,
        uploadedBy: userId,
        uploaderName: msg.from.first_name,
        createdAt: Date.now(),
        views: 0,
        lastAccessed: Date.now()
    });
    
    USER_DATABASE.get(userId).totalUploads++;
    ANALYTICS.totalFiles++;
    
    const directLink = `${WEBAPP_URL}/direct/${uniqueId}`;
    
    const successText = `
✅ <b>Direct Link Generated Successfully!</b>

🔗 <b>Link Type:</b> Channel Forward (${batchType.replace('_', ' ')})
🆔 <b>Unique ID:</b> <code>${uniqueId}</code>
🔢 <b>Messages:</b> ${messageIds.length}
`;

    const instructionsText = `
⚠️ <b>How to Use:</b>

1. Click the **"Open Direct Link"** button below.
2. You will be redirected to the bot with a special command.
3. The bot will automatically forward the messages from the channel.

<b>Important:</b> This link must be opened in a Telegram client to work.
    `;
    
    await sendNewMessage(chatId, userId, successText, { parse_mode: 'HTML' });
    await sendNewMessage(chatId, userId, instructionsText, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: {
            inline_keyboard: [
                [
                    { text: '🔗 Open Direct Link', url: directLink }
                ],
                [
                    { text: '📋 Copy Telegram Deep Link', callback_data: `copy_tg_link_${uniqueId}` }
                ]
            ]
        }
    });
}


// ============================================
// FORWARDING HANDLER (Activated by Telegram Deep Link)
// ============================================
bot.onText(/\/start fwd_([a-zA-Z0-9]+)/, async (msg, match) => {
    const uniqueId = match[1];
    const chatId = msg.chat.id;
    const fileData = FILE_DATABASE.get(uniqueId);
    
    if (!fileData || fileData.linkType !== 'DIRECT') {
        return sendNewMessage(chatId, chatId, '❌ Invalid or expired Direct Link ID.', { parse_mode: 'Markdown' });
    }

    try {
        await sendNewMessage(chatId, chatId, `➡️ **Processing Direct Link for ${fileData.messageIds.length} messages...**`, { parse_mode: 'Markdown' });
        
        fileData.views++;
        fileData.lastAccessed = Date.now();
        ANALYTICS.totalViews++;

        for (const messageId of fileData.messageIds) {
            try {
                await bot.forwardMessage(
                    chatId,
                    fileData.channelId,
                    messageId
                );
                await sleep(100); 
            } catch (e) {
                await bot.sendMessage(chatId, `⚠️ Could not forward message ID ${messageId} (It might be deleted or restricted).`);
            }
        }

        await bot.sendMessage(chatId, '✅ **Forwarding complete!**', { parse_mode: 'Markdown' });

    } catch (error) {
        await bot.sendMessage(chatId, '❌ An unexpected error occurred during forwarding.');
    }
});


// ============================================
// MAIN MESSAGE HANDLER (STATE & STREAMABLE LINK)
// ============================================

bot.on('message', (msg) => checkMembershipAndProceed(msg, async (msg) => {
    if (msg.text && msg.text.startsWith('/')) return; // Ignore commands
    
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userState = USER_STATE.get(userId);

    // --- 1. HANDLE MULTI-STEP STATE (Direct Link Creation) ---
    if (userState) {
        // Handle /done command for custom batch
        if (msg.text && msg.text.startsWith('/done') && userState.step === 'awaiting_custom_msgs') {
            return generateDirectLink(msg, userState.data.messageIds, 'CUSTOM_BATCH');
        }

        // State: Awaiting single message ID (/getlink)
        if (userState.step === 'awaiting_single_msg') {
            const messageId = msg.forward_from_message_id || parseInt(msg.text);
            if (!messageId || isNaN(messageId)) {
                return sendNewMessage(chatId, userId, '⚠️ Please send a valid message ID or forward a message from your channel.', { parse_mode: 'Markdown' });
            }
            return generateDirectLink(msg, [messageId], 'SINGLE_MSG');
        }

        // State: Awaiting batch start ID (/batch)
        if (userState.step === 'awaiting_batch_start') {
            const startId = parseInt(msg.text);
            if (!startId || isNaN(startId)) {
                return sendNewMessage(chatId, userId, '⚠️ Please send a valid message ID for the **first** post.', { parse_mode: 'Markdown' });
            }
            userState.data.startId = startId;
            userState.step = 'awaiting_batch_end';
            return sendNewMessage(chatId, userId, '✅ Start ID saved. Now send the **Message ID** of the **last** post in your range.', { parse_mode: 'Markdown' });
        }

        // State: Awaiting batch end ID (/batch)
        if (userState.step === 'awaiting_batch_end') {
            const endId = parseInt(msg.text);
            const startId = userState.data.startId;

            if (!endId || isNaN(endId) || endId <= startId) {
                return sendNewMessage(chatId, userId, `⚠️ Please send a valid message ID for the **last** post that is greater than ${startId}.`, { parse_mode: 'Markdown' });
            }

            const messageIds = [];
            for (let i = startId; i <= endId; i++) {
                messageIds.push(i);
            }
            return generateDirectLink(msg, messageIds, 'RANGE_BATCH');
        }

        // State: Awaiting custom messages (/custom_batch)
        if (userState.step === 'awaiting_custom_msgs') {
            const messageId = msg.forward_from_message_id || parseInt(msg.text);

            if (!messageId || isNaN(messageId)) {
                return bot.sendMessage(chatId, `⚠️ Send a valid message ID or forward a message. Currently saved: ${userState.data.messageIds.length}. Send \`/done\` when finished.`, { parse_mode: 'Markdown' });
            }

            if (!userState.data.messageIds.includes(messageId)) {
                 userState.data.messageIds.push(messageId);
            }
            
            return bot.sendMessage(chatId, `✅ Saved Message ID: ${messageId}. Total saved: ${userState.data.messageIds.length}. Send another or use \`/done\`.`, { parse_mode: 'Markdown' });
        }
        
        USER_STATE.delete(userId);
    }
    
    // --- 2. HANDLE STREAMABLE LINK GENERATION (Default: Upload) ---
    const file = msg.video || msg.document || msg.video_note;
    if (!file) return;

    const limitCheck = canGenerateLink(userId);
    if (!limitCheck.allowed) {
        return sendNewMessage(chatId, userId, `❌ **Link Generation Failed**\nYou have reached your limit of **${limitCheck.limit}** links.`, { parse_mode: 'Markdown' });
    }
    
    try {
        const fileId = file.file_id;
        const fileUniqueId = file.file_unique_id;
        const fileName = file.file_name || `video_${fileUniqueId}.mp4`;
        const fileSize = file.file_size || 0;
        
        const processingMsg = await sendNewMessage(chatId, userId, '⏳ <b>Processing your video...</b>\n\n🔄 Generating permanent link...', {
            parse_mode: 'HTML'
        });
        
        await sleep(1000);
        
        const uniqueId = generateUniqueId();
        
        FILE_DATABASE.set(uniqueId, {
            linkType: 'STREAMABLE',
            fileId: fileId,
            fileUniqueId: fileUniqueId,
            fileName: fileName,
            fileSize: fileSize,
            uploadedBy: userId,
            uploaderName: msg.from.first_name,
            chatId: chatId,
            createdAt: Date.now(),
            views: 0,
            downloads: 0,
            lastAccessed: Date.now()
        });
        
        USER_DATABASE.get(userId).totalUploads++;
        ANALYTICS.totalFiles++;
        
        const streamLink = `${WEBAPP_URL}/stream/${uniqueId}`;
        const downloadLink = `${WEBAPP_URL}/download/${uniqueId}`;
        const embedCode = `<video src="${streamLink}" controls preload="metadata"></video>`;
        
        const successText = `
✅ <b>Permanent Streamable Link Generated!</b>

📁 <b>File Name:</b> ${fileName}
💾 <b>File Size:</b> ${formatFileSize(fileSize)}
🆔 <b>Unique ID:</b> <code>${uniqueId}</code>

🔗 <b>Streaming Link:</b>
<code>${streamLink}</code>

⬇️ <b>Download Link:</b>
<code>${downloadLink}</code>

📺 <b>Embed Code (HTML):</b>
<code>${embedCode}</code>

<b>✨ This link is PERMANENT and will NEVER expire!</b>
        `;
        
        await bot.deleteMessage(chatId, processingMsg.message_id);
        
        await sendNewMessage(chatId, userId, successText, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔗 Open Stream', url: streamLink },
                        { text: '⬇️ Download', url: downloadLink }
                    ],
                    [
                        { text: '📊 View Stats', callback_data: `file_stats_${uniqueId}` }
                    ]
                ]
            }
        });
        
    } catch (error) {
        await sendNewMessage(chatId, userId, '❌ <b>Error generating link.</b>\n\nPlease try again or contact admin.', {
            parse_mode: 'HTML'
        });
    }
}));


// ============================================
// CALLBACK QUERY HANDLER (Full Implementation)
// ============================================

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;
    
    // --- SPECIAL CALLBACKS (No Delete/Gating) ---
    if (data === 'check_join') {
        const memberStatus = await isMember(userId);
        if (memberStatus) {
            await bot.answerCallbackQuery(query.id, { text: '✅ Access Granted! Starting the bot...', show_alert: true });
            bot.emit('message', { ...query.message, text: '/start', from: query.from, chat: { id: chatId } });
        } else {
            await bot.answerCallbackQuery(query.id, { text: '❌ Still not joined. Please join the channel first.', show_alert: true });
        }
        return;
    }
    
    if (data.startsWith('copy_tg_link_')) {
        const uniqueId = data.substring(13);
        const tgLink = `tg://resolve?domain=${BOT_USERNAME}&start=fwd_${uniqueId}`;
        await bot.answerCallbackQuery(query.id, {
            text: `📋 Copied Deep Link:\n${tgLink}`,
            show_alert: true
        });
        return;
    }
    
    // --- GATED CALLBACKS (Require Membership and Auto-Delete) ---
    const memberStatus = await isMember(userId);
    if (!memberStatus) {
        await bot.answerCallbackQuery(query.id, { text: '❌ Please join the channel first to continue!', show_alert: true });
        return;
    }
    await deletePreviousMessage(chatId, userId); 

    try {
        // --- Navigation / Menu Callbacks ---
        if (data === 'start') {
            bot.emit('message', { ...query.message, text: '/start', from: query.from, chat: { id: chatId } });
        }
        else if (data === 'direct_link_menu') {
             await sendNewMessage(chatId, userId, '🔗 **Direct Link Generation Menu**\n\nChoose a mode to generate a link that forwards messages directly from the source channel:', {
                parse_mode: 'Markdown',
                reply_markup: getDirectLinkMenuKeyboard()
            });
        }
        else if (data === 'admin_panel' && isAdmin(userId)) {
            const totalUsers = USER_DATABASE.size;
            const totalFiles = FILE_DATABASE.size;
            const adminText = `
👑 <b>Admin Panel</b>

Welcome Admin! Here you can manage the bot.

📊 Quick Stats:
• Users: ${totalUsers}
• Files: ${totalFiles}
• Views: ${ANALYTICS.totalViews}
• Downloads: ${ANALYTICS.totalDownloads}

Choose an option below:
            `;
            await sendNewMessage(chatId, userId, adminText, { reply_markup: getAdminKeyboard() });
        }
        
        // --- Link Generation Sub-menu (Emits Command) ---
        else if (data === 'start_getlink') {
            bot.emit('text', `/getlink`, query.message);
        }
        else if (data === 'start_batch') {
            bot.emit('text', `/batch`, query.message);
        }
        else if (data === 'start_custom_batch') {
            bot.emit('text', `/custom_batch`, query.message);
        }
        
        // --- User Stats ---
        else if (data === 'my_stats') {
            const user = registerUser(userId);
            const stats = getUserStats(userId);
            const statsText = `
📊 <b>Your Statistics</b>

👤 <b>Name:</b> ${user.firstName}
🆔 <b>User ID:</b> <code>${userId}</code>
📅 <b>Joined:</b> ${formatDate(user.joinedAt)}
✨ <b>Tier:</b> ${user.userType}

📁 <b>Total Links:</b> ${stats.files}
👁️ <b>Total Views:</b> ${stats.views}

            `;
            await sendNewMessage(chatId, userId, statsText, {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔙 Back', callback_data: 'start' }
                    ]]
                }
            });
        }
        
        // --- User Files ---
        else if (data === 'my_files') {
            let fileList = '📁 <b>Your Links:</b>\n\n';
            const buttons = [];
            let count = 0;
            
            for (const [id, fileData] of FILE_DATABASE.entries()) {
                if (fileData.uploadedBy === userId) {
                    count++;
                    const type = fileData.linkType === 'STREAMABLE' ? 'Stream' : 'Direct';
                    fileList += `${count}. [${type}] ${fileData.fileName || fileData.batchType}\n`;
                    fileList += `   👁️ ${fileData.views} views\n`;
                    fileList += `   🆔 <code>${id}</code>\n\n`;
                    
                    buttons.push([
                        { text: `📄 ${fileData.fileName || fileData.batchType}`, callback_data: `file_${id}` }
                    ]);
                }
            }
            
            if (count === 0) {
                fileList = '📭 You haven\'t generated any links yet.';
            } 
            
            buttons.push([{ text: '🔙 Back', callback_data: 'start' }]);
            
            await sendNewMessage(chatId, userId, fileList, {
                reply_markup: { inline_keyboard: buttons }
            });
        }
        
        // --- File Details ---
        else if (data.startsWith('file_')) {
            const fileId = data.substring(5);
            const fileData = FILE_DATABASE.get(fileId);

            if (!fileData) {
                return bot.answerCallbackQuery(query.id, { text: '❌ Link not found!', show_alert: true });
            }
            
            const typeInfo = fileData.linkType === 'DIRECT' ? `Batch Type: ${fileData.batchType}\nMessages: ${fileData.messageIds.length}` : `Size: ${formatFileSize(fileData.fileSize)}`;

            const fileText = `
📁 <b>Link Details</b>

<b>Type:</b> ${fileData.linkType}
<b>Name:</b> ${fileData.fileName || fileData.batchType}
${typeInfo}
<b>ID:</b> <code>${fileId}</code>
<b>Generated:</b> ${formatDate(fileData.createdAt)}
<b>Views:</b> ${fileData.views}
            `;
            
            await sendNewMessage(chatId, userId, fileText, {
                reply_markup: getFileActionsKeyboard(fileId)
            });
        }

        // --- Delete File ---
        else if (data.startsWith('delete_file_')) {
            const fileId = data.substring(12);
            const fileData = FILE_DATABASE.get(fileId);

            if (!fileData || (!isAdmin(userId) && fileData.uploadedBy !== userId)) {
                 return bot.answerCallbackQuery(query.id, { text: '❌ Not authorized to delete!', show_alert: true });
            }

            FILE_DATABASE.delete(fileId);
            ANALYTICS.totalFiles--;
            
            await bot.answerCallbackQuery(query.id, {
                text: `🗑️ Link deleted successfully!`,
                show_alert: true
            });

            bot.emit('callback_query', { ...query, data: 'my_files' });
        }
        
        // --- Admin Commands (Placeholder, extend as needed) ---
        else if (data === 'admin_stats' && isAdmin(userId)) {
             const statsText = `
📊 <b>Detailed Statistics</b>

👥 <b>Users:</b> ${USER_DATABASE.size}
📁 <b>Total Files/Links:</b> ${FILE_DATABASE.size}
👁️ <b>Total Views:</b> ${ANALYTICS.totalViews}
        `;
            await sendNewMessage(chatId, userId, statsText, {
                reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_panel' }]] }
            });
        }
        
        // --- General Answer ---
        else {
            await bot.answerCallbackQuery(query.id, { text: 'Processing...' });
        }
        
    } catch (error) {
        await bot.answerCallbackQuery(query.id, {
            text: '❌ Error processing request',
            show_alert: true
        });
    }
});


// ============================================
// ADMIN COMMANDS
// ============================================

bot.onText(/\/admin/, (msg) => checkMembershipAndProceed(msg, async (msg) => {
    if (!isAdmin(msg.from.id)) {
        return sendNewMessage(msg.chat.id, msg.from.id, '❌ You are not authorized!', { parse_mode: 'Markdown' });
    }
    
    const adminText = `
👑 <b>Admin Panel</b>

Choose an option:
    `;
    
    await sendNewMessage(msg.chat.id, msg.from.id, adminText, {
        reply_markup: getAdminKeyboard()
    });
}));

// Broadcast command (Simplified, no state needed)
bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    if (!isAdmin(msg.from.id)) return;
    
    const message = match[1];
    let sent = 0;
    let failed = 0;
    
    const statusMsg = await bot.sendMessage(msg.chat.id, '📢 Broadcasting...');
    
    for (const user of USER_DATABASE.values()) {
        try {
            await bot.sendMessage(user.userId, message, { parse_mode: 'HTML' });
            sent++;
        } catch (error) {
            failed++;
        }
        await sleep(100); 
    }
    
    await bot.editMessageText(`✅ Broadcast complete!\n\nSent: ${sent}\nFailed: ${failed}`, {
        chat_id: msg.chat.id,
        message_id: statusMsg.message_id
    });
});


// ============================================
// HELPER: Get fresh Telegram file URL
// ============================================
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
        throw new Error('Failed to get file from Telegram');
    }
}


// ============================================
// EXPRESS SERVER
// ============================================
const app = express();

app.use(express.json());
// ... (static files, CORS setup) ...

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Range, Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Home page - Beautiful landing (Simplified HTML structure for size)
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>BeatAnimes Link Generator</title>
</head>
<body>
    <div class="container">
        <h1>🎬 BeatAnimes Link Generator</h1>
        <p>Generate Permanent Streaming and Direct Links for Your Videos.</p>
        <div class="stats">
            <p>Users: ${ANALYTICS.totalUsers}</p>
            <p>Links: ${ANALYTICS.totalFiles}</p>
            <p>Views: ${ANALYTICS.totalViews}</p>
        </div>
        <p>Start the bot on Telegram to upload files.</p>
        <a href="https://t.me/${BOT_USERNAME}">Start Bot</a>
    </div>
</body>
</html>
    `);
});

// Health check
app.get('/ping', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        files: FILE_DATABASE.size,
        users: USER_DATABASE.size,
        views: ANALYTICS.totalViews,
        downloads: ANALYTICS.totalDownloads
    });
});

// Stream video with range support (Handles STREAMABLE links)
app.get('/stream/:id', async (req, res) => {
    const fileId = req.params.id;
    const fileData = FILE_DATABASE.get(fileId);
    
    if (!fileData || fileData.linkType !== 'STREAMABLE') {
        return res.status(404).send('File not found or link type mismatch');
    }
    
    try {
        fileData.views++;
        fileData.lastAccessed = Date.now();
        ANALYTICS.totalViews++;
        
        const fileUrl = await getFreshFileUrl(fileData);
        const range = req.headers.range;
        
        const response = await fetch(fileUrl, range ? { headers: { 'Range': range } } : {});

        if (!response.ok) throw new Error('Failed to fetch');
            
        if (range) {
            res.status(206);
            res.setHeader('Content-Range', response.headers.get('content-range'));
            res.setHeader('Content-Length', response.headers.get('content-length'));
        } else {
            res.setHeader('Content-Length', fileData.fileSize);
        }

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=3600');
            
        response.body.pipe(res);
        
    } catch (error) {
        res.status(500).send('Error streaming file');
    }
});


// Direct Link Handler (Redirects to Telegram Bot)
app.get('/direct/:id', (req, res) => {
    const uniqueId = req.params.id;
    const fileData = FILE_DATABASE.get(uniqueId);
    
    if (!fileData || fileData.linkType !== 'DIRECT') {
        return res.status(404).send('Direct Link not found or invalid.');
    }

    const telegramDeepLink = `tg://resolve?domain=${BOT_USERNAME}&start=fwd_${uniqueId}`;
    res.redirect(telegramDeepLink);
});

// Download video
app.get('/download/:id', async (req, res) => {
    const fileId = req.params.id;
    const fileData = FILE_DATABASE.get(fileId);
    
    if (!fileData || fileData.linkType !== 'STREAMABLE') {
        return res.status(404).send('File not found or link type mismatch');
    }
    
    try {
        fileData.downloads++;
        ANALYTICS.totalDownloads++;
        
        const fileUrl = await getFreshFileUrl(fileData);
        const response = await fetch(fileUrl);
        
        if (!response.ok) throw new Error('Failed to fetch');
        
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${fileData.fileName}"`);
        res.setHeader('Content-Length', fileData.fileSize);
        
        response.body.pipe(res);
    } catch (error) {
        res.status(500).send('Error downloading file');
    }
});


// ============================================
// UTILITY FUNCTIONS
// ============================================

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
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}


// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
    console.log('═══════════════════════════════════════');
    console.log('🎬 BeatAnimes Link Generator Bot');
    console.log('═══════════════════════════════════════');
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📡 URL: ${WEBAPP_URL}`);
    console.log(`🤖 Bot Username: ${BOT_USERNAME}`);
    console.log(`👑 Admins: ${ADMIN_IDS.length}`);
    console.log('═══════════════════════════════════════');
});

// Graceful shutdown and cache cleanup (omitted for brevity, but recommended in a real deployment)
