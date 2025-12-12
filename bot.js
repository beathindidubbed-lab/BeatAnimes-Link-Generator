// ============================================
// ULTIMATE TELEGRAM PERMANENT LINK BOT
// Features: Tiers, Limits, Expiration, Referral, Universal Broadcast, 
//           Universal Auto-Accept Join Requests, Channel Tracking, 
//           Custom Aliases, Full Streaming Logic (Range Support).
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
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@YourChannel'; // Main channel for Force Join

// ID of the mandatory channel for initial access (Bot must be an admin here)
const MANDATORY_CHANNEL_ID = process.env.MANDATORY_CHANNEL_ID || -1001234567890; 

// Link Limits Configuration (Monetization)
const LINK_LIMITS = {
    NORMAL: 10,  
    PREMIUM: 50, 
    ADMIN: Infinity 
};

// File expiration time for NORMAL users (30 days)
const NORMAL_USER_EXPIRY = 30 * 24 * 60 * 60 * 1000; 

// Broadcast Configuration
const BROADCAST_INTERVAL_MS = 3000; // 3 seconds per message delay for safe broadcasting

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN is required! Please set the BOT_TOKEN environment variable.');
    process.exit(1);
}

// ============================================
// DATABASE & STATE (In-memory storage)
// ============================================
const FILE_DATABASE = new Map(); 
const USER_DATABASE = new Map(); 
const CHAT_DATABASE = new Map(); // Stores all non-private chats the bot is in (FOR ADMIN STATS)
const URL_CACHE = new Map(); 
const URL_CACHE_DURATION = 23 * 60 * 60 * 1000; 
const USER_STATE = new Map(); // Tracks multi-step user actions (e.g., renaming, broadcasting)

// Broadcast queue and status
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
// UTILITY FUNCTIONS & CORE LOGIC
// ============================================

function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

function generateUniqueId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function formatRemainingTime(timestamp) {
    const remainingMs = NORMAL_USER_EXPIRY - (Date.now() - timestamp);
    if (remainingMs <= 0) return 'Expired';
    
    const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
    const hours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h`;
}

function registerUser(userId, username, firstName, referrerId = null) {
    if (!USER_DATABASE.has(userId)) {
        USER_DATABASE.set(userId, {
            userId: userId,
            username: username || 'Unknown',
            firstName: firstName || 'User',
            joinedAt: Date.now(),
            totalUploads: 0, 
            lastActive: Date.now(),
            isBlocked: false, 
            userType: 'NORMAL',
            referrerId: referrerId,
            referralBonus: 0
        });
        ANALYTICS.totalUsers++;
    } else {
        const user = USER_DATABASE.get(userId);
        user.lastActive = Date.now();
        if (!user.referrerId && referrerId) {
             user.referrerId = referrerId;
        }
    }
    return USER_DATABASE.get(userId);
}

function getUserType(userId) {
    if (isAdmin(userId)) return 'ADMIN';
    const user = USER_DATABASE.get(userId);
    return user ? user.userType : 'NORMAL'; 
}

function canGenerateLink(userId) {
    const user = USER_DATABASE.get(userId) || { totalUploads: 0, referralBonus: 0 };
    const userType = getUserType(userId);
    if (userType === 'ADMIN') return { allowed: true, limit: LINK_LIMITS.ADMIN, current: user.totalUploads, userType: 'ADMIN' };

    const baseLimit = LINK_LIMITS[userType] || LINK_LIMITS.NORMAL;
    const totalLimit = baseLimit + (user.referralBonus || 0);
    const isAllowed = user.totalUploads < totalLimit;

    return { allowed: isAllowed, limit: totalLimit, current: user.totalUploads, userType: userType };
}

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

function findFile(id) {
    let fileData = FILE_DATABASE.get(id);
    if (!fileData) {
        // Check custom aliases
        for (const data of FILE_DATABASE.values()) {
            if (data.customAlias === id) {
                fileData = data;
                break;
            }
        }
    }
    return fileData;
}

async function checkMembership(userId) {
    if (isAdmin(userId)) return true; 
    try {
        const member = await bot.getChatMember(MANDATORY_CHANNEL_ID, userId);
        const status = member.status;
        return ['member', 'administrator', 'creator'].includes(status); 
    } catch (e) {
        return false; 
    }
}

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
// KEYBOARD & TEXT GENERATION
// ============================================

function getForceJoinKeyboard() {
    return {
        inline_keyboard: [
            [{ text: `📢 Join ${CHANNEL_USERNAME}`, url: `https://t.me/${CHANNEL_USERNAME.replace('@', '')}` }],
            [{ text: '✅ I have joined', callback_data: 'check_join' }]
        ]
    };
}

function getMainKeyboard(isAdmin = false) {
    const keyboard = [
        [
            { text: '📊 My Stats', callback_data: 'my_stats' },
            { text: '📁 My Files', callback_data: 'my_files_0' } // Start at page 0
        ],
        [
            { text: '📖 Bot Help', callback_data: 'help' }, 
            { text: '💎 Upgrade Premium', callback_data: 'premium_info' } 
        ]
    ];
    
    if (isAdmin) {
        keyboard.push([
            { text: '👑 Admin Panel', callback_data: 'admin_panel' }
        ]);
    }
    
    return { inline_keyboard: keyboard };
}

function getAdminKeyboard() {
    const isBroadcasting = BROADCAST_STATUS.isSending;
    const broadcastText = isBroadcasting ? `⏳ Broadcast in Progress` : '📢 Universal Broadcast';

    return {
        inline_keyboard: [
            [
                { text: '📊 Statistics', callback_data: 'admin_stats' },
                { text: '👥 Manage Users', callback_data: 'admin_users_1' } 
            ],
            [
                { text: broadcastText, callback_data: isBroadcasting ? 'admin_stop_broadcast' : 'admin_broadcast_start' }, 
                { text: '🧹 Cleanup Links/Cache', callback_data: 'admin_trigger_cleanup' }
            ],
            [
                { text: '🔙 Back', callback_data: 'start' }
            ]
        ]
    };
}

function getFileActionsKeyboard(fileId, userType) {
    const file = FILE_DATABASE.get(fileId);
    if (!file) return { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'my_files_0' }]] };

    const idOrAlias = file.customAlias || fileId;
    const streamLink = `${WEBAPP_URL}/stream/${idOrAlias}`;
    const downloadLink = `${WEBAPP_URL}/download/${idOrAlias}`;
    const isPermanent = isFilePermanent(fileId);
    
    let statusRow = [];
    if (!isPermanent) {
        const remainingTime = formatRemainingTime(file.createdAt); 
        statusRow.push({ text: `⚠️ Expires in ${remainingTime}`, callback_data: 'premium_info' });
    }

    const aliasButton = [];
    if (userType === 'PREMIUM' || userType === 'ADMIN') {
        const alias = file.customAlias ? `🏷️ Alias: ${file.customAlias}` : '🏷️ Set Custom Alias';
        aliasButton.push({ text: alias, callback_data: `alias_file_${fileId}` });
    }

    return {
        inline_keyboard: [
            statusRow.length > 0 ? statusRow : [], 
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
                { text: '🔙 Back to Files', callback_data: 'my_files_0' }
            ]
        ].filter(row => row.length > 0)
    };
}


// ============================================
// MAINTENANCE & BROADCAST JOBS
// ============================================

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

            bot.sendMessage(file.uploadedBy, `🗑️ **Your file has expired!**\n\nThe link for **${file.fileName}** has been removed after 30 days. Your link slot has been reclaimed.`, {
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

function startBroadcastJob(chatId, sourceMessageId, keyboard) {
    if (BROADCAST_STATUS.isSending) return;

    BROADCAST_STATUS.isSending = true;
    BROADCAST_STATUS.sourceChatId = chatId;
    BROADCAST_STATUS.sourceMessageId = sourceMessageId;
    BROADCAST_STATUS.keyboard = keyboard;
    BROADCAST_STATUS.queue = Array.from(USER_DATABASE.keys())
        .filter(id => !isAdmin(id) && !USER_DATABASE.get(id).isBlocked); 
    BROADCAST_STATUS.sentCount = 0;
    BROADCAST_STATUS.failedCount = 0;

    const totalUsers = BROADCAST_STATUS.queue.length;
    
    bot.sendMessage(chatId, `🚀 **Broadcast started!**\n\nTargeting ${totalUsers} non-admin users. Progress will update automatically.`, { parse_mode: 'Markdown' });

    const intervalHandler = setInterval(async () => {
        if (BROADCAST_STATUS.queue.length === 0) {
            clearInterval(BROADCAST_STATUS.jobInterval);
            BROADCAST_STATUS.isSending = false;
            
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
            // User blocked bot or chat is invalid
            if (error.response && error.response.statusCode === 403) {
                 const user = USER_DATABASE.get(targetId);
                 if (user) user.isBlocked = true; // Mark as blocked for future cleanup
            }
            BROADCAST_STATUS.failedCount++;
        }
    }, BROADCAST_INTERVAL_MS);

    BROADCAST_STATUS.jobInterval = intervalHandler;
}


// ============================================
// FEATURE: UNIVERSAL AUTO-ACCEPT JOIN REQUESTS
// ============================================

bot.on('chat_join_request', async (joinRequest) => {
    const userId = joinRequest.from.id;
    const chatId = joinRequest.chat.id; 
    const firstName = joinRequest.from.first_name;
    const chatTitle = joinRequest.chat.title || 'the channel';

    try {
        await bot.approveChatJoinRequest(chatId, userId);
        
        const welcomeMessage = `
🎉 **Welcome, ${firstName}!**

Your request to join **${chatTitle}** has been automatically approved.
            
**🚀 Start Using the Bot Now:** /start
        `;
        
        await bot.sendMessage(userId, welcomeMessage, { parse_mode: 'Markdown' });
        
        console.log(`✅ Auto-Approved join request for ${firstName} (${userId}) in channel ${chatTitle} (${chatId})`);

    } catch (error) {
        console.error(`❌ Failed to approve join request for ${userId} in ${chatTitle}:`, error.message);
        bot.declineChatJoinRequest(chatId, userId).catch(() => {});
    }
});


// ============================================
// BOT COMMANDS - START & REFERRAL LOGIC
// ============================================

bot.onText(/\/start(?:\s+(\d+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const firstName = msg.from.first_name;
    
    const referrerId = match ? parseInt(match[1]) : null;
    let user = registerUser(userId, username, firstName); 

    // Referral Logic
    if (referrerId && referrerId !== userId && !user.referrerId) {
         user.referrerId = referrerId;
         
         const referrer = USER_DATABASE.get(referrerId);
         if (referrer) {
             referrer.referralBonus = (referrer.referralBonus || 0) + 1; // 1 extra link slot
             bot.sendMessage(referrerId, `🎁 You earned **1 FREE link slot**! **${firstName}** joined using your link.`, { parse_mode: 'Markdown' }).catch(() => {});
         }
    }
    
    if (user.isBlocked) {
         return bot.sendMessage(chatId, '❌ You have been **BLOCKED**...', { parse_mode: 'Markdown' });
    }

    // Force Join Check
    const isMember = await checkMembership(userId);
    if (!isMember) {
        return bot.sendMessage(chatId, '⚠️ **ACCESS DENIED**\n\nYou must join our main channel to use this bot.', { 
            parse_mode: 'Markdown',
            reply_markup: getForceJoinKeyboard()
        });
    }

    const limitCheck = canGenerateLink(userId);
    const welcomeText = `
🎬 <b>Welcome to BeatAnimes Link Generator!</b>

${firstName}, I'm here to help you create <b>permanent streaming links</b> for your videos! 🚀

<b>✨ Your Current Plan: ${getUserType(userId)}</b>
- Links ${limitCheck.userType === 'NORMAL' ? `expire after 30 days.` : 'NEVER expire (Permanent!).'}
- Upload Limit: ${limitCheck.current} / ${limitCheck.limit} (Total limit includes ${user.referralBonus} bonus slots.)

<b>🎯 Quick Start:</b> Just send me any video file!

<b>👥 Users:</b> ${ANALYTICS.totalUsers}
<b>📁 Files:</b> ${ANALYTICS.totalFiles}
    `;
    
    const keyboard = getMainKeyboard(isAdmin(userId));
    
    if (WELCOME_PHOTO_ID) {
        try {
            await bot.sendPhoto(chatId, WELCOME_PHOTO_ID, {
                caption: welcomeText, parse_mode: 'HTML', reply_markup: keyboard
            });
        } catch (error) {
            await bot.sendMessage(chatId, welcomeText, { parse_mode: 'HTML', reply_markup: keyboard });
        }
    } else {
        await bot.sendMessage(chatId, welcomeText, { parse_mode: 'HTML', reply_markup: keyboard });
    }
});


// ============================================
// CALLBACK QUERY HANDLER (Full implementation)
// ============================================

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;
    const messageId = query.message.message_id;
    const user = USER_DATABASE.get(userId) || registerUser(userId, query.from.username, query.from.first_name);

    if (user.isBlocked) { 
        return bot.answerCallbackQuery(query.id, { text: '❌ You are blocked from using the bot.', show_alert: true }); 
    }

    // Force Join Check
    const isMember = await checkMembership(userId);
    if (!isMember && !isAdmin(userId) && data !== 'check_join' && data !== 'start' && data !== 'premium_info') {
        await bot.answerCallbackQuery(query.id, { text: '⚠️ You must join the channel to continue.', show_alert: true });
        return;
    }

    // --- Core Commands ---
    if (data === 'start') {
        try { await bot.deleteMessage(chatId, messageId); } catch (e) { /* Ignore */ }
        bot.emit('message', { ...query.message, text: '/start', from: query.from, chat: { id: chatId } });
        return bot.answerCallbackQuery(query.id);
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
    if (data === 'my_stats') {
        const limitCheck = canGenerateLink(userId);
        const totalViews = Array.from(FILE_DATABASE.values()).filter(f => f.uploadedBy === userId).reduce((sum, f) => sum + f.views, 0);
        const statsText = `
📊 <b>Your Statistics</b>

✨ <b>Your Tier:</b> ${limitCheck.userType}
📁 <b>Your Uploads:</b> ${limitCheck.current} / ${limitCheck.limit}
➕ <b>Referral Bonus Slots:</b> ${user.referralBonus}
📈 <b>Total Views on Your Files:</b> ${totalViews}
        `;
        await bot.editMessageText(statsText, {
            chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'start' }]] }
        });
    }

    // --- My Files List (with Pagination) ---
    const PAGE_SIZE = 5;
    if (data.startsWith('my_files_')) {
        const page = parseInt(data.substring(9)) || 0;
        const myFiles = Array.from(FILE_DATABASE.values()).filter(f => f.uploadedBy === userId);
        const totalPages = Math.ceil(myFiles.length / PAGE_SIZE);
        const filesToShow = myFiles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

        if (myFiles.length === 0) {
            await bot.editMessageText('❌ You have not uploaded any files yet. Send me a video!', {
                chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'start' }]] }
            });
            return;
        }

        const filesList = filesToShow.map((f, i) => `${(page * PAGE_SIZE) + i + 1}. ${f.fileName} (${formatFileSize(f.fileSize)})`).join('\n');
        
        const navigationRow = [];
        if (page > 0) navigationRow.push({ text: '◀️ Prev', callback_data: `my_files_${page - 1}` });
        if (page < totalPages - 1) navigationRow.push({ text: 'Next ▶️', callback_data: `my_files_${page + 1}` });

        await bot.editMessageText(`📁 <b>Your Files</b> (Page ${page + 1} of ${totalPages})\n\n${filesList}`, {
            chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: filesToShow.map(f => ([{ text: f.fileName, callback_data: `file_${f.uniqueId}` }]))
                .concat([navigationRow])
                .concat([[ { text: '🔙 Back', callback_data: 'start' } ]])
            }
        });
    }
    // --- File Details and Actions ---
    else if (data.startsWith('file_stats_')) {
        const fileId = data.substring(11);
        const file = FILE_DATABASE.get(fileId);
        if (!file || file.uploadedBy !== userId) return;

        const statsText = `
📊 <b>Stats for: ${file.fileName}</b>
👁️ Views: ${file.views}
⬇️ Downloads: ${file.downloads}
📅 Uploaded: ${new Date(file.createdAt).toLocaleDateString()}
        `;
        await bot.editMessageText(statsText, {
            chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
            reply_markup: getFileActionsKeyboard(fileId, user.userType)
        });
    }
    else if (data.startsWith('file_')) {
        const fileId = data.substring(5);
        const file = FILE_DATABASE.get(fileId);
        if (!file || file.uploadedBy !== userId) return; // Access denied check
        
        const fileText = `
📁 <b>File Details:</b>
Name: ${file.fileName}
Size: ${formatFileSize(file.fileSize)}
Alias: ${file.customAlias || 'None'}
Views: ${file.views} | Downloads: ${file.downloads}
        `;
        await bot.editMessageText(fileText, {
            chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
            reply_markup: getFileActionsKeyboard(fileId, user.userType)
        });
    }
    else if (data.startsWith('delete_file_')) {
        const fileId = data.substring(12);
        const file = FILE_DATABASE.get(fileId);
        if (!file || file.uploadedBy !== userId) return;
        
        FILE_DATABASE.delete(fileId);
        user.totalUploads = Math.max(0, user.totalUploads - 1);
        ANALYTICS.totalFiles--;

        await bot.answerCallbackQuery(query.id, { text: `✅ File ${file.fileName} deleted. Slot reclaimed.`, show_alert: true });
        bot.emit('callback_query', { ...query, data: 'my_files_0' }); 
    }


    // --- Admin Panel Commands (Full implementation) ---
    else if (data === 'admin_panel' && isAdmin(userId)) {
        const adminText = `
👑 <b>Admin Panel</b>

Welcome Admin!
• Users: ${USER_DATABASE.size}
• Files: ${FILE_DATABASE.size}
• Chats/Channels: ${CHAT_DATABASE.size}

Choose an option below:
        `;
        await bot.editMessageText(adminText, {
            chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
            reply_markup: getAdminKeyboard()
        });
    }
    else if (data === 'admin_stats' && isAdmin(userId)) {
        let totalSize = 0;
        for (const file of FILE_DATABASE.values()) { totalSize += file.fileSize || 0; }
        
        const uptime = process.uptime();
        const statsText = `
📊 <b>Detailed Statistics</b>

👥 <b>Total Users:</b> ${USER_DATABASE.size}
📣 <b>Total Chats/Channels:</b> ${CHAT_DATABASE.size}
📁 <b>Total Files:</b> ${FILE_DATABASE.size}
💾 <b>Total Storage:</b> ${formatFileSize(totalSize)}
👁️ <b>Total Views:</b> ${ANALYTICS.totalViews}
⬇️ <b>Total Downloads:</b> ${ANALYTICS.totalDownloads}
⏱️ <b>Uptime:</b> ${formatUptime(uptime)}
        `;
        
        await bot.editMessageText(statsText, {
            chat_id: chatId, message_id: messageId, parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_panel' }]] }
        });
    }
    else if (data === 'admin_trigger_cleanup' && isAdmin(userId)) {
        await bot.answerCallbackQuery(query.id, { text: '🧹 Running cleanup job...', show_alert: true });
        const result = runMaintenanceJob(); 
        
        await bot.editMessageText(`🧹 **Maintenance Report**\n\nCleaned ${result.cleanedFiles} expired files.\nCleaned ${result.cleanedCache} expired cache entries.`, {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_panel' }]] }
        });
    }
    else if (data === 'admin_broadcast_start' && isAdmin(userId)) {
        if (BROADCAST_STATUS.isSending) {
             return bot.answerCallbackQuery(query.id, { text: '❌ Broadcast is already running.', show_alert: true });
        }
        USER_STATE.set(userId, { state: 'BROADCASTING_MESSAGE_SETUP' });
        await bot.editMessageText('📢 **Universal Broadcast Setup**\n\n**STEP 1:** Send the message (text, photo, video, etc.) you want to broadcast to all users.', {
            chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_panel' }]] }
        });
    }
    else if (data === 'admin_stop_broadcast' && isAdmin(userId)) {
        if (BROADCAST_STATUS.jobInterval) {
            clearInterval(BROADCAST_STATUS.jobInterval);
            BROADCAST_STATUS.isSending = false;
            BROADCAST_STATUS.queue = [];
            
            await bot.answerCallbackQuery(query.id, { text: '❌ Broadcast job stopped.', show_alert: true });
            bot.emit('callback_query', { ...query, data: 'admin_panel' });
        } else {
            await bot.answerCallbackQuery(query.id, { text: 'No active broadcast to stop.', show_alert: true });
        }
    }
    
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
    
    const user = registerUser(userId, username, firstName); 

    // 1. Channel Tracking 
    if (msg.chat.type !== 'private') {
        CHAT_DATABASE.set(chatId, { id: chatId, title: msg.chat.title, type: msg.chat.type, lastActive: Date.now() });
    }
    
    if (user.isBlocked) return;
    
    // 2. Admin State Check (Broadcast)
    if (isAdmin(userId) && USER_STATE.has(userId) && USER_STATE.get(userId).state.startsWith('BROADCASTING_')) {
        const stateData = USER_STATE.get(userId);
        
        if (stateData.state === 'BROADCASTING_MESSAGE_SETUP' && (msg.text || msg.photo || msg.video || msg.document)) {
            stateData.messageId = msg.message_id;
            stateData.state = 'BROADCASTING_KEYBOARD_SETUP';
            USER_STATE.set(userId, stateData);
            
            await bot.sendMessage(chatId, '📢 **Universal Broadcast Setup**\n\n**STEP 2:** Send the inline keyboard markup in JSON format (e.g., `[[{"text":"Go","url":"https://example.com"}]]`) or send **"SKIP"** to proceed without a button.', {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_panel' }]] }
            });
            return;
        }

        if (stateData.state === 'BROADCASTING_KEYBOARD_SETUP' && msg.text) {
            let keyboard = null;
            let text = msg.text.trim();
            
            if (text.toUpperCase() !== 'SKIP') {
                try {
                    const parsedKeyboard = JSON.parse(text);
                    if (!Array.isArray(parsedKeyboard)) throw new Error('Not an array');
                    keyboard = { inline_keyboard: parsedKeyboard };
                } catch (e) {
                    return bot.sendMessage(chatId, '❌ Invalid JSON format for keyboard. Please re-send valid JSON or "SKIP".', { parse_mode: 'Markdown' });
                }
            }
            
            USER_STATE.delete(userId);
            
            // Start the broadcast
            startBroadcastJob(chatId, stateData.messageId, keyboard);
            return;
        }
    }
    
    // 3. User State Check (Renaming / Setting Alias)
    if (USER_STATE.has(userId) && msg.text) {
        const stateData = USER_STATE.get(userId);
        const file = FILE_DATABASE.get(stateData.fileId);

        if (stateData.state === 'RENAMING_FILE') {
            file.fileName = msg.text.trim();
            USER_STATE.delete(userId);
            await bot.sendMessage(chatId, `✅ File renamed to **${file.fileName}**!`, { parse_mode: 'Markdown' });
            return bot.emit('callback_query', { message: msg, from: msg.from, data: 'file_' + file.uniqueId });
        }

        if (stateData.state === 'SETTING_ALIAS') {
            const alias = msg.text.trim().toLowerCase();
            const aliasRegex = /^[a-z0-9-]+$/;
            
            if (!aliasRegex.test(alias) || alias.length < 3 || alias.length > 30) {
                 return bot.sendMessage(chatId, `❌ Invalid alias. Use 3-30 characters (a-z, 0-9, hyphens only).`, { parse_mode: 'Markdown' });
            }

            let isUnique = !findFile(alias); 
            
            if (isUnique) {
                file.customAlias = alias;
                USER_STATE.delete(userId);
                await bot.sendMessage(chatId, `✅ Custom alias set! Your new stream link is:\n\n<code>${WEBAPP_URL}/stream/${alias}</code>`, { parse_mode: 'HTML', disable_web_page_preview: true });
            } else {
                await bot.sendMessage(chatId, `❌ Alias **${alias}** is already in use.`, { parse_mode: 'Markdown' });
            }
            return bot.emit('callback_query', { message: msg, from: msg.from, data: 'file_' + file.uniqueId });
        }
    }
    
    // 4. Force Join Check
    const isMember = await checkMembership(userId);
    if (!isMember) {
        return bot.sendMessage(chatId, '⚠️ **ACCESS DENIED**\n\nYou must join our main channel to use this bot.', { 
            parse_mode: 'Markdown',
            reply_markup: getForceJoinKeyboard()
        });
    }
    
    // 5. File Upload Logic
    const file = msg.video || msg.document || msg.video_note || msg.photo;
    
    if (!file) return;

    // Limit Enforcement
    const limitCheck = canGenerateLink(userId);

    if (!limitCheck.allowed) {
        return bot.sendMessage(chatId, `
❌ <b>Link Generation Failed</b>

You have reached your limit of <b>${limitCheck.limit}</b> links for your <b>${limitCheck.userType}</b> tier.
        `, { parse_mode: 'HTML' });
    }
    
    try {
        const fileId = Array.isArray(file) ? file[file.length - 1].file_id : file.file_id;
        const fileUniqueId = Array.isArray(file) ? file[file.length - 1].file_unique_id : file.file_unique_id;
        const fileName = file.file_name || (msg.caption || `file_${fileUniqueId}.mp4`);
        const fileSize = file.file_size || (Array.isArray(file) ? file[file.length - 1].file_size : 0);
        
        const uniqueId = generateUniqueId();
        
        FILE_DATABASE.set(uniqueId, {
            uniqueId: uniqueId,
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
        
        const linkStatus = limitCheck.userType === 'PREMIUM' || limitCheck.userType === 'ADMIN' ? 'PERMANENT' : `Expires in ${formatRemainingTime(Date.now())}.`;
        
        const successText = `
✅ <b>Permanent Link Generated Successfully!</b>

📁 <b>File Name:</b> ${fileName}
💾 <b>File Size:</b> ${formatFileSize(fileSize)}

🔗 <b>Streaming Link:</b>
<code>${streamLink}</code>

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
// EXPRESS SERVER (Streaming & Downloading with Range Support)
// ============================================
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
    res.send(`<h1>BeatAnimes Link Generator Bot</h1><p>Bot is running. Start a conversation on Telegram.</p><p>Total Users: ${USER_DATABASE.size} | Total Files: ${FILE_DATABASE.size}</p>`);
});

app.get('/stream/:id', async (req, res) => {
    const id = req.params.id;
    const fileData = findFile(id);

    if (!fileData || !isFilePermanent(fileData.uniqueId)) {
        return res.status(404).send('File not found or has expired. Upgrade to Premium for permanent links.');
    }

    try {
        const fileUrl = await getFreshFileUrl(fileData);
        const range = req.headers.range;
        
        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileData.fileSize - 1;
            const contentLength = (end - start) + 1;
            
            const headers = {
                'Content-Range': `bytes ${start}-${end}/${fileData.fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': contentLength,
                'Content-Type': 'video/mp4' 
            };
            
            const fetchOptions = { headers: { Range: `bytes=${start}-${end}` } };
            const fileResponse = await fetch(fileUrl, fetchOptions);

            res.writeHead(206, headers);
            fileResponse.body.pipe(res);

        } else {
            const headers = {
                'Content-Length': fileData.fileSize,
                'Content-Type': 'video/mp4',
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
        res.status(500).send('Streaming failed: Could not retrieve file from Telegram.');
    }
});

app.get('/download/:id', async (req, res) => {
    const id = req.params.id;
    const fileData = findFile(id);

    if (!fileData || !isFilePermanent(fileData.uniqueId)) {
        return res.status(404).send('File not found or has expired. Upgrade to Premium for permanent links.');
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
        res.status(500).send('Download failed: Could not retrieve file from Telegram.');
    }
});


// ============================================
// START SERVER AND MAINTENANCE LOOP
// ============================================

setInterval(() => {
    const result = runMaintenanceJob();
    if (result.cleanedFiles > 0 || result.cleanedCache > 0) {
        console.log(`🧹 Scheduled Maintenance: Cleaned ${result.cleanedFiles} expired files and ${result.cleanedCache} cache entries.`);
    }
}, 4 * 60 * 60 * 1000); // Run every 4 hours

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

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n⏸️ Shutting down...');
    if (BROADCAST_STATUS.jobInterval) clearInterval(BROADCAST_STATUS.jobInterval);
    bot.stopPolling();
    process.exit(0);
});
