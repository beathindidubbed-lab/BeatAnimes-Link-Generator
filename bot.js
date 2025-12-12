// ============================================
// ULTIMATE TELEGRAM PERMANENT LINK BOT
// New Features: Universal Broadcast (Interval/Media), Expiration Countdown, Admin Health Tools
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

// Admin Configuration
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id)) : [];
const WELCOME_PHOTO_ID = process.env.WELCOME_PHOTO_ID || null; 
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@YourChannel'; 
const BOT_USERNAME = process.env.BOT_USERNAME || 'YourBotUsername'; 

// Mandatory Channel ID for Force Join Gate
const CHANNEL_ID = process.env.CHANNEL_ID || -1001234567890; 

// Link Limits Configuration
const LINK_LIMITS = {
    NORMAL: 10,  
    PREMIUM: 50, 
    ADMIN: Infinity 
};

// File expiration time for NORMAL users (30 days)
const NORMAL_USER_EXPIRY = 30 * 24 * 60 * 60 * 1000; 

// NEW: Broadcast Interval (Crucial for Render Free Tier)
const BROADCAST_INTERVAL_MS = 3000; // Send 1 message every 3 seconds

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN is required!');
    process.exit(1);
}

// ============================================
// DATABASE & STATE
// ============================================
const FILE_DATABASE = new Map();
const USER_DATABASE = new Map();
const URL_CACHE = new Map();
const URL_CACHE_DURATION = 23 * 60 * 60 * 1000;
const USER_STATE = new Map(); 

// NEW: Broadcast queue and status
const BROADCAST_STATUS = {
    isSending: false,
    queue: [],
    sourceChatId: null,
    sourceMessageId: null,
    keyboard: null,
    sentCount: 0,
    failedCount: 0,
    jobInterval: null
};

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

console.log('✅ Bot started successfully!');

// ============================================
// HELPER FUNCTIONS
// ============================================

function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

// ... (checkMembership, registerUser, getUserStats, canGenerateLink remain the same) ...

/**
 * Checks if a file is permanent or expired based on user type and age.
 * @param {string} fileId 
 * @returns {boolean}
 */
function isFilePermanent(fileId) {
    const file = FILE_DATABASE.get(fileId);
    if (!file) return false;

    const uploader = USER_DATABASE.get(file.uploadedBy);
    const uploaderType = uploader ? uploader.userType : 'NORMAL';

    if (uploaderType === 'PREMIUM' || uploaderType === 'ADMIN') {
        return true; 
    }

    return (Date.now() - file.createdAt) < NORMAL_USER_EXPIRY;
}

/**
 * Formats the remaining time until expiration.
 * @param {number} timestamp 
 * @returns {string}
 */
function formatRemainingTime(timestamp) {
    const remainingMs = NORMAL_USER_EXPIRY - (Date.now() - timestamp);
    if (remainingMs <= 0) return 'Expired';
    
    const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
    const hours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h`;
}


// ============================================
// KEYBOARD LAYOUTS
// ============================================

// ... (getForceJoinKeyboard, getMainKeyboard, getUserRowButtons remain the same) ...

function getAdminKeyboard() {
    // NEW: Added admin_trigger_cleanup
    const isBroadcasting = BROADCAST_STATUS.isSending;
    const broadcastText = isBroadcasting ? `⏳ Broadcast in Progress (${BROADCAST_STATUS.sentCount}/${BROADCAST_STATUS.queue.length})` : '📢 Universal Broadcast';

    return {
        inline_keyboard: [
            [
                { text: '📊 Statistics', callback_data: 'admin_stats' },
                { text: '👥 Manage Users', callback_data: 'admin_users_1' } 
            ],
            [
                { text: broadcastText, callback_data: isBroadcasting ? 'admin_stop_broadcast' : 'admin_broadcast_start' }, 
                { text: '🧹 Cleanup Links/Cache', callback_data: 'admin_trigger_cleanup' } // NEW
            ],
            [
                { text: '🔙 Back', callback_data: 'start' }
            ]
        ]
    };
}

// MODIFIED: Added file expiry status/countdown
function getFileActionsKeyboard(fileId, userType) {
    const file = FILE_DATABASE.get(fileId);
    
    if (!file) return { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'my_files' }]] };

    const streamLink = `${WEBAPP_URL}/stream/${file.customAlias || fileId}`;
    const downloadLink = `${WEBAPP_URL}/download/${file.customAlias || fileId}`;
    const isPermanent = isFilePermanent(fileId);
    
    let statusRow = [];
    if (isPermanent) {
        statusRow.push({ text: '✨ Permanent Link', callback_data: 'ignore' });
    } else {
        const remainingTime = formatRemainingTime(file.createdAt);
        statusRow.push({ text: `⚠️ Expires in ${remainingTime}`, callback_data: 'premium_info' });
    }

    const aliasButton = [];
    if (userType === 'PREMIUM' || userType === 'ADMIN') {
        const alias = file.customAlias ? `🏷️ ${file.customAlias}` : '🏷️ Set Custom Alias';
        aliasButton.push({ text: alias, callback_data: `alias_file_${fileId}` });
    }

    return {
        inline_keyboard: [
            statusRow, 
            [
                { text: '🔗 Open Stream', url: streamLink },
                { text: '⬇️ Download', url: downloadLink }
            ],
            [
                { text: '📊 Stats', callback_data: `file_stats_${fileId}` },
                { text: '🗑️ Delete', callback_data: `delete_file_${fileId}` }
            ],
            [
                { text: '📝 Rename', callback_data: `rename_file_${fileId}` }, 
                ...aliasButton 
            ],
            [
                { text: '🔙 Back', callback_data: 'my_files' }
            ]
        ]
    };
}

// ============================================
// BROADCAST JOB FUNCTION
// ============================================

/**
 * Manages the interval-based, batched sending of broadcast messages.
 */
function startBroadcastJob(chatId, messageId) {
    if (BROADCAST_STATUS.isSending) return;

    BROADCAST_STATUS.isSending = true;
    BROADCAST_STATUS.sourceChatId = chatId;
    BROADCAST_STATUS.sourceMessageId = messageId;
    BROADCAST_STATUS.queue = Array.from(USER_DATABASE.keys()).filter(id => !isAdmin(id)); // Target all non-admins
    BROADCAST_STATUS.sentCount = 0;
    BROADCAST_STATUS.failedCount = 0;

    const totalUsers = BROADCAST_STATUS.queue.length;
    
    const intervalHandler = setInterval(async () => {
        if (BROADCAST_STATUS.queue.length === 0) {
            clearInterval(BROADCAST_STATUS.jobInterval);
            BROADCAST_STATUS.isSending = false;
            
            // Send final report
            bot.sendMessage(chatId, `✅ **Broadcast Complete!**\n\nTotal Users: ${totalUsers}\nSent: ${BROADCAST_STATUS.sentCount}\nFailed: ${BROADCAST_STATUS.failedCount}`, { parse_mode: 'Markdown' });
            return;
        }

        const targetId = BROADCAST_STATUS.queue.shift();
        
        try {
            await bot.copyMessage(
                targetId,
                BROADCAST_STATUS.sourceChatId,
                BROADCAST_STATUS.sourceMessageId,
                { reply_markup: BROADCAST_STATUS.keyboard }
            );
            BROADCAST_STATUS.sentCount++;
        } catch (error) {
            BROADCAST_STATUS.failedCount++;
            // Log error, but don't stop the job
        }

        // Optional: Send periodic update to admin
        if (BROADCAST_STATUS.sentCount % 10 === 0 && BROADCAST_STATUS.sentCount > 0) {
            bot.sendMessage(chatId, `⏳ Broadcast Status: ${BROADCAST_STATUS.sentCount} of ${totalUsers} sent.`, { parse_mode: 'Markdown' }).catch(() => {});
        }

    }, BROADCAST_INTERVAL_MS);

    BROADCAST_STATUS.jobInterval = intervalHandler;
}

// ============================================
// MAINTENANCE JOB FUNCTION
// ============================================

/**
 * Executes the cleanup of expired files and URL cache.
 */
function runMaintenanceJob() {
    const now = Date.now();
    let cleanedFiles = 0;
    let cleanedCache = 0;

    // 1. File Expiration Cleanup
    for (const [id, file] of FILE_DATABASE.entries()) {
        const uploader = USER_DATABASE.get(file.uploadedBy);
        const uploaderType = uploader ? uploader.userType : 'NORMAL';

        if (uploaderType === 'NORMAL' && (now - file.createdAt) > NORMAL_USER_EXPIRY) {
            
            FILE_DATABASE.delete(id);
            ANALYTICS.totalFiles--;
            if (uploader) {
                uploader.totalUploads = Math.max(0, uploader.totalUploads - 1);
            }

            cleanedFiles++;

            bot.sendMessage(file.uploadedBy, `🗑️ **Your file has expired!**\n\nThe link for **${file.fileName}** has been removed after 30 days. Your link slot has been reclaimed.\n\nUpgrade to **PREMIUM** to get permanent links!`, {
                parse_mode: 'Markdown'
            }).catch(() => {});
        }
    }

    // 2. URL Cache Cleanup
    for (const [key, value] of URL_CACHE.entries()) {
        if (now - value.timestamp > URL_CACHE_DURATION) {
            URL_CACHE.delete(key);
            cleanedCache++;
        }
    }
    
    return { cleanedFiles, cleanedCache };
}


// ============================================
// CALLBACK QUERY HANDLER (MODIFIED)
// ============================================

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;
    const messageId = query.message.message_id;
    
    const user = USER_DATABASE.get(userId) || registerUser(userId, query.from.username, query.from.first_name);
    
    // ... (Block and Force Join Checks) ...

    if (user.isBlocked) { 
        return bot.answerCallbackQuery(query.id, { text: '❌ You are blocked from using the bot.', show_alert: true }); 
    }
    if (data === 'check_join') {
        const isMember = await checkMembership(userId);
        if (isMember) {
            bot.emit('message', { ...query.message, text: '/start', from: query.from, chat: { id: chatId } });
            return bot.answerCallbackQuery(query.id, { text: '✅ Access Granted! Welcome!', show_alert: true });
        } else {
            return bot.answerCallbackQuery(query.id, { text: '⚠️ Still not a member. Please join and try again.', show_alert: true });
        }
    }
    const isMember = await checkMembership(userId);
    if (!isMember && !isAdmin(userId)) {
        await bot.answerCallbackQuery(query.id, { text: '⚠️ You must join the channel to continue.', show_alert: true });
        return;
    }

    // --- NEW: Initiate Universal Broadcast (Step 1) ---
    else if (data === 'admin_broadcast_start' && isAdmin(userId)) {
        if (BROADCAST_STATUS.isSending) {
             return bot.answerCallbackQuery(query.id, { text: '⏳ A broadcast is currently running. Stop it first.', show_alert: true });
        }
        USER_STATE.set(userId, { state: 'BROADCASTING_SOURCE_AWAITING' });
        await bot.answerCallbackQuery(query.id, { text: 'Forward the message now.' });
        await bot.editMessageText(`📢 **Universal Broadcast Setup**\n\n**Step 1/3:** **FORWARD** the message (text, photo, video, etc.) you want to broadcast to this chat.`, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown'
        });
    }

    // --- NEW: Stop Broadcast Job ---
    else if (data === 'admin_stop_broadcast' && isAdmin(userId)) {
        if (BROADCAST_STATUS.isSending) {
            clearInterval(BROADCAST_STATUS.jobInterval);
            BROADCAST_STATUS.isSending = false;
            BROADCAST_STATUS.queue = [];
            
            await bot.answerCallbackQuery(query.id, { text: '❌ Broadcast job stopped.', show_alert: true });
            
            // Refresh admin panel
            bot.emit('callback_query', { ...query, data: 'admin_panel' });
        } else {
            await bot.answerCallbackQuery(query.id, { text: 'No active broadcast to stop.', show_alert: true });
        }
    }

    // --- NEW: Manual Cleanup Trigger ---
    else if (data === 'admin_trigger_cleanup' && isAdmin(userId)) {
        await bot.answerCallbackQuery(query.id, { text: '🧹 Running cleanup job...', show_alert: true });
        const result = runMaintenanceJob();

        await bot.editMessageText(`🧹 **Maintenance Report**\n\nCleaned ${result.cleanedFiles} expired files.\nCleaned ${result.cleanedCache} expired cache entries.`, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_panel' }]]
            }
        });
    }

    // ... (The rest of the callbacks remain the same)
    
    else if (data === 'admin_stats' && isAdmin(userId)) {
        const totalMemory = process.env.MEMORY_LIMIT || '512MB'; 
        const usedMemory = process.memoryUsage().rss;
        const dbSize = JSON.stringify([...FILE_DATABASE, ...USER_DATABASE]).length;

        const statsText = `
📊 <b>Global Statistics & System Health</b>

<pre>⚠️ Free Tier Warning: In-memory database (Map) is volatile. Data will be lost upon server restart.</pre>

👥 <b>Total Users:</b> ${USER_DATABASE.size}
🏆 <b>Premium Users:</b> ${Array.from(USER_DATABASE.values()).filter(u => u.userType === 'PREMIUM').length}

📁 <b>Total Files:</b> ${ANALYTICS.totalFiles}
👁️ <b>Total Views:</b> ${ANALYTICS.totalViews}

🌐 <b>System Health:</b>
• Uptime: ${formatUptime(process.uptime())}
• Database Size: ${formatFileSize(dbSize)} 
• Memory Usage: ${formatFileSize(usedMemory)} / ${totalMemory}
• Expired Cache Entries: ${URL_CACHE.size}

`;
        
        await bot.editMessageText(statsText, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_panel' }]]
            }
        });
    }

    await bot.answerCallbackQuery(query.id);
});

// ============================================
// MESSAGE HANDLER (MODIFIED for Universal Broadcast)
// ============================================

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const firstName = msg.from.first_name;
    
    const user = registerUser(userId, username, firstName); 
    
    // 1. Block Check
    if (user.isBlocked) { 
        return bot.sendMessage(chatId, '❌ You have been **BLOCKED** by the admin from using this bot.', { parse_mode: 'Markdown' });
    }

    // 2. Admin State Check (Universal Broadcast)
    if (isAdmin(userId) && USER_STATE.has(userId) && USER_STATE.get(userId).state.startsWith('BROADCASTING_')) {
        const stateData = USER_STATE.get(userId);
        
        // Step 1: Receiving the source message
        if (stateData.state === 'BROADCASTING_SOURCE_AWAITING') {
            
            if (!msg.message_id) { // Should not happen with a forwarded message
                 return bot.sendMessage(chatId, '❌ Could not identify the message source. Broadcast cancelled.', { parse_mode: 'Markdown' });
            }

            USER_STATE.set(userId, { 
                state: 'BROADCASTING_KEYBOARD_AWAITING', 
                sourceChatId: msg.chat.id, // Source chat is where the message originated
                sourceMessageId: msg.message_id 
            });

            await bot.sendMessage(chatId, `📢 **Universal Broadcast Setup**\n\n**Step 2/3:** Message source saved! Now send the KEYBOARD layout.\n\nFormat: \`Button Text|Button URL,Button 2 Text|Button 2 URL\`. Send \`NO_KEYBOARD\` if you don't need buttons.`, {
                parse_mode: 'Markdown'
            });
            return;
        }

        // Step 2: Receiving the keyboard definition
        if (stateData.state === 'BROADCASTING_KEYBOARD_AWAITING' && msg.text) {
            const keyboardString = msg.text.trim();
            let keyboard = null;
            
            if (keyboardString.toUpperCase() !== 'NO_KEYBOARD') {
                try {
                    // This parsing must be robust
                    let parsedKeyboard = { inline_keyboard: [] };
                    const rows = keyboardString.split(';'); 
                    rows.forEach(rowString => {
                        const rowButtons = rowString.split(',');
                        const row = rowButtons.map(btnStr => {
                            const parts = btnStr.split('|');
                            if (parts.length !== 2) throw new Error('Invalid button format');
                            return { text: parts[0].trim(), url: parts[1].trim() };
                        });
                        parsedKeyboard.inline_keyboard.push(row);
                    });
                    keyboard = parsedKeyboard;
                } catch (e) {
                    return bot.sendMessage(chatId, '❌ Invalid keyboard format. Try again or send `NO_KEYBOARD`.', { parse_mode: 'Markdown' });
                }
            }

            BROADCAST_STATUS.keyboard = keyboard;

            // Step 3: Confirmation and Execution
            USER_STATE.delete(userId);
            
            const totalUsers = Array.from(USER_DATABASE.keys()).filter(id => !isAdmin(id)).length;

            const confirmText = `
📢 **Broadcast Confirmation**

Total Recipients: **${totalUsers}**
Interval: **${BROADCAST_INTERVAL_MS / 1000} seconds per message** (For Free Tier/Rate Limit Safety)
Keyboard: ${keyboard ? '✅ Attached' : '❌ None'}

Click **START BROADCAST** to begin. Do not restart the server while the broadcast is running!
            `;
            
            await bot.sendMessage(chatId, confirmText, {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🚀 START BROADCAST', callback_data: 'admin_broadcast_execute' }],
                        [{ text: '❌ Cancel', callback_data: 'admin_panel' }]
                    ]
                }
            });
            
            // Set final state for execution
            USER_STATE.set(userId, { 
                state: 'BROADCASTING_PENDING_EXECUTION', 
                sourceChatId: stateData.sourceChatId,
                sourceMessageId: stateData.sourceMessageId
            });
            return;
        }
    }

    // Handle the execution button press
    if (msg.text === 'admin_broadcast_execute' && isAdmin(userId) && USER_STATE.get(userId)?.state === 'BROADCASTING_PENDING_EXECUTION') {
        const stateData = USER_STATE.get(userId);
        USER_STATE.delete(userId);
        
        startBroadcastJob(chatId, stateData.sourceMessageId);
        await bot.sendMessage(chatId, '🚀 **Broadcast started in the background!** Check Admin Panel for status.', { parse_mode: 'Markdown' });
        return;
    }
    
    // 3. State Check (Renaming / Setting Alias)
    if (USER_STATE.has(userId) && msg.text) {
        // ... (Renaming and Alias logic remains the same) ...
        const stateData = USER_STATE.get(userId);
        const file = FILE_DATABASE.get(stateData.fileId);
        
        if (!file) {
            USER_STATE.delete(userId);
            return bot.sendMessage(chatId, '❌ Error: File not found.', { parse_mode: 'Markdown' });
        }

        if (stateData.state === 'RENAMING') {
            const newName = msg.text.trim().substring(0, 60);
            file.fileName = newName;
            USER_STATE.delete(userId);
            await bot.sendMessage(chatId, `✅ File successfully renamed to: **${newName}**`, { parse_mode: 'Markdown' });
            return;
        }

        if (stateData.state === 'SETTING_ALIAS') {
            const alias = msg.text.trim().toLowerCase();
            
            if (alias.length < 3 || alias.length > 30 || !/^[a-z0-9-]+$/.test(alias)) {
                await bot.sendMessage(chatId, '❌ Invalid alias. Must be 3-30 characters, using only a-z, 0-9, and hyphens.', { parse_mode: 'Markdown' });
                return;
            }

            let isUnique = !['stream', 'download', 'api', 'ping', 'admin'].includes(alias);
            if (isUnique) {
                for (const otherFile of FILE_DATABASE.values()) {
                    if (otherFile.customAlias === alias && otherFile.uniqueId !== file.uniqueId) { 
                        isUnique = false;
                        break;
                    }
                }
            }

            if (!isUnique) {
                await bot.sendMessage(chatId, `❌ Alias **${alias}** is already in use or is a reserved word. Choose a different one.`, { parse_mode: 'Markdown' });
                return;
            }

            file.customAlias = alias;
            USER_STATE.delete(userId);
            await bot.sendMessage(chatId, `✅ Custom alias set! Your new stream link is:\n\n<code>${WEBAPP_URL}/stream/${alias}</code>`, { parse_mode: 'HTML', disable_web_page_preview: true });
            return;
        }
    }


    if (msg.text && msg.text.startsWith('/')) return;
    
    // 4. Force Join Check
    const isMember = await checkMembership(userId);
    if (!isMember) {
        return bot.sendMessage(chatId, '⚠️ **ACCESS DENIED**\n\nYou must join our main channel to use this bot.', { 
            parse_mode: 'Markdown',
            reply_markup: getForceJoinKeyboard()
        });
    }
    
    const file = msg.video || msg.document || msg.video_note || msg.photo; // Added photo check for completeness, though stream link usually means video
    
    if (!file) return;

    // 5. Limit Enforcement
    const limitCheck = canGenerateLink(userId);

    if (!limitCheck.allowed) {
        return bot.sendMessage(chatId, `
❌ <b>Link Generation Failed</b>

You have reached your limit of <b>${limitCheck.limit}</b> links for your <b>${limitCheck.userType}</b> tier.
You have used <b>${limitCheck.current}</b> links.

Upgrade to Premium or invite friends to increase your limit!
        `, { parse_mode: 'HTML' });
    }
    
    try {
        // ... (File upload logic remains the same) ...
        const fileId = Array.isArray(file) ? file[file.length - 1].file_id : file.file_id;
        const fileUniqueId = Array.isArray(file) ? file[file.length - 1].file_unique_id : file.file_unique_id;
        const fileName = file.file_name || (msg.caption || `file_${fileUniqueId}.mp4`);
        const fileSize = file.file_size || (Array.isArray(file) ? file[file.length - 1].file_size : 0);
        
        const processingMsg = await bot.sendMessage(chatId, '⏳ <b>Processing your video...</b>', { parse_mode: 'HTML' });
        await sleep(1000);
        
        const uniqueId = generateUniqueId();
        
        FILE_DATABASE.set(uniqueId, {
            uniqueId: uniqueId, // Make sure uniqueId is stored consistently
            fileId: fileId,
            fileUniqueId: fileUniqueId,
            fileName: fileName,
            fileSize: fileSize,
            uploadedBy: userId,
            uploaderName: firstName,
            chatId: chatId,
            createdAt: Date.now(),
            views: 0,
            downloads: 0,
            lastAccessed: Date.now(),
            customAlias: null 
        });
        
        user.totalUploads++;
        ANALYTICS.totalFiles++;
        
        const streamLink = `${WEBAPP_URL}/stream/${uniqueId}`;
        const downloadLink = `${WEBAPP_URL}/download/${uniqueId}`;
        
        await bot.deleteMessage(chatId, processingMsg.message_id);

        const linkStatus = user.userType === 'PREMIUM' || user.userType === 'ADMIN' ? 'PERMANENT' : 'Expires in 30 days.';
        
        const successText = `
✅ <b>Permanent Link Generated Successfully!</b>

📁 <b>File Name:</b> ${fileName}
💾 <b>File Size:</b> ${formatFileSize(fileSize)}
🆔 <b>Unique ID:</b> <code>${uniqueId}</code>

🔗 <b>Streaming Link:</b>
<code>${streamLink}</code>

⬇️ <b>Download Link:</b>
<code>${downloadLink}</code>

<b>✨ Link Status:</b> ${linkStatus}

💡 <i>Your current link count: ${user.totalUploads} / ${limitCheck.limit}</i>
        `;
        
        await bot.sendMessage(chatId, successText, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔗 Open Stream', url: streamLink },
                        { text: '⬇️ Download', url: downloadLink }
                    ],
                    [
                        { text: '📊 View Stats', callback_data: `file_stats_${uniqueId}` },
                        { text: '🗑️ Delete File', callback_data: `delete_file_${uniqueId}` }
                    ],
                    [
                        { text: '📢 Share to Channel', url: `https://t.me/share/url?url=${encodeURIComponent(streamLink)}` }
                    ]
                ]
            }
        });
        
    } catch (error) {
        console.error('❌ Upload error:', error);
        await bot.sendMessage(chatId, '❌ <b>Error generating link.</b>\n\nPlease try again or contact admin.', {
            parse_mode: 'HTML'
        });
    }
});


// ============================================
// MAINTENANCE AND UTILITY FUNCTIONS
// ============================================

// ... (formatUptime, generateUniqueId, formatFileSize, formatDate, sleep, getFreshFileUrl, findFile, Express Server routes remain the same) ...

// Maintenance interval runs every 4 hours
setInterval(() => {
    const result = runMaintenanceJob();
    if (result.cleanedFiles > 0 || result.cleanedCache > 0) {
        console.log(`🧹 Scheduled Maintenance Report: Cleaned ${result.cleanedFiles} expired files and ${result.cleanedCache} cache entries.`);
    }
}, 4 * 60 * 60 * 1000); 

// ... (Rest of the code: Express server, startup logs, shutdown handlers)
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
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
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ... (Rest of the Express and server setup) ...

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
        console.error('❌ Error getting file URL:', error);
        throw new Error('Failed to get file from Telegram');
    }
}

function findFile(lookupId) {
    let fileData = FILE_DATABASE.get(lookupId);

    if (!fileData) {
        for (const data of FILE_DATABASE.values()) {
            if (data.customAlias === lookupId) {
                fileData = data;
                break;
            }
        }
    }
    // Set the uniqueId property for consistency when returning from alias lookup
    if (fileData && !fileData.uniqueId) {
        fileData.uniqueId = lookupId;
    }
    return fileData;
}


// EXPRESS SERVER (Modified to use uniqueId check)
const app = express();

app.use(express.json());
app.use(express.static('public'));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Range, Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>BeatAnimes Link Generator</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
        }
        .container {
            text-align: center;
            padding: 40px;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
            max-width: 600px;
        }
        h1 { font-size: 3em; margin-bottom: 20px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3); }
        p { font-size: 1.2em; margin-bottom: 30px; opacity: 0.9; }
        .stats {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            margin: 30px 0;
        }
        .stat-card {
            background: rgba(255, 255, 255, 0.2);
            padding: 20px;
            border-radius: 10px;
            backdrop-filter: blur(5px);
        }
        .stat-number { font-size: 2em; font-weight: bold; }
        .stat-label { opacity: 0.8; margin-top: 5px; }
        .btn {
            display: inline-block;
            padding: 15px 40px;
            background: white;
            color: #667eea;
            text-decoration: none;
            border-radius: 50px;
            font-weight: bold;
            font-size: 1.1em;
            transition: transform 0.3s;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.2);
        }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3); }
        .features {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 15px;
            margin: 30px 0;
            text-align: left;
        }
        .feature {
            background: rgba(255, 255, 255, 0.15);
            padding: 15px;
            border-radius: 10px;
        }
        .feature-icon { font-size: 2em; margin-bottom: 10px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎬 BeatAnimes</h1>
        <p>Generate Permanent Streaming Links for Your Videos</p>
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-number">${ANALYTICS.totalUsers}</div>
                <div class="stat-label">Users</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${ANALYTICS.totalFiles}</div>
                <div class="stat-label">Files</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${ANALYTICS.totalViews}</div>
                <div class="stat-label">Views</div>
            </div>
        </div>
        
        <div class="features">
            <div class="feature">
                <div class="feature-icon">🔗</div>
                <strong>Permanent Links</strong>
                <p style="opacity: 0.8; margin-top: 5px;">Links that never expire</p>
            </div>
            <div class="feature">
                <div class="feature-icon">⚡</div>
                <strong>Fast Streaming</strong>
                <p style="opacity: 0.8; margin-top: 5px;">Lightning fast delivery</p>
            </div>
            <div class="feature">
                <div class="feature-icon">📊</div>
                <strong>Analytics</strong>
                <p style="opacity: 0.8; margin-top: 5px;">Track your views</p>
            </div>
            <div class="feature">
                <div class="feature-icon">🔒</div>
                <strong>Secure</strong>
                <p style="opacity: 0.8; margin-top: 5px;">Safe and reliable</p>
            </div>
        </div>
        
        <a href="https://t.me/${BOT_USERNAME}" class="btn">Start Using Bot 🚀</a>
        
        <p style="margin-top: 30px; opacity: 0.7; font-size: 0.9em;">
            Join ${CHANNEL_USERNAME} for updates
        </p>
    </div>
</body>
</html>
    `);
});

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

app.get('/stream/:id', async (req, res) => {
    const fileId = req.params.id;
    const fileData = findFile(fileId);
    
    if (!fileData || !isFilePermanent(fileData.uniqueId)) { 
        return res.status(404).send('File not found or has expired.');
    }
    
    try {
        fileData.views++;
        fileData.lastAccessed = Date.now();
        ANALYTICS.totalViews++;
        
        const fileUrl = await getFreshFileUrl(fileData);
        const range = req.headers.range;
        
        if (range) {
            const response = await fetch(fileUrl, { headers: { 'Range': range } });
            if (!response.ok) throw new Error('Failed to fetch');
            
            res.status(206);
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Content-Range', response.headers.get('content-range'));
            res.setHeader('Content-Length', response.headers.get('content-length'));
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            
            response.body.pipe(res);
        } else {
            const response = await fetch(fileUrl);
            if (!response.ok) throw new Error('Failed to fetch');
            
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Content-Disposition', `inline; filename="${fileData.fileName}"`);
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Content-Length', fileData.fileSize);
            res.setHeader('Cache-Control', 'public, max-age=3600');
            
            response.body.pipe(res);
        }
        
    } catch (error) {
        res.status(500).send('Error streaming file');
    }
});

app.get('/download/:id', async (req, res) => {
    const fileId = req.params.id;
    const fileData = findFile(fileId);
    
    if (!fileData || !isFilePermanent(fileData.uniqueId)) { 
        return res.status(404).send('File not found or has expired.');
    }
    
    try {
        fileData.downloads++;
        fileData.lastAccessed = Date.now();
        ANALYTICS.totalDownloads++;
        
        const fileUrl = await getFreshFileUrl(fileData);
        
        const response = await fetch(fileUrl);
        
        if (!response.ok) {
            throw new Error('Failed to fetch file from Telegram');
        }
        
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${fileData.fileName}"`);
        res.setHeader('Content-Length', fileData.fileSize);
        
        response.body.pipe(res);
        
    } catch (error) {
        res.status(500).send('Error downloading file');
    }
});


app.listen(PORT, () => {
    console.log('═══════════════════════════════════════');
    console.log('🎬 BeatAnimes Link Generator Bot');
    console.log('═══════════════════════════════════════');
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📡 URL: ${WEBAPP_URL}`);
    console.log(`👑 Admins: ${ADMIN_IDS.length}`);
    console.log(`🤖 Bot is ready!`);
    console.log('═══════════════════════════════════════');
});

process.on('SIGINT', () => {
    console.log('\n⏸️ Shutting down...');
    if (BROADCAST_STATUS.jobInterval) clearInterval(BROADCAST_STATUS.jobInterval);
    bot.stopPolling();
    process.exit(0);
});
