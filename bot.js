// ============================================
// ULTIMATE TELEGRAM PERMANENT LINK BOT (V2)
// Improvements: Multi-Channel Force Sub, Verify Subscription Flow.
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
// CHANNEL_USERNAME is now deprecated, use FORCE_SUB_CHANNEL_IDS instead
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@YourChannel'; 

// Customization constants (FOR WELCOME MESSAGE)
const WELCOME_SOURCE_CHANNEL = parseInt(process.env.WELCOME_SOURCE_CHANNEL || '-1002530952988'); 
const WELCOME_SOURCE_MESSAGE_ID = parseInt(process.env.WELCOME_SOURCE_MESSAGE_ID || '32'); 
const PUBLIC_ANIME_CHANNEL_URL = process.env.PUBLIC_ANIME_CHANNEL_URL || "https://t.me/BeatAnime";
const REQUEST_CHANNEL_URL = process.env.REQUEST_CHANNEL_URL || "https://t.me/Beat_Hindi_Dubbed";
const ADMIN_CONTACT_USERNAME = process.env.ADMIN_CONTACT_USERNAME || "Beat_Anime_Ocean"; 

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
const CHAT_DATABASE = new Map(); 
const URL_CACHE = new Map(); 
const URL_CACHE_DURATION = 23 * 60 * 60 * 1000; 
const USER_STATE = new Map(); 

// Global mutable config (can be changed via admin panel)
const CONFIG_STATE = {
    // New structure for multiple mandatory channels. Initialize with the old ID if it exists.
    FORCE_SUB_CHANNEL_IDS: process.env.MANDATORY_CHANNEL_ID 
        ? [parseInt(process.env.MANDATORY_CHANNEL_ID)] 
        : []
};

// Cache for channel details (title, username) to avoid repeated API calls
const CHANNEL_DETAILS_CACHE = new Map(); 

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

// Set up bot commands for the Telegram menu (UPDATED for all features)
bot.setMyCommands([
    { command: 'start', description: 'Start the bot and open the main menu' },
    { command: 'help', description: 'Show the bot guide and features' },
    { command: 'stats', description: 'Check your upload limits and usage statistics' },
    { command: 'files', description: 'View and manage your uploaded files' },
    { command: 'premium', description: 'Information about Premium upgrade and features' },
    { command: 'referral', description: 'Get your unique referral link and check bonus slots' },
    { command: 'admin', description: 'Open the admin control panel (Admins only)' },
    { command: 'addchannel', description: 'Add a mandatory join channel (Admins only)' },
    { command: 'listchannels', description: 'List all mandatory join channels (Admins only)' },
]).then(() => console.log('✅ Telegram commands set.'));

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
        for (const data of FILE_DATABASE.values()) {
            if (data.customAlias === id) {
                fileData = data;
                break;
            }
        }
    }
    return fileData;
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
// FEATURE: MULTI-CHANNEL FORCE SUBSCRIPTION
// ============================================

async function getChannelDetails(channelId) {
    if (CHANNEL_DETAILS_CACHE.has(channelId)) {
        return CHANNEL_DETAILS_CACHE.get(channelId);
    }
    try {
        const chatInfo = await bot.getChat(channelId);
        // Use full URL for public channels, or just name for private to show the title
        const username = chatInfo.username ? `@${chatInfo.username}` : null;
        const details = { title: chatInfo.title, username: username, id: channelId };
        CHANNEL_DETAILS_CACHE.set(channelId, details);
        return details;
    } catch (e) {
        console.error(`Error fetching chat details for ${channelId}: ${e.message}`);
        return { title: `Unknown Channel (${channelId})`, username: null, id: channelId };
    }
}

/**
 * Checks membership for all required channels.
 * @returns {{isMember: boolean, requiredChannels: Array<{id: number, title: string, username: string}>}}
 */
async function checkAllMemberships(userId) {
    const channelIds = CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.filter(id => id); 
    if (channelIds.length === 0) return { isMember: true, requiredChannels: [] };

    const requiredChannels = [];
    let isSubscribedToAll = true;

    for (const id of channelIds) {
        const details = await getChannelDetails(id);
        requiredChannels.push({ id, ...details });
        
        try {
            const member = await bot.getChatMember(id, userId);
            // Statuses 'left' or 'kicked' mean the user is not a member.
            if (member.status === 'left' || member.status === 'kicked') {
                isSubscribedToAll = false;
            }
        } catch (e) {
             // getChatMember throws error if status is 'left' for non-admins, or if user not found.
             if (e.response && e.response.statusCode === 400 && (e.response.body.description.includes('user not found') || e.response.body.description.includes('user is not a member'))) {
                 isSubscribedToAll = false;
             }
             else if (e.response && e.response.statusCode === 403) {
                 // Bot was blocked or channel is inaccessible
                 console.error(`Bot blocked by channel ${id}. Removing from list.`);
                 // Auto-remove problematic channel ID
                 CONFIG_STATE.FORCE_SUB_CHANNEL_IDS = CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.filter(cid => cid !== id);
                 CHANNEL_DETAILS_CACHE.delete(id);
                 isSubscribedToAll = false; 
             }
             else {
                 // Other errors (e.g., bot not admin) - treat as failure for safety
                 console.error(`Error checking membership in ${id} for user ${userId}: ${e.message}`);
                 isSubscribedToAll = false; 
             }
        }
        
        if (!isSubscribedToAll) break; // Optimization
    }
    
    return { isMember: isSubscribedToAll, requiredChannels };
}

function getForceJoinKeyboard(requiredChannels) {
    const keyboard = [];
    
    for (const ch of requiredChannels) {
        // Use a direct Telegram link for the button
        const url = ch.username ? `https://t.me/${ch.username.replace('@', '')}` : 'https://t.me/telegram'; // Fallback to Telegram link for private
        keyboard.push([{ text: `📢 ${ch.title}`, url: url }]);
    }
    
    // The verify button uses the callback_data="verify_subscription"
    keyboard.push([{ text: '✅ Click to continue', callback_data: 'verify_subscription' }]);
    
    return { inline_keyboard: keyboard };
}


/**
 * Central function to check for force subscription and intercept execution if failed.
 * @param {object} msg - Telegram message object.
 * @param {function} action - The protected handler function to execute on success.
 * @returns {Promise<boolean>} - True if action was executed, false if intercepted.
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
⚠️ <b>ACCESS DENIED - Join Required</b>

Hello ${msg.from.first_name}, to use this bot's powerful features, you must first join all of our mandatory channels listed below.

Please join **ALL** channels and then click the 'Click to continue' button.
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
// KEYBOARD & TEXT GENERATION
// ============================================

// Removed getForceJoinKeyboard as it is now getForceJoinKeyboard(requiredChannels)

// **NEW** Custom Welcome Keyboard (Replaces the default welcome message UI)
function getCustomWelcomeKeyboard(isAdminUser) {
    // Add "Go to Bot Features" button to access /stats, /files, etc.
    let keyboard = [
        [{ text: "ᴀɴɪᴍᴇ ᴄʜᴀɴɴᴇʟ", url: PUBLIC_ANIME_CHANNEL_URL }],
        [{ text: "ᴄᴏɴᴛᴀᴄᴛ ᴀᴅᴍɪɴ", url: `https://t.me/${ADMIN_CONTACT_USERNAME}` }],
        [{ text: "ʀᴇǫᴜᴇsᴛ ᴀɴɪᴍᴇ ᴄʜᴀɴɴᴇʟ", url: REQUEST_CHANNEL_URL }],
        [
            { text: "ᴀʙᴏᴜᴛ ᴍᴇ", callback_data: "about_bot" },
            { text: "ᴄʟᴏsᴇ", callback_data: "close_message" }
        ],
        [{ text: "➡️ Go to Bot Features", callback_data: "start_features" }]
    ];

    if (isAdminUser) {
        keyboard.push([{ text: "👑 Admin Panel", callback_data: "admin_panel" }]);
    }
    
    return { inline_keyboard: keyboard };
}


function getMainKeyboard(isAdmin = false) {
    // This is the keyboard for the core bot features (stats, files, premium, etc.)
    const keyboard = [
        [
            { text: '📊 My Stats', callback_data: 'my_stats' },
            { text: '📁 My Files', callback_data: 'my_files_0' } 
        ],
        [
            { text: '💎 Upgrade Premium', callback_data: 'premium_info' }, 
            { text: '👥 Referral Link', callback_data: 'referral_info' } 
        ],
        [
            { text: '📖 Bot Help', callback_data: 'help' }
        ]
    ];
    
    if (isAdmin) {
        keyboard.push([
            { text: '👑 Admin Panel', callback_data: 'admin_panel' }
        ]);
    }
    
    // Add a back button to the custom welcome screen
    keyboard.push([{ text: '🔙 Back to Welcome', callback_data: 'user_back' }]);
    
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
                { text: `🔗 Manage Join Channels (${CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.length})`, callback_data: 'admin_list_channels' }
            ],
            [
                { text: '🔙 Back', callback_data: 'start_features' } // Back to Main Bot Features menu
            ]
        ]
    };
}

function getFileActionsKeyboard(fileId, userType) {
    const file = FILE_DATABASE.get(fileId);
    if (!file) return { inline_keyboard: [[{ text: '🔙 Back to Files', callback_data: 'my_files_0' }]] };

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

function getWelcomeText(userId, firstName) {
    const user = USER_DATABASE.get(userId) || registerUser(userId, null, firstName); 
    const limitCheck = canGenerateLink(userId);

    return `
🎬 <b>Welcome to BeatAnimes Link Generator!</b>

${firstName}, I'm here to help you create <b>permanent streaming links</b> for your videos! 🚀

<b>✨ Your Current Plan: ${getUserType(userId)}</b>
- Links ${limitCheck.userType === 'NORMAL' ? `expire after 30 days.` : 'NEVER expire (Permanent!).'}
- Upload Limit: ${limitCheck.current} / ${limitCheck.limit} (Total limit includes ${user.referralBonus} bonus slots.)

<b>🎯 Quick Start:</b> Just send me any video file!

<b>👥 Users:</b> ${ANALYTICS.totalUsers}
<b>📁 Files:</b> ${ANALYTICS.totalFiles}
    `;
}

function getHelpText() {
    return `
📚 <b>Bot Help Guide</b>

<b>1. How to use:</b>
- Simply send me any video or document file. I will generate a permanent streaming/download link for it instantly.

<b>2. File Limits & Expiration:</b>
- **NORMAL (Free Tier):** You can upload ${LINK_LIMITS.NORMAL} files. Links expire after 30 days.
- **PREMIUM:** You can upload ${LINK_LIMITS.PREMIUM} files. Links are **PERMANENT**.

<b>3. Commands:</b>
- /start: Open custom welcome.
- /help: Show bot guide.
- /stats: Check limits, usage.
- /files: Manage uploaded links.
- /premium or /upgrade: See upgrade details.
- /referral: Get referral link.
- /admin: Open admin panel ...[ADMIN]
- /broadcast: Start mass message ...[ADMIN]
- /addchannel: Add force sub channel ...[ADMIN]

<b>4. Important:</b>
- You must remain a member of all mandatory channels to use the bot.
    `;
}

function getPremiumText() {
    return `
💎 <b>Upgrade to Premium</b>

Enjoy the ultimate experience with Premium:

1.  <b>PERMANENT LINKS:</b> Your links will **NEVER** expire.
2.  <b>HIGH LIMIT:</b> Upload up to **${LINK_LIMITS.PREMIUM}** files.
3.  <b>CUSTOM ALIASES:</b> Set short, memorable URL slugs for your links.

💰 <b>How to Upgrade:</b>
Contact our support team @${ADMIN_CONTACT_USERNAME} to purchase the premium plan!

Thank you for supporting the bot!
    `;
}

function getReferralText(userId) {
    const user = USER_DATABASE.get(userId);
    const referralLink = `${WEBAPP_URL}?start=${userId}`;
    return `
👥 <b>Referral Program</b>

Invite friends and earn free link slots!

- **Reward:** You get **+1 permanent link slot** for every new user who starts the bot using your unique link.
- **Current Bonus Slots:** ${user.referralBonus || 0}

🔗 <b>Your Unique Referral Link:</b>
<code>${referralLink}</code>

Share this link everywhere!
    `;
}

// **NEW** About Bot Text
function getAboutText() {
    return `
<b>About Us</b>

Developed by @${ADMIN_CONTACT_USERNAME}
This bot is designed to create permanent streaming and download links for media files shared on Telegram.
`;
}


// ============================================
// MAINTENANCE & BROADCAST JOBS
// ============================================

function runMaintenanceJob() {
    // ... (Maintenance job logic remains the same)
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
    // ... (Broadcast job logic remains the same)
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
            if (error.response && error.response.statusCode === 403) {
                 const user = USER_DATABASE.get(targetId);
                 if (user) user.isBlocked = true; 
            }
            BROADCAST_STATUS.failedCount++;
        }
    }, BROADCAST_INTERVAL_MS);

    BROADCAST_STATUS.jobInterval = intervalHandler;
}


// ============================================
// BOT COMMANDS - ENTRY POINTS
// ============================================

const handleStartCommand = async (msg, match) => {
    const userId = msg.from.id;
    const username = msg.from.username;
    const firstName = msg.from.first_name;
    
    const referrerId = match ? parseInt(match[1]) : null;
    const user = registerUser(userId, username, firstName, referrerId); 

    // Referral Logic
    if (referrerId && referrerId !== userId && !user.referrerId) {
         user.referrerId = referrerId;
         
         const referrer = USER_DATABASE.get(referrerId);
         if (referrer) {
             referrer.referralBonus = (referrer.referralBonus || 0) + 1; 
             bot.sendMessage(referrerId, `🎁 You earned **1 FREE link slot**! **${firstName}** joined using your link.`, { parse_mode: 'Markdown' }).catch(() => {});
         }
    }
    
    if (user.isBlocked) {
         return bot.sendMessage(msg.chat.id, '❌ You have been **BLOCKED**...', { parse_mode: 'Markdown' });
    }
    
    // --- FORCE SUB CHECK AND INTERCEPT ---
    const action = async () => {
        // This logic only runs if the user is a member of all channels (or is admin)
        const chatId = msg.chat.id;
        const customKeyboard = getCustomWelcomeKeyboard(isAdmin(userId));

        try {
            // Attempt to copy the message
            await bot.copyMessage(
                chatId,
                WELCOME_SOURCE_CHANNEL,
                WELCOME_SOURCE_MESSAGE_ID,
                { reply_markup: customKeyboard }
            );
        } catch (error) {
            // Handle failure by sending a fallback text message
            console.error(`Error copying welcome message: ${error.message}`);
            const fallback_text = `👋 <b>Welcome to the bot!</b>\n\nUse the buttons below to navigate or send me a file to get started.`;
            await bot.sendMessage(chatId, fallback_text, { 
                parse_mode: 'HTML', 
                reply_markup: customKeyboard 
            });
        }
    };
    
    await forceSubCheckAndIntercept(msg, action);
};

bot.onText(/\/start(?:\s+(\d+))?/, handleStartCommand);

// New commands for all features
bot.onText(/\/(help|stats|files|admin|premium|upgrade|referral|broadcast|cleanup|addchannel|listchannels)/, async (msg, match) => {
    const command = match[1];
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    // --- ADMIN COMMANDS (Immediate execution or state setup) ---
    if (['admin', 'broadcast', 'cleanup', 'addchannel', 'listchannels'].includes(command) && isAdmin(userId)) {
        if (command === 'admin') {
            return bot.emit('callback_query', { message: msg, from: msg.from, data: 'admin_panel', id: 'cmd_admin' + Date.now(), chat_instance: 'dummy' });
        }
        if (command === 'broadcast') {
            return bot.emit('callback_query', { message: msg, from: msg.from, data: 'admin_broadcast_start', id: 'cmd_broadcast' + Date.now(), chat_instance: 'dummy' });
        }
        if (command === 'cleanup') {
            return bot.emit('callback_query', { message: msg, from: msg.from, data: 'admin_trigger_cleanup', id: 'cmd_cleanup' + Date.now(), chat_instance: 'dummy' });
        }
        if (command === 'addchannel') {
            USER_STATE.set(userId, { state: 'ADDING_JOIN_CHANNEL' });
            return bot.sendMessage(chatId, '🔗 **Add Mandatory Join Channel**\n\nSend the new Channel ID (e.g., `-100XXXXXXXXXX`) or Channel Username (e.g., `@mychannel`).', { parse_mode: 'Markdown' });
        }
        if (command === 'listchannels') {
            return bot.emit('callback_query', { message: msg, from: msg.from, data: 'admin_list_channels', id: 'cmd_listchannel' + Date.now(), chat_instance: 'dummy' });
        }
    } else if (['admin', 'broadcast', 'cleanup', 'addchannel', 'listchannels'].includes(command) && !isAdmin(userId)) {
        return bot.sendMessage(chatId, '❌ You are not authorized to use this command.', { parse_mode: 'Markdown' });
    }

    // --- PROTECTED USER COMMANDS ---
    if (command === 'help') {
        const helpText = getHelpText();
        await bot.sendMessage(chatId, helpText, { 
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: { inline_keyboard: [[{ text: '🔙 Back to Welcome', callback_data: 'user_back' }]] }
        });
        return;
    }

    const action = async () => {
        let callbackData;
        switch (command) {
            case 'stats':
                callbackData = 'my_stats';
                break;
            case 'files':
                callbackData = 'my_files_0';
                break;
            case 'premium':
            case 'upgrade':
                callbackData = 'premium_info';
                break;
            case 'referral':
                callbackData = 'referral_info';
                break;
            default:
                return;
        }
        
        // Emit a callback query to handle the command flow within the main menu logic
        const dummyQuery = {
            message: msg, from: msg.from, data: callbackData, 
            id: 'dummy_cmd' + Date.now(), chat_instance: 'dummy' 
        };
        bot.emit('callback_query', dummyQuery); 
    };

    // Intercept protected user commands
    await forceSubCheckAndIntercept(msg, action);
});


// ============================================
// CALLBACK QUERY HANDLER 
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

    // Function to edit the message
    const editMessage = async (text, keyboard, disablePreview = false) => {
        try {
            await bot.editMessageText(text, {
                chat_id: chatId, message_id: messageId, parse_mode: 'HTML', reply_markup: keyboard, disable_web_page_preview: disablePreview
            });
        } catch (e) {
            // ... (Edit failure fallback logic remains the same)
             if (query.message.photo || query.message.video || query.message.animation || query.message.document || query.message.caption) {
                try { await bot.deleteMessage(chatId, messageId); } catch (e) { /* Ignore */ }
                await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard, disable_web_page_preview: disablePreview });
            } else if (query.id.startsWith('dummy_cmd') || query.id.startsWith('cmd_')) {
                await bot.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: keyboard, disable_web_page_preview: disablePreview });
            }
        }
    };
    
    // --- FORCE SUB VERIFICATION HANDLER (Python-style flow) ---
    if (data === 'verify_subscription') {
        const { isMember, requiredChannels } = await checkAllMemberships(userId);
        
        if (isMember) {
            // Success! Delete old prompt and re-emit /start
            try { await bot.deleteMessage(chatId, messageId); } catch (e) { /* Ignore */ }
            bot.emit('message', { ...query.message, text: '/start', from: query.from, chat: { id: chatId } });
            return bot.answerCallbackQuery(query.id, { text: '✅ Access Granted! Welcome!', show_alert: true });
        } else {
            // Still not a member, re-show the prompt with the keyboard
            const promptText = `
⚠️ <b>ACCESS DENIED - Join Required</b>

You are still not a member of all required channels. Please join **ALL** channels and then click the 'Click to continue' button.
            `;
            const keyboard = getForceJoinKeyboard(requiredChannels);
            await editMessage(promptText, keyboard); // Use edit to update the current message
            return bot.answerCallbackQuery(query.id, { text: '⚠️ Please join all channels listed above.', show_alert: true });
        }
    }


    // --- Global Membership Check for All Other Callbacks ---
    const { isMember } = await checkAllMemberships(userId);
    if (!isMember && !isAdmin(userId)) {
        await bot.answerCallbackQuery(query.id, { text: '⚠️ You must join the channel(s) to view this menu.', show_alert: true });
        // Don't proceed to handle other data if check fails
        return; 
    }

    // --- Custom Welcome Menu Handlers ---
    if (data === 'start' || data === 'user_back') {
        // Re-trigger /start command logic to show the welcome media message
        try { await bot.deleteMessage(chatId, messageId); } catch (e) { /* Ignore */ }
        bot.emit('message', { ...query.message, text: '/start', from: query.from, chat: { id: chatId } });
        return;
    }
    
    // Navigate to the old main menu
    else if (data === 'start_features') {
        const welcomeText = getWelcomeText(userId, user.firstName);
        const keyboard = getMainKeyboard(isAdmin(userId));
        await editMessage(welcomeText, keyboard); 
    }
    
    // Close message (DELETE MESSAGE)
    else if (data === 'close_message') {
        try {
            await bot.deleteMessage(chatId, messageId);
        } catch (e) {
            console.warn(`Could not delete message: ${e.message}`);
        }
        return bot.answerCallbackQuery(query.id, { text: 'Message closed.', show_alert: false });
    }
    
    // About Bot
    else if (data === 'about_bot') {
        const aboutText = getAboutText();
        const keyboard = { inline_keyboard: [[{ text: "🔙 BACK", callback_data: "user_back" }]] };
        
        try { await bot.deleteMessage(chatId, messageId); } catch (e) { /* Ignore */ }
        await bot.sendMessage(chatId, aboutText, { 
            parse_mode: 'HTML', 
            reply_markup: keyboard
        });
        return bot.answerCallbackQuery(query.id);
    }
    
    // --- Core Commands (Stats, Premium, Referral, Files...) ---
    else if (data === 'my_stats') {
        // ... (Logic remains the same)
        const limitCheck = canGenerateLink(userId);
        const totalViews = Array.from(FILE_DATABASE.values()).filter(f => f.uploadedBy === userId).reduce((sum, f) => sum + f.views, 0);
        const statsText = `
📊 <b>Your Statistics</b>

✨ <b>Your Tier:</b> ${limitCheck.userType}
📁 <b>Your Uploads:</b> ${limitCheck.current} / ${limitCheck.limit}
➕ <b>Referral Bonus Slots:</b> ${user.referralBonus}
📈 <b>Total Views on Your Files:</b> ${totalViews}
        `;
        await editMessage(statsText, {
            inline_keyboard: [[{ text: '🔙 Back', callback_data: 'start_features' }]]
        });
    }
    // ... (Other handlers like my_files_, premium_info, referral_info, file_ etc. remain the same) ...
    else if (data === 'premium_info') {
        const premiumText = getPremiumText();
        await editMessage(premiumText, { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'start_features' }]] });
    } else if (data === 'referral_info') {
        const referralText = getReferralText(userId);
        await editMessage(referralText, { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'start_features' }]] }, true);
    } 
    // --- My Files List (with Pagination) ---
    const PAGE_SIZE = 5;
    if (data.startsWith('my_files_')) {
        const page = parseInt(data.substring(9)) || 0;
        const myFiles = Array.from(FILE_DATABASE.values()).filter(f => f.uploadedBy === userId);
        const totalPages = Math.ceil(myFiles.length / PAGE_SIZE);
        const filesToShow = myFiles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

        if (myFiles.length === 0) {
            await editMessage('❌ You have not uploaded any files yet. Send me a video!', {
                inline_keyboard: [[{ text: '🔙 Back', callback_data: 'start_features' }]]
            });
            return bot.answerCallbackQuery(query.id);
        }

        const filesList = filesToShow.map((f, i) => `${(page * PAGE_SIZE) + i + 1}. ${f.fileName} (${formatFileSize(f.fileSize)})`).join('\n');
        
        const navigationRow = [];
        if (page > 0) navigationRow.push({ text: '◀️ Prev', callback_data: `my_files_${page - 1}` });
        if (page < totalPages - 1) navigationRow.push({ text: 'Next ▶️', callback_data: `my_files_${page + 1}` });

        await editMessage(`📁 <b>Your Files</b> (Page ${page + 1} of ${totalPages})\n\n${filesList}`, {
            inline_keyboard: filesToShow.map(f => ([{ text: f.fileName, callback_data: `file_${f.uniqueId}` }]))
                .concat([navigationRow])
                .concat([[ { text: '🔙 Back', callback_data: 'start_features' } ]])
        });
    }
    
    // --- File Details and Actions (file_, rename_, alias_, delete_) logic remains the same ---
    else if (data.startsWith('file_')) {
        const fileId = data.substring(5);
        const file = FILE_DATABASE.get(fileId);
        if (!file || file.uploadedBy !== userId) return; 
        
        const fileText = `
📁 <b>File Details:</b>
Name: ${file.fileName}
Size: ${formatFileSize(file.fileSize)}
Alias: ${file.customAlias || 'None'}
Views: ${file.views} | Downloads: ${file.downloads}
        `;
        await editMessage(fileText, getFileActionsKeyboard(fileId, user.userType));
    }
    else if (data.startsWith('rename_file_')) {
        const fileId = data.substring(12);
        USER_STATE.set(userId, { state: 'RENAMING_FILE', fileId: fileId });
        await editMessage('📝 **Send the new file name:**', {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'file_' + fileId }]]
        });
    }
    else if (data.startsWith('alias_file_')) {
        const fileId = data.substring(11);
        if (user.userType !== 'PREMIUM' && user.userType !== 'ADMIN') return bot.answerCallbackQuery(query.id, { text: '🚫 Custom aliases are a Premium feature.', show_alert: true });
        
        USER_STATE.set(userId, { state: 'SETTING_ALIAS', fileId: fileId });
        await editMessage('🏷️ **Send the custom alias (3-30 chars, a-z, 0-9, hyphens only):**', {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'file_' + fileId }]]
        });
    }
    else if (data.startsWith('delete_file_')) {
        const fileId = data.substring(12);
        const file = FILE_DATABASE.get(fileId);
        if (file && file.uploadedBy === userId) {
            FILE_DATABASE.delete(fileId);
            ANALYTICS.totalFiles = Math.max(0, ANALYTICS.totalFiles - 1);
            user.totalUploads = Math.max(0, user.totalUploads - 1);
            
            await editMessage(`🗑️ **File Deleted!**\n\nThe link for **${file.fileName}** has been permanently removed.`, {
                inline_keyboard: [[{ text: '🔙 Back to Files', callback_data: 'my_files_0' }]]
            });
        }
    }
    
    // --- Admin Panel Commands ---
    else if (data === 'admin_panel' && isAdmin(userId)) {
        const adminText = `
👑 <b>Admin Panel</b>

Welcome Admin!
• Users: ${USER_DATABASE.size}
• Files: ${FILE_DATABASE.size}
• Chats/Channels: ${CHAT_DATABASE.size}

Choose an option below:
        `;
        await editMessage(adminText, getAdminKeyboard());
    }
    else if (data === 'admin_list_channels' && isAdmin(userId)) {
        if (CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.length === 0) {
            const listText = '🔗 **Mandatory Channels**\n\nNo channels are currently configured for force subscription.';
            await editMessage(listText, {
                inline_keyboard: [
                    [{ text: '➕ Add Channel', callback_data: 'admin_add_channel_prompt' }],
                    [{ text: '🔙 Back', callback_data: 'admin_panel' }]
                ]
            });
            return;
        }

        const channelDetails = await Promise.all(CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.map(id => getChannelDetails(id)));
        
        const listText = '🔗 **Mandatory Channels**\n\n' + channelDetails.map((d, i) => 
            `${i + 1}. **${d.title}**\n   ID: <code>${d.id}</code>\n   Username: ${d.username || 'N/A (Private)'}`
        ).join('\n\n');
        
        const keyboard = {
            inline_keyboard: [
                ...channelDetails.map(d => ([{ text: `❌ Remove ${d.title.substring(0, 15)}...`, callback_data: `admin_remove_channel_${d.id}` }])),
                [{ text: '➕ Add Channel', callback_data: 'admin_add_channel_prompt' }],
                [{ text: '🔙 Back', callback_data: 'admin_panel' }]
            ]
        };

        await editMessage(listText, keyboard);
    }
    else if (data === 'admin_add_channel_prompt' && isAdmin(userId)) {
        USER_STATE.set(userId, { state: 'ADDING_JOIN_CHANNEL' });
        await editMessage('🔗 **Add Mandatory Join Channel**\n\nSend the new Channel ID (e.g., `-100XXXXXXXXXX`) or Channel Username (e.g., `@mychannel`).', {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_panel' }]]
        });
    }
    else if (data.startsWith('admin_remove_channel_') && isAdmin(userId)) {
        const channelIdToRemove = parseInt(data.substring(21));
        CONFIG_STATE.FORCE_SUB_CHANNEL_IDS = CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.filter(id => id !== channelIdToRemove);
        CHANNEL_DETAILS_CACHE.delete(channelIdToRemove);
        
        await bot.answerCallbackQuery(query.id, { text: '✅ Channel removed successfully!', show_alert: true });
        // Re-open the list
        bot.emit('callback_query', { message: query.message, from: query.from, data: 'admin_list_channels', id: 'cmd_refresh_list' + Date.now(), chat_instance: 'dummy' });
    }
    // ... (Other admin commands remain the same) ...
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
        
        await editMessage(statsText, {
            inline_keyboard: [[{ text: '🔙 Back', callback_data: 'admin_panel' }]]
        });
    }
    else if (data === 'admin_broadcast_start' && isAdmin(userId)) {
        USER_STATE.set(userId, { state: 'BROADCASTING_MESSAGE_SETUP' });
        await editMessage('📢 **Universal Broadcast Setup**\n\n**STEP 1:** Send the message (text, photo, or video) you want to broadcast to all users.', {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'admin_panel' }]]
        });
    }
    else if (data === 'admin_stop_broadcast' && isAdmin(userId)) {
        if (BROADCAST_STATUS.jobInterval) clearInterval(BROADCAST_STATUS.jobInterval);
        BROADCAST_STATUS.isSending = false;
        
        await editMessage('🛑 **Broadcast Stopped!**', {
            inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_panel' }]]
        });
    }
    else if (data === 'admin_trigger_cleanup' && isAdmin(userId)) {
        await bot.answerCallbackQuery(query.id, { text: '🧹 Running cleanup job...', show_alert: true });
        const result = runMaintenanceJob(); 
        
        await editMessage(`🧹 **Maintenance Report**\n\nCleaned ${result.cleanedFiles} expired files.\nCleaned ${result.cleanedCache} expired cache entries.`, {
            inline_keyboard: [[{ text: '🔙 Back to Admin', callback_data: 'admin_panel' }]]
        });
    }


    // Handle the mandatory callback query response
    if (query.id && (query.id.startsWith('dummy_cmd') || query.id.startsWith('cmd_'))) {
        // Do not respond to dummy queries generated by commands
    } else {
        await bot.answerCallbackQuery(query.id);
    }
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

    if (user.isBlocked) return;
    
    // 1. Channel Tracking 
    if (msg.chat.type !== 'private') {
        CHAT_DATABASE.set(chatId, { id: chatId, title: msg.chat.title, type: msg.chat.type, lastActive: Date.now() });
    }
    
    // Commands are handled by onText, non-commands/state are handled below.
    if (msg.text && msg.text.startsWith('/')) return;
    
    // 2. Admin State Check (Broadcast) - Full Logic (Remains the same)
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
            
            startBroadcastJob(chatId, stateData.messageId, keyboard);
            return;
        }
    }
    
    // 3. Admin State Check (Adding Join Channel ID) - UPDATED
    if (isAdmin(userId) && USER_STATE.has(userId) && USER_STATE.get(userId).state === 'ADDING_JOIN_CHANNEL' && msg.text) {
        let newIdText = msg.text.trim();
        let newId;

        // Try to parse ID
        if (newIdText.startsWith('-100')) {
             newId = parseInt(newIdText);
             if (isNaN(newId)) newId = null;
        } 
        // Use username/link
        else if (newIdText.startsWith('@') || newIdText.startsWith('t.me')) {
             newId = newIdText.split('/').pop().replace('@', ''); // Extract username
        } else {
             newId = null;
        }

        if (newId) {
            try {
                // If it's a username, get the chat info to resolve the ID
                const chatInfo = await bot.getChat(newId);
                const actualId = chatInfo.id;
                
                if (CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.includes(actualId)) {
                    USER_STATE.delete(userId);
                    return bot.sendMessage(chatId, '❌ **Failed!** This channel is already in the mandatory list.', { parse_mode: 'Markdown' });
                }

                const isChannel = chatInfo.type === 'channel' || chatInfo.type === 'supergroup';
                
                if (isChannel) {
                    CONFIG_STATE.FORCE_SUB_CHANNEL_IDS.push(actualId);
                    CHANNEL_DETAILS_CACHE.set(actualId, { title: chatInfo.title, username: chatInfo.username ? `@${chatInfo.username}` : null, id: actualId });
                    
                    USER_STATE.delete(userId);
                    await bot.sendMessage(chatId, `✅ **Mandatory Join Channel Added!**\n\nChannel: **${chatInfo.title}**\nID: <code>${actualId}</code>`, { parse_mode: 'HTML' });
                    return;
                } else {
                    return bot.sendMessage(chatId, '❌ **Invalid Chat Type!** Please send the ID or Username of a Channel or Supergroup.', { parse_mode: 'Markdown' });
                }
            } catch (e) {
                console.error('Error adding channel:', e.message);
                return bot.sendMessage(chatId, '❌ **Channel Not Found!** Please ensure the ID/Username is correct and the bot is a member/admin of the channel.', { parse_mode: 'Markdown' });
            }
        } else {
            return bot.sendMessage(chatId, '❌ **Invalid Input!** Please send a valid Channel ID (starting with -100) or a Channel Username (starting with @).', { parse_mode: 'Markdown' });
        }
    }


    // 4. User State Check (Renaming / Setting Alias)
    if (USER_STATE.has(userId) && msg.text) {
        const stateData = USER_STATE.get(userId);
        const file = FILE_DATABASE.get(stateData.fileId);

        if (stateData.state === 'RENAMING_FILE') {
            file.fileName = msg.text.trim();
            USER_STATE.delete(userId);
            await bot.sendMessage(chatId, `✅ File renamed to **${file.fileName}**!`, { parse_mode: 'Markdown' });
            return bot.emit('callback_query', { message: msg, from: msg.from, data: 'file_' + file.uniqueId, id: 'dummy_state' + Date.now(), chat_instance: 'dummy' });
        }

        if (stateData.state === 'SETTING_ALIAS') {
            const alias = msg.text.trim().toLowerCase();
            const aliasRegex = /^[a-z0-9-]+$/;
            
            if (!aliasRegex.test(alias) || alias.length < 3 || alias.length > 30) {
                 return bot.sendMessage(chatId, `❌ Invalid alias. Use 3-30 characters (a-z, 0-9, hyphens only).`, { parse_mode: 'Markdown' });
            }

            let isUnique = !findFile(alias); 
            
            if (isUnique) {
                if (file.customAlias) file.customAlias = null; 
                file.customAlias = alias;
                USER_STATE.delete(userId);
                await bot.sendMessage(chatId, `✅ Custom alias set! Your new stream link is:\n\n<code>${WEBAPP_URL}/stream/${alias}</code>`, { parse_mode: 'HTML', disable_web_page_preview: true });
            } else {
                await bot.sendMessage(chatId, `❌ Alias **${alias}** is already in use.`, { parse_mode: 'Markdown' });
            }
            return bot.emit('callback_query', { message: msg, from: msg.from, data: 'file_' + file.uniqueId, id: 'dummy_state' + Date.now(), chat_instance: 'dummy' });
        }
    }
    
    // 5. File Upload Logic - WRAPPED IN PROTECTED ACTION
    const file = msg.video || msg.document || msg.video_note || msg.photo;
    
    if (!file) return;

    const action = async () => {
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
    };
    
    // Intercept file upload
    await forceSubCheckAndIntercept(msg, action);
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
