// ============================================
// ADVANCED TELEGRAM PERMANENT LINK BOT
// With Admin Panel, Beautiful UI, and Analytics
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
const WELCOME_PHOTO_ID = process.env.WELCOME_PHOTO_ID || null; // Photo file_id from your channel
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@YourChannel'; // Your channel username

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN is required!');
    process.exit(1);
}

// ============================================
// DATABASE
// ============================================
const FILE_DATABASE = new Map();
const USER_DATABASE = new Map();
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

console.log('✅ Bot started successfully!');

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
            isBlocked: false
        });
        ANALYTICS.totalUsers++;
    } else {
        const user = USER_DATABASE.get(userId);
        user.lastActive = Date.now();
    }
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

// ============================================
// KEYBOARD LAYOUTS
// ============================================

function getMainKeyboard(isAdmin = false) {
    const keyboard = [
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
    return {
        inline_keyboard: [
            [
                { text: '🔗 Get Link', callback_data: `get_link_${fileId}` },
                { text: '📊 Stats', callback_data: `file_stats_${fileId}` }
            ],
            [
                { text: '🗑️ Delete', callback_data: `delete_file_${fileId}` }
            ],
            [
                { text: '🔙 Back', callback_data: 'my_files' }
            ]
        ]
    };
}

// ============================================
// BOT COMMANDS - START
// ============================================

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const firstName = msg.from.first_name;
    
    registerUser(userId, username, firstName);
    
    const welcomeText = `
🎬 <b>Welcome to BeatAnimes Link Generator!</b>

${firstName}, I'm here to help you create <b>permanent streaming links</b> for your videos! 🚀

<b>✨ Features:</b>
✅ Permanent links that never expire
✅ Direct streaming support
✅ Download option available
✅ Analytics and tracking
✅ Fast and reliable

<b>🎯 Quick Start:</b>
Just send me any video file, and I'll generate a permanent link instantly!

<b>👥 Users:</b> ${ANALYTICS.totalUsers}
<b>📁 Files:</b> ${ANALYTICS.totalFiles}
<b>👁️ Total Views:</b> ${ANALYTICS.totalViews}

Join our channel: ${CHANNEL_USERNAME}
    `;
    
    const keyboard = getMainKeyboard(isAdmin(userId));
    
    if (WELCOME_PHOTO_ID) {
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
        
        console.log(`⬇️ Download: ${fileData.fileName}`);
    } catch (error) {
        console.error('❌ Download error:', error);
        res.status(500).send('Error downloading file');
    }
};

// API endpoints
app.get('/api/stats', (req, res) => {
    res.json({
        users: USER_DATABASE.size,
        files: FILE_DATABASE.size,
        views: ANALYTICS.totalViews,
        downloads: ANALYTICS.totalDownloads,
        uptime: process.uptime()
    });
});

app.get('/api/file/:id', (req, res) => {
    const fileData = FILE_DATABASE.get(req.params.id);
    if (!fileData) return res.status(404).json({ error: 'File not found' });
    
    res.json({
        id: req.params.id,
        fileName: fileData.fileName,
        fileSize: formatFileSize(fileData.fileSize),
        views: fileData.views,
        downloads: fileData.downloads,
        uploadedBy: fileData.uploaderName,
        createdAt: fileData.createdAt
    });
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

function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function formatDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: 'numeric'
    });
}

function getTopFiles(limit = 5) {
    const sorted = Array.from(FILE_DATABASE.entries())
        .sort((a, b) => b[1].views - a[1].views)
        .slice(0, limit);
    
    let result = '';
    sorted.forEach(([id, file], i) => {
        result += `${i + 1}. ${file.fileName} - ${file.views} views\n`;
    });
    
    return result || 'No files yet';
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
    console.log(`👑 Admins: ${ADMIN_IDS.length}`);
    console.log(`🤖 Bot is ready!`);
    console.log('═══════════════════════════════════════');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n⏸️ Shutting down...');
    bot.stopPolling();
    process.exit(0);
});

// Clean up expired cache every hour
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
        console.log(`🧹 Cleaned ${cleaned} expired cache entries`);
    }
}, 60 * 60 * 1000) {
            await bot.sendPhoto(chatId, WELCOME_PHOTO_ID, {
                caption: welcomeText,
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        } catch (error) {
            // Fallback to text if photo fails
            await bot.sendMessage(chatId, welcomeText, {
                parse_mode: 'HTML',
                reply_markup: keyboard
            });
        }
    } else {
        await bot.sendMessage(chatId, welcomeText, {
            parse_mode: 'HTML',
            reply_markup: keyboard
        });
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
    
    try {
        // My Stats
        if (data === 'my_stats') {
            const user = USER_DATABASE.get(userId);
            const stats = getUserStats(userId);
            
            const statsText = `
📊 <b>Your Statistics</b>

👤 <b>Name:</b> ${user.firstName}
🆔 <b>User ID:</b> <code>${userId}</code>
📅 <b>Joined:</b> ${formatDate(user.joinedAt)}

📁 <b>Total Files:</b> ${stats.files}
👁️ <b>Total Views:</b> ${stats.views}
⏰ <b>Last Active:</b> ${formatDate(user.lastActive)}

Keep sharing videos! 🚀
            `;
            
            await bot.editMessageText(statsText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔙 Back', callback_data: 'start' }
                    ]]
                }
            });
        }
        
        // My Files
        else if (data === 'my_files') {
            let fileList = '📁 <b>Your Files:</b>\n\n';
            let count = 0;
            const buttons = [];
            
            for (const [id, file] of FILE_DATABASE.entries()) {
                if (file.uploadedBy === userId) {
                    count++;
                    if (count <= 10) {
                        fileList += `${count}. ${file.fileName}\n`;
                        fileList += `   👁️ ${file.views} views\n`;
                        fileList += `   🆔 <code>${id}</code>\n\n`;
                        
                        buttons.push([
                            { text: `📄 ${file.fileName.substring(0, 20)}...`, callback_data: `file_${id}` }
                        ]);
                    }
                }
            }
            
            if (count === 0) {
                fileList = '📭 You haven\'t uploaded any files yet.\n\nSend me a video to get started!';
            } else if (count > 10) {
                fileList += `\n<i>Showing 10 of ${count} files</i>`;
            }
            
            buttons.push([{ text: '🔙 Back', callback_data: 'start' }]);
            
            await bot.editMessageText(fileList, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: buttons }
            });
        }
        
        // Help
        else if (data === 'help') {
            const helpText = `
📖 <b>How to Use</b>

<b>Step 1:</b> Send Video
Send me any video file from your device or forward from a channel.

<b>Step 2:</b> Get Link
I'll instantly generate a permanent streaming link for you.

<b>Step 3:</b> Use Anywhere
Copy the link and use it on your website, app, or share it!

<b>🎯 Features:</b>
• Links never expire
• Fast streaming
• Download support
• View analytics
• Mobile friendly

<b>💡 Pro Tips:</b>
• Use /myfiles to see all your files
• Check /stats for analytics
• Links support video seeking
• Works on all devices

Need more help? Contact admin!
            `;
            
            await bot.editMessageText(helpText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔙 Back', callback_data: 'start' }
                    ]]
                }
            });
        }
        
        // Admin Panel
        else if (data === 'admin_panel' && isAdmin(userId)) {
            const adminText = `
👑 <b>Admin Panel</b>

Welcome Admin! Here you can manage the bot.

📊 Quick Stats:
• Users: ${USER_DATABASE.size}
• Files: ${FILE_DATABASE.size}
• Views: ${ANALYTICS.totalViews}
• Downloads: ${ANALYTICS.totalDownloads}

Choose an option below:
            `;
            
            await bot.editMessageText(adminText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: getAdminKeyboard()
            });
        }
        
        // Admin Stats
        else if (data === 'admin_stats' && isAdmin(userId)) {
            let totalSize = 0;
            for (const file of FILE_DATABASE.values()) {
                totalSize += file.fileSize;
            }
            
            const uptime = process.uptime();
            const statsText = `
📊 <b>Detailed Statistics</b>

👥 <b>Users:</b> ${USER_DATABASE.size}
📁 <b>Total Files:</b> ${FILE_DATABASE.size}
💾 <b>Total Storage:</b> ${formatFileSize(totalSize)}
👁️ <b>Total Views:</b> ${ANALYTICS.totalViews}
⬇️ <b>Total Downloads:</b> ${ANALYTICS.totalDownloads}
🔄 <b>Cached URLs:</b> ${URL_CACHE.size}

⏱️ <b>Uptime:</b> ${formatUptime(uptime)}
🚀 <b>Running Since:</b> ${formatDate(ANALYTICS.startTime)}

<b>Top Files:</b>
${getTopFiles(5)}
            `;
            
            await bot.editMessageText(statsText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔙 Back', callback_data: 'admin_panel' }
                    ]]
                }
            });
        }
        
        // Admin Users
        else if (data === 'admin_users' && isAdmin(userId)) {
            let userList = '👥 <b>User List</b>\n\n';
            let count = 0;
            
            for (const user of USER_DATABASE.values()) {
                count++;
                if (count <= 15) {
                    const stats = getUserStats(user.userId);
                    userList += `${count}. ${user.firstName} (@${user.username})\n`;
                    userList += `   Files: ${stats.files} | Views: ${stats.views}\n`;
                    userList += `   Joined: ${formatDate(user.joinedAt)}\n\n`;
                }
            }
            
            if (count > 15) {
                userList += `\n<i>Showing 15 of ${count} users</i>`;
            }
            
            await bot.editMessageText(userList, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[
                        { text: '🔙 Back', callback_data: 'admin_panel' }
                    ]]
                }
            });
        }
        
        // Clean Cache
        else if (data === 'admin_clean' && isAdmin(userId)) {
            const sizeBefore = URL_CACHE.size;
            URL_CACHE.clear();
            
            await bot.answerCallbackQuery(query.id, {
                text: `✅ Cleaned ${sizeBefore} cached URLs!`,
                show_alert: true
            });
        }
        
        // Back to Start
        else if (data === 'start') {
            bot.onText(/\/start/, async (msg) => {
                // Trigger start command
            });
            await bot.deleteMessage(chatId, messageId);
            bot.emit('message', { ...query.message, text: '/start', from: query.from, chat: { id: chatId } });
        }
        
        await bot.answerCallbackQuery(query.id);
        
    } catch (error) {
        console.error('❌ Callback error:', error);
        await bot.answerCallbackQuery(query.id, {
            text: '❌ Error processing request',
            show_alert: true
        });
    }
});

// ============================================
// FILE UPLOAD HANDLER
// ============================================

bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/')) return;
    
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const firstName = msg.from.first_name;
    
    registerUser(userId, username, firstName);
    
    const file = msg.video || msg.document || msg.video_note;
    
    if (!file) return;
    
    try {
        const fileId = file.file_id;
        const fileUniqueId = file.file_unique_id;
        const fileName = file.file_name || `video_${fileUniqueId}.mp4`;
        const fileSize = file.file_size || 0;
        
        // Processing animation
        const processingMsg = await bot.sendMessage(chatId, '⏳ <b>Processing your video...</b>\n\n🔄 Generating permanent link...', {
            parse_mode: 'HTML'
        });
        
        await sleep(1000);
        
        await bot.editMessageText('⏳ <b>Processing your video...</b>\n\n✅ Link generated!\n📊 Creating analytics...', {
            chat_id: chatId,
            message_id: processingMsg.message_id,
            parse_mode: 'HTML'
        });
        
        await sleep(800);
        
        const uniqueId = generateUniqueId();
        
        FILE_DATABASE.set(uniqueId, {
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
            lastAccessed: Date.now()
        });
        
        const user = USER_DATABASE.get(userId);
        user.totalUploads++;
        
        ANALYTICS.totalFiles++;
        
        const streamLink = `${WEBAPP_URL}/stream/${uniqueId}`;
        const downloadLink = `${WEBAPP_URL}/download/${uniqueId}`;
        const embedCode = `<video src="${streamLink}" controls preload="metadata"></video>`;
        
        await bot.deleteMessage(chatId, processingMsg.message_id);
        
        const successText = `
✅ <b>Permanent Link Generated Successfully!</b>

📁 <b>File Name:</b> ${fileName}
💾 <b>File Size:</b> ${formatFileSize(fileSize)}
🆔 <b>Unique ID:</b> <code>${uniqueId}</code>
👤 <b>Uploaded By:</b> ${firstName}

🔗 <b>Streaming Link:</b>
<code>${streamLink}</code>

⬇️ <b>Download Link:</b>
<code>${downloadLink}</code>

📺 <b>Embed Code (HTML):</b>
<code>${embedCode}</code>

<b>✨ This link is PERMANENT and will NEVER expire!</b>

💡 <i>Use it anywhere - website, app, or share directly!</i>
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
                        { text: '📊 View Stats', callback_data: `file_stats_${uniqueId}` }
                    ],
                    [
                        { text: '📢 Share to Channel', url: `https://t.me/share/url?url=${encodeURIComponent(streamLink)}` }
                    ]
                ]
            }
        });
        
        console.log(`✅ [${firstName}] Generated link: ${fileName} (${uniqueId})`);
        
    } catch (error) {
        console.error('❌ Upload error:', error);
        await bot.sendMessage(chatId, '❌ <b>Error generating link.</b>\n\nPlease try again or contact admin.', {
            parse_mode: 'HTML'
        });
    }
});

// ============================================
// ADMIN COMMANDS
// ============================================

bot.onText(/\/admin/, async (msg) => {
    if (!isAdmin(msg.from.id)) {
        return bot.sendMessage(msg.chat.id, '❌ You are not authorized!');
    }
    
    const adminText = `
👑 <b>Admin Panel</b>

Choose an option:
    `;
    
    await bot.sendMessage(msg.chat.id, adminText, {
        parse_mode: 'HTML',
        reply_markup: getAdminKeyboard()
    });
});

// Broadcast command
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
        await sleep(100); // Avoid rate limits
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
        console.error('❌ Error getting file URL:', error);
        throw new Error('Failed to get file from Telegram');
    }
}

// ============================================
// EXPRESS SERVER - Beautiful Admin Panel
// ============================================
const app = express();

app.use(express.json());
app.use(express.static('public'));

// CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Range, Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Home page - Beautiful landing
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
        
        <a href="https://t.me/YourBotUsername" class="btn">Start Using Bot 🚀</a>
        
        <p style="margin-top: 30px; opacity: 0.7; font-size: 0.9em;">
            Join ${CHANNEL_USERNAME} for updates
        </p>
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

// Stream video with range support
app.get('/stream/:id', async (req, res) => {
    const fileId = req.params.id;
    const fileData = FILE_DATABASE.get(fileId);
    
    if (!fileData) {
        return res.status(404).send('File not found');
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
        
        console.log(`📺 Stream: ${fileData.fileName} (View #${fileData.views})`);
    } catch (error) {
        console.error('❌ Streaming error:', error);
        res.status(500).send('Error streaming file');
    }
});


// Download video
app.get('/download/:id', async (req, res) => {
    const fileId = req.params.id;
    
    const fileData = FILE_DATABASE.get(fileId);
    
    if (!fileData) {
        return res.status(404).send('File not found');
    }
    
    try {
        // Get file URL from Telegram
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.filePath}`;
        
        console.log(`⬇️ Download: ${fileData.fileName}`);
        
        // Fetch file from Telegram
        const response = await fetch(fileUrl);
        
        if (!response.ok) {
            throw new Error('Failed to fetch file from Telegram');
        }
        
        // Set headers for download
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${fileData.fileName}"`);
        
        // Stream the file
        response.body.pipe(res);
        
    } catch (error) {
        console.error('❌ Download error:', error);
        res.status(500).send('Error downloading file');
    }
});

// File info API
app.get('/api/file/:id', (req, res) => {
    const fileId = req.params.id;
    const fileData = FILE_DATABASE.get(fileId);
    
    if (!fileData) {
        return res.status(404).json({ error: 'File not found' });
    }
    
    res.json({
        fileName: fileData.fileName,
        fileSize: fileData.fileSize,
        fileSizeFormatted: formatFileSize(fileData.fileSize),
        views: fileData.views,
        createdAt: fileData.createdAt,
        streamUrl: `${WEBAPP_URL}/stream/${fileId}`,
        downloadUrl: `${WEBAPP_URL}/download/${fileId}`
    });
});

// List all files API
app.get('/api/files', (req, res) => {
    const files = [];
    
    for (const [id, data] of FILE_DATABASE.entries()) {
        files.push({
            id: id,
            fileName: data.fileName,
            fileSize: formatFileSize(data.fileSize),
            views: data.views,
            streamUrl: `${WEBAPP_URL}/stream/${id}`
        });
    }
    
    res.json({ 
        total: files.length,
        files: files 
    });
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

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📡 Webhook URL: ${WEBAPP_URL}`);
    console.log(`🤖 Bot is ready to generate links!`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n⏸️ Shutting down gracefully...');
    bot.stopPolling();
    process.exit(0);
});
