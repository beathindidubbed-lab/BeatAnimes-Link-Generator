// ============================================
// ADVANCED TELEGRAM PERMANENT LINK BOT
// With Admin Panel, Beautiful UI, and Analytics
// ============================================

import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import fetch from 'node-fetch';
import mongoose from 'mongoose'; // <-- New import for MongoDB

// ============================================
// CONFIGURATION
// ============================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-app.onrender.com';
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI; // <-- New MongoDB URI

// Admin Configuration
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id)) : [];
const WELCOME_PHOTO_ID = process.env.WELCOME_PHOTO_ID || null; // Photo file_id from your channel
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@YourChannel'; // Your channel username

if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN is required!');
    process.exit(1);
}

// Check for MongoDB URI
if (!MONGO_URI) {
    console.warn('⚠️ MONGO_URI is missing. Bot is running in IN-MEMORY (volatile) mode.');
}


// ============================================
// DATABASE & MODELS (PERSISTENT & IN-MEMORY)
// ============================================

// In-Memory Fallback (Used if MONGO_URI is missing, and for URL Cache)
const FILE_DATABASE = new Map();
const USER_DATABASE = new Map();
const URL_CACHE = new Map();
const URL_CACHE_DURATION = 23 * 60 * 60 * 1000;

// Analytics (Will be loaded from DB on startup, and updated in DB)
let ANALYTICS = {
    totalViews: 0,
    totalDownloads: 0,
    totalFiles: 0,
    totalUsers: 0,
    startTime: Date.now()
};

// Mongoose Schemas and Models (for persistence)

const FileSchema = new mongoose.Schema({
    _id: String, // Use uniqueId as _id
    fileId: String,
    fileUniqueId: String,
    fileName: String,
    fileSize: Number,
    uploadedBy: Number,
    uploaderName: String,
    chatId: Number,
    createdAt: { type: Date, default: Date.now },
    views: { type: Number, default: 0 },
    downloads: { type: Number, default: 0 },
    lastAccessed: { type: Date, default: Date.now }
});
const FileModel = mongoose.model('File', FileSchema);

const UserSchema = new mongoose.Schema({
    userId: { type: Number, unique: true, index: true },
    username: String,
    firstName: String,
    joinedAt: { type: Date, default: Date.now },
    totalUploads: { type: Number, default: 0 },
    lastActive: { type: Date, default: Date.now },
    isBlocked: { type: Boolean, default: false }
});
const UserModel = mongoose.model('User', UserSchema);

const AnalyticSchema = new mongoose.Schema({
    name: { type: String, unique: true, default: 'global' },
    totalViews: { type: Number, default: 0 },
    totalDownloads: { type: Number, default: 0 },
    totalFiles: { type: Number, default: 0 },
    totalUsers: { type: Number, default: 0 },
    startTime: { type: Date, default: Date.now }
});
const AnalyticModel = mongoose.model('Analytic', AnalyticSchema);

// Connection and Initialization Function
async function initDatabase() {
    if (!MONGO_URI) return; // Use in-memory if no URI
    
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ MongoDB connected successfully!');

        // 1. Load or Initialize Analytics
        let analyticDoc = await AnalyticModel.findOneAndUpdate(
            { name: 'global' }, 
            { $setOnInsert: ANALYTICS }, 
            { upsert: true, new: true }
        );
        ANALYTICS = analyticDoc.toObject();

    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        console.warn('⚠️ Falling back to IN-MEMORY (volatile) mode due to DB failure.');
        // Set MONGO_URI to null to force in-memory operations
        process.env.MONGO_URI = null; 
    }
}


// ============================================
// TELEGRAM BOT
// ============================================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('✅ Bot object created.');


// ============================================
// HELPER FUNCTIONS (Refactored to be Async)
// ============================================

function isAdmin(userId) {
    return ADMIN_IDS.includes(userId);
}

async function registerUser(userId, username, firstName) {
    if (!process.env.MONGO_URI) {
        // IN-MEMORY FALLBACK
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
    
    // MONGODB PERSISTENCE
    const result = await UserModel.findOneAndUpdate(
        { userId: userId },
        { 
            username: username || 'Unknown',
            firstName: firstName || 'User',
            lastActive: Date.now()
        },
        { upsert: true, new: true }
    );
    
    if (result.isNew) { // Check if the document was just created
        await AnalyticModel.updateOne({ name: 'global' }, { $inc: { totalUsers: 1 } });
        ANALYTICS.totalUsers++;
    }
    return result;
}

async function getUserStats(userId) {
    if (!process.env.MONGO_URI) {
        // IN-MEMORY FALLBACK
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
    
    // MONGODB PERSISTENCE
    const fileStats = await FileModel.aggregate([
        { $match: { uploadedBy: userId } },
        { $group: { 
            _id: null, 
            files: { $sum: 1 }, 
            views: { $sum: '$views' } 
        }}
    ]);
    
    return fileStats[0] || { files: 0, views: 0 };
}

// ============================================
// KEYBOARD LAYOUTS
// ============================================

// ... (No change to keyboard functions) ...
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
// BOT COMMANDS - START (Refactored to be Async)
// ============================================

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const firstName = msg.from.first_name;
    
    // Use async helper
    await registerUser(userId, username, firstName); 
    
    // Fetch latest total counts (from global ANALYTICS variable)
    const totalFiles = process.env.MONGO_URI ? await FileModel.countDocuments() : ANALYTICS.totalFiles;
    const totalUsers = process.env.MONGO_URI ? await UserModel.countDocuments() : ANALYTICS.totalUsers;

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

<b>👥 Users:</b> ${totalUsers}
<b>📁 Files:</b> ${totalFiles}
<b>👁️ Total Views:</b> ${ANALYTICS.totalViews}

Join our channel: ${CHANNEL_USERNAME}
    `;
    
    const keyboard = getMainKeyboard(isAdmin(userId));
    
    if (WELCOME_PHOTO_ID) {
        try {
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
// CALLBACK QUERY HANDLER (Refactored to be Async)
// ============================================

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;
    const messageId = query.message.message_id;
    
    try {
        // My Stats
        if (data === 'my_stats') {
            // Use async helper
            const user = await registerUser(userId); // Fetches user data
            const stats = await getUserStats(userId); // Use async helper
            
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
            
            let filesQuery;
            if (!process.env.MONGO_URI) {
                // IN-MEMORY FALLBACK
                filesQuery = Array.from(FILE_DATABASE.entries())
                    .filter(([id, file]) => file.uploadedBy === userId);
            } else {
                // MONGODB PERSISTENCE
                filesQuery = await FileModel.find({ uploadedBy: userId }).sort({ createdAt: -1 }).limit(10).lean();
            }

            for (const file of filesQuery) {
                const id = process.env.MONGO_URI ? file._id : file[0];
                const fileData = process.env.MONGO_URI ? file : file[1];
                
                count++;
                fileList += `${count}. ${fileData.fileName}\n`;
                fileList += `   👁️ ${fileData.views} views\n`;
                fileList += `   🆔 <code>${id}</code>\n\n`;
                
                buttons.push([
                    { text: `📄 ${fileData.fileName.substring(0, 20)}...`, callback_data: `file_${id}` }
                ]);
            }
            
            if (count === 0) {
                fileList = '📭 You haven\'t uploaded any files yet.\n\nSend me a video to get started!';
            } 
            // Note: MongoDB query already limits to 10
            
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
            // Recalculate global stats for admin view
            const totalUsers = process.env.MONGO_URI ? await UserModel.countDocuments() : USER_DATABASE.size;
            const totalFiles = process.env.MONGO_URI ? await FileModel.countDocuments() : FILE_DATABASE.size;

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
            let topFilesData;

            if (!process.env.MONGO_URI) {
                // IN-MEMORY FALLBACK
                for (const file of FILE_DATABASE.values()) {
                    totalSize += file.fileSize;
                }
                topFilesData = Array.from(FILE_DATABASE.entries());
            } else {
                // MONGODB PERSISTENCE
                const totalSizeResult = await FileModel.aggregate([
                    { $group: { _id: null, totalSize: { $sum: '$fileSize' } } }
                ]);
                totalSize = totalSizeResult[0]?.totalSize || 0;
                topFilesData = await FileModel.find().sort({ views: -1 }).limit(5).lean();
            }

            const uptime = process.uptime();
            const statsText = `
📊 <b>Detailed Statistics</b>

👥 <b>Users:</b> ${process.env.MONGO_URI ? await UserModel.countDocuments() : USER_DATABASE.size}
📁 <b>Total Files:</b> ${process.env.MONGO_URI ? await FileModel.countDocuments() : FILE_DATABASE.size}
💾 <b>Total Storage:</b> ${formatFileSize(totalSize)}
👁️ <b>Total Views:</b> ${ANALYTICS.totalViews}
⬇️ <b>Total Downloads:</b> ${ANALYTICS.totalDownloads}
🔄 <b>Cached URLs:</b> ${URL_CACHE.size}

⏱️ <b>Uptime:</b> ${formatUptime(uptime)}
🚀 <b>Running Since:</b> ${formatDate(ANALYTICS.startTime)}

<b>Top Files:</b>
${getTopFiles(5, topFilesData)}
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
            
            let usersQuery;
            if (!process.env.MONGO_URI) {
                // IN-MEMORY FALLBACK
                usersQuery = Array.from(USER_DATABASE.values());
            } else {
                // MONGODB PERSISTENCE
                usersQuery = await UserModel.find().sort({ joinedAt: -1 }).limit(15).lean();
            }

            for (const user of usersQuery) {
                count++;
                const stats = await getUserStats(user.userId); // Use async helper
                userList += `${count}. ${user.firstName} (@${user.username || 'N/A'})\n`;
                userList += `   Files: ${stats.files} | Views: ${stats.views}\n`;
                userList += `   Joined: ${formatDate(user.joinedAt)}\n\n`;
            }
            
            if (process.env.MONGO_URI && await UserModel.countDocuments() > 15) {
                userList += `\n<i>Showing 15 of ${await UserModel.countDocuments()} users</i>`;
            } else if (!process.env.MONGO_URI && USER_DATABASE.size > 15) {
                 userList += `\n<i>Showing 15 of ${USER_DATABASE.size} users</i>`;
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
            await bot.deleteMessage(chatId, messageId);
            // Simulate the /start command by emitting a message event
            bot.emit('message', { 
                ...query.message, 
                text: '/start', 
                from: query.from, 
                chat: { id: chatId } 
            });
        }
        
        // File Details
        else if (data.startsWith('file_')) {
            const fileId = data.substring(5);
            
            let fileData;
            if (!process.env.MONGO_URI) {
                fileData = FILE_DATABASE.get(fileId);
            } else {
                fileData = await FileModel.findById(fileId).lean();
            }

            if (!fileData) {
                return bot.answerCallbackQuery(query.id, {
                    text: '❌ File not found in database!',
                    show_alert: true
                });
            }
            
            const fileText = `
📁 <b>File Details</b>

<b>Name:</b> ${fileData.fileName}
<b>Size:</b> ${formatFileSize(fileData.fileSize)}
<b>ID:</b> <code>${fileId}</code>
<b>Uploaded:</b> ${formatDate(fileData.createdAt)}
<b>Views:</b> ${fileData.views}
<b>Downloads:</b> ${fileData.downloads}

Choose an action:
            `;
            
            await bot.editMessageText(fileText, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: getFileActionsKeyboard(fileId)
            });
        }

        // Get Link
        else if (data.startsWith('get_link_')) {
            const fileId = data.substring(9);
            const streamLink = `${WEBAPP_URL}/stream/${fileId}`;

            await bot.answerCallbackQuery(query.id, {
                text: `🔗 Streaming Link: ${streamLink}`,
                show_alert: true
            });
        }

        // File Stats (from button on file page)
        else if (data.startsWith('file_stats_')) {
            const fileId = data.substring(11);
            let fileData;
            if (!process.env.MONGO_URI) {
                fileData = FILE_DATABASE.get(fileId);
            } else {
                fileData = await FileModel.findById(fileId).lean();
            }
            
            if (!fileData) {
                return bot.answerCallbackQuery(query.id, {
                    text: '❌ File not found in database!',
                    show_alert: true
                });
            }

            await bot.answerCallbackQuery(query.id, {
                text: `📊 Stats for ${fileData.fileName}:\n👁️ Views: ${fileData.views}\n⬇️ Downloads: ${fileData.downloads}`,
                show_alert: true
            });
        }

        // Delete File
        else if (data.startsWith('delete_file_')) {
            const fileId = data.substring(12);
            
            let fileData;
            if (!process.env.MONGO_URI) {
                fileData = FILE_DATABASE.get(fileId);
            } else {
                fileData = await FileModel.findById(fileId).lean();
            }

            if (!isAdmin(userId) && fileData.uploadedBy !== userId) {
                 return bot.answerCallbackQuery(query.id, {
                    text: '❌ You are not authorized to delete this file!',
                    show_alert: true
                });
            }

            if (!process.env.MONGO_URI) {
                FILE_DATABASE.delete(fileId);
                ANALYTICS.totalFiles--;
            } else {
                await FileModel.deleteOne({ _id: fileId });
                await AnalyticModel.updateOne({ name: 'global' }, { $inc: { totalFiles: -1 } });
                ANALYTICS.totalFiles--;
            }

            await bot.answerCallbackQuery(query.id, {
                text: `🗑️ File ${fileData.fileName} deleted successfully!`,
                show_alert: true
            });

            // Re-render my_files
            await bot.deleteMessage(chatId, messageId);
            bot.emit('callback_query', { 
                ...query, 
                data: 'my_files'
            });
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
// FILE UPLOAD HANDLER (Refactored to be Async)
// ============================================

bot.on('message', async (msg) => {
    if (msg.text && msg.text.startsWith('/')) return;
    
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username;
    const firstName = msg.from.first_name;
    
    // Use async helper
    const user = await registerUser(userId, username, firstName); 
    
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
        
        const fileData = {
            _id: uniqueId, // Mongoose uses _id for the primary key
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
        };

        if (!process.env.MONGO_URI) {
            // IN-MEMORY FALLBACK
            FILE_DATABASE.set(uniqueId, fileData);
            user.totalUploads++;
            ANALYTICS.totalFiles++;
        } else {
            // MONGODB PERSISTENCE
            await FileModel.create(fileData);
            await UserModel.updateOne({ userId: userId }, { $inc: { totalUploads: 1 } });
            await AnalyticModel.updateOne({ name: 'global' }, { $inc: { totalFiles: 1 } });
            ANALYTICS.totalFiles++;
        }
        
        
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
    
    let usersQuery;
    if (!process.env.MONGO_URI) {
        usersQuery = Array.from(USER_DATABASE.values());
    } else {
        usersQuery = await UserModel.find({}, 'userId').lean();
    }

    for (const user of usersQuery) {
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
// ... (No change to getFreshFileUrl, it uses in-memory cache) ...
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
// EXPRESS SERVER - Beautiful Admin Panel (Refactored to be Async)
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

// Home page - Beautiful landing (Refactored to be Async)
app.get('/', async (req, res) => {
    const totalUsers = process.env.MONGO_URI ? await UserModel.countDocuments() : ANALYTICS.totalUsers;
    const totalFiles = process.env.MONGO_URI ? await FileModel.countDocuments() : ANALYTICS.totalFiles;
    
    res.send(`
<!DOCTYPE html>
<html lang="en">
// ... (HTML content unchanged) ...
<body>
    <div class="container">
        <h1>🎬 BeatAnimes</h1>
        <p>Generate Permanent Streaming Links for Your Videos</p>
        
        <div class="stats">
            <div class="stat-card">
                <div class="stat-number">${totalUsers}</div>
                <div class="stat-label">Users</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${totalFiles}</div>
                <div class="stat-label">Files</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${ANALYTICS.totalViews}</div>
                <div class="stat-label">Views</div>
            </div>
        </div>
        
// ... (Rest of HTML unchanged) ...
</html>
    `);
});

// Health check (Refactored to be Async)
app.get('/ping', async (req, res) => {
    const totalFiles = process.env.MONGO_URI ? await FileModel.countDocuments() : FILE_DATABASE.size;
    const totalUsers = process.env.MONGO_URI ? await UserModel.countDocuments() : USER_DATABASE.size;

    res.json({
        status: 'ok',
        uptime: process.uptime(),
        files: totalFiles,
        users: totalUsers,
        views: ANALYTICS.totalViews,
        downloads: ANALYTICS.totalDownloads
    });
});

// Stream video with range support (Refactored to be Async)
app.get('/stream/:id', async (req, res) => {
    const fileId = req.params.id;
    
    let fileData;
    if (!process.env.MONGO_URI) {
        fileData = FILE_DATABASE.get(fileId);
    } else {
        fileData = await FileModel.findById(fileId).lean();
    }
    
    if (!fileData) {
        return res.status(404).send('File not found');
    }
    
    try {
        if (!process.env.MONGO_URI) {
            fileData.views++;
            fileData.lastAccessed = Date.now();
        } else {
             await FileModel.updateOne({ _id: fileId }, { 
                $inc: { views: 1 }, 
                lastAccessed: Date.now() 
            });
        }

        await AnalyticModel.updateOne({ name: 'global' }, { $inc: { totalViews: 1 } });
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


// Download video (Refactored to be Async)
app.get('/download/:id', async (req, res) => {
    const fileId = req.params.id;
    
    let fileData;
    if (!process.env.MONGO_URI) {
        fileData = FILE_DATABASE.get(fileId);
    } else {
        fileData = await FileModel.findById(fileId).lean();
    }
    
    if (!fileData) {
        return res.status(404).send('File not found');
    }
    
    try {
        if (!process.env.MONGO_URI) {
            fileData.downloads++;
        } else {
            await FileModel.updateOne({ _id: fileId }, { $inc: { downloads: 1 } });
        }
        
        await AnalyticModel.updateOne({ name: 'global' }, { $inc: { totalDownloads: 1 } });
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
});

// File info API (Refactored to be Async)
app.get('/api/file/:id', async (req, res) => {
    const fileId = req.params.id;
    
    let fileData;
    if (!process.env.MONGO_URI) {
        fileData = FILE_DATABASE.get(fileId);
    } else {
        fileData = await FileModel.findById(fileId).lean();
    }

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

// List all files API (Refactored to be Async)
app.get('/api/files', async (req, res) => {
    const files = [];
    
    let filesQuery;
    if (!process.env.MONGO_URI) {
        filesQuery = Array.from(FILE_DATABASE.entries());
    } else {
        filesQuery = await FileModel.find().lean();
    }

    for (const file of filesQuery) {
        const id = process.env.MONGO_URI ? file._id : file[0];
        const data = process.env.MONGO_URI ? file : file[1];

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

function getTopFiles(limit = 5, topFilesData) {
    let sorted;
    if (!process.env.MONGO_URI) {
        // IN-MEMORY FALLBACK
        sorted = Array.from(topFilesData)
            .sort((a, b) => b[1].views - a[1].views)
            .slice(0, limit);
    } else {
        // MONGODB PERSISTENCE
        sorted = topFilesData;
    }
    
    let result = '';
    sorted.forEach((item, i) => {
        const file = process.env.MONGO_URI ? item : item[1];
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
// Wrap the start logic in an async IIFE to connect to DB first
(async () => {
    await initDatabase(); 
    
    app.listen(PORT, () => {
        console.log('═══════════════════════════════════════');
        console.log('🎬 BeatAnimes Link Generator Bot');
        console.log('═══════════════════════════════════════');
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`📡 URL: ${WEBAPP_URL}`);
        console.log(`👑 Admins: ${ADMIN_IDS.length}`);
        console.log(`🤖 Bot is ready! (Persistence: ${process.env.MONGO_URI ? 'MongoDB' : 'In-Memory'})`);
        console.log('═══════════════════════════════════════');
    });
})();

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n⏸️ Shutting down...');
    bot.stopPolling();
    if (mongoose.connection.readyState === 1) {
        mongoose.disconnect();
        console.log('👋 MongoDB disconnected.');
    }
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
}, 60 * 60 * 1000);
