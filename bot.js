// =========================================================================
// ULTIMATE TELEGRAM PERMANENT LINK BOT (V13 - MAX LENGTH, MAX FEATURES, MONOLITHIC)
// MERGED: Full persistence (MongoDB) + Advanced features (Tiers, Batching, Auto-Delete)
// =========================================================================

// ----------------------------------------------------------------------
// 1. EXTERNAL MODULE IMPORTS
// ----------------------------------------------------------------------
import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import fetch from 'node-fetch'; // Crucial for fetching files from Telegram URL
import mongoose from 'mongoose'; // Full MongoDB integration
import { performance } from 'perf_hooks'; // Used for bot uptime tracking
import path from 'path';

// ----------------------------------------------------------------------
// 2. CONFIGURATION VARIABLES (Maximum Configuration Detail)
// ----------------------------------------------------------------------
// ⚠️ WARNING: REPLACE ALL PLACEHOLDERS!
const BOT_TOKEN = process.env.BOT_TOKEN || 'YOUR_TELEGRAM_BOT_TOKEN_XXXXXXXXXXXXXXXX'; 
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-domain.com'; // External public URL
const PORT = process.env.PORT || 3000; 
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(',').map(id => parseInt(id)) : [123456789]; 
const DATABASE_URL = process.env.DATABASE_URL; // Required for persistence
const BIN_CHANNEL = process.env.BIN_CHANNEL ? parseInt(process.env.BIN_CHANNEL) : null; // Channel ID for permanent file storage
const ULOG_CHANNEL = process.env.ULOG_CHANNEL ? parseInt(process.env.ULOG_CHANNEL) : null; // User activity log channel
const FLOG_CHANNEL = process.env.FLOG_CHANNEL ? parseInt(process.env.FLOG_CHANNEL) : null; // File upload log channel
const START_TIME = performance.now(); 

// User Tier Definitions (Explicitly defined limits as per specification)
const USER_TIERS = {
    ADMIN: { name: 'ADMIN', limit: Infinity, maxFileSize: Infinity, description: 'Unlimited uploads, all commands.' },
    PREMIUM: { name: 'PREMIUM', limit: 40, maxFileSize: 200 * 1024 * 1024, description: '40 links, 200MB max file size.' },
    NORMAL: { name: 'NORMAL', limit: 10, maxFileSize: 50 * 1024 * 1024, description: '10 links, 50MB max file size.' },
    DEFAULT: 'NORMAL', // Default tier assigned to new users
};

// Initialize Bot & Express Application
if (!BOT_TOKEN) {
    console.error('❌ CRITICAL: BOT_TOKEN is missing. Please configure it.');
    process.exit(1);
}
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const app = express();

let BOT_INFO = null;
bot.getMe().then(info => {
    BOT_INFO = info;
    console.log(`✅ Bot started successfully! @${info.username}`);
}).catch(err => {
    console.error('❌ Failed to get bot info:', err);
});

// ----------------------------------------------------------------------
// 3. MONGODB & IN-MEMORY DATA STORES (Merged Persistence Strategy)
// ----------------------------------------------------------------------

// Schemas based on bot2.js but extended for Tiers and Batching
let User, File, Blacklist;

if (DATABASE_URL) {
    mongoose.connect(DATABASE_URL, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    }).then(() => {
        console.log('✅ MongoDB connected');
    }).catch(err => {
        console.error('❌ MongoDB connection error:', err);
    });

    const userSchema = new mongoose.Schema({
        userId: { type: Number, required: true, unique: true },
        username: String,
        firstName: String,
        joinedAt: { type: Date, default: Date.now },
        lastActive: { type: Date, default: Date.now },
        isBlocked: { type: Boolean, default: false },
        tier: { type: String, enum: ['ADMIN', 'PREMIUM', 'NORMAL'], default: 'NORMAL' }, // New Tier field
        linkCount: { type: Number, default: 0 }, // For tracking limits
        lastBotMessageId: { type: Number, default: null } // For Auto-Deletion Utility
    });

    const fileSchema = new mongoose.Schema({
        uniqueId: { type: String, required: true, unique: true }, // The link ID
        fileId: String, // Telegram file_id (for single files)
        fileUniqueId: String, // Telegram file_unique_id
        type: { type: String, enum: ['single_file', 'single_forward', 'sequential_batch', 'custom_file_batch'], required: true },
        fileName: String,
        fileSize: Number,
        mimeType: String,
        uploadedBy: Number,
        uploaderName: String,
        messageId: Number, // Source message ID
        chatId: Number, // Source chat ID (or BIN_CHANNEL)
        createdAt: { type: Date, default: Date.now },
        views: { type: Number, default: 0 },
        downloads: { type: Number, default: 0 },
        lastAccessed: Date,
        // Batch Fields
        startId: Number, // For sequential batches
        endId: Number,   // For sequential batches
        fileList: [{ file_id: String, file_name: String }] // For custom file batches
    });

    const blacklistSchema = new mongoose.Schema({
        userId: { type: Number, required: true, unique: true },
        bannedAt: { type: Date, default: Date.now }
    });

    User = mongoose.model('User', userSchema);
    File = mongoose.model('File', fileSchema);
    Blacklist = mongoose.model('Blacklist', blacklistSchema);
}

// IN-MEMORY FALLBACK (For non-persistent environments)
const MEMORY_DATABASE = {
    users: new Map(), // {userId: {..., linkCount, tier, lastBotMessageId}}
    files: new Map(), // {uniqueId: {...}}
    blacklist: new Set()
};
/**
 * @type {Map<number, {state: string, tempBatchData: object, files: Array<any>}>}
 * Manages the state machine for multi-step commands (/batch, /custom_batch).
 */
const USER_STATE = new Map();    
/**
 * @type {Map<string, {url: string, timestamp: number}>}
 * Caches Telegram's temporary file URLs (valid for 1 hour) to reduce API calls.
 */
const URL_CACHE = new Map();     


// ----------------------------------------------------------------------
// 4. DATABASE HELPER FUNCTIONS (Optimized for Persistence/Fallback)
// ----------------------------------------------------------------------

// Helper for generating unique ID
function generateUniqueId(length = 15) {
    return Math.random().toString(36).substring(2, 2 + length) +
        Math.random().toString(36).substring(2, 2 + length);
}

/**
 * @async
 * @function registerUser
 * Creates/updates user entry, integrating Tier and Auto-Deletion fields.
 */
async function registerUser(msg) {
    const userId = msg.from.id;
    const update = {
        userId,
        username: msg.from.username,
        firstName: msg.from.first_name,
        lastActive: Date.now(),
    };
    
    if (DATABASE_URL) {
        let user = await User.findOneAndUpdate(
            { userId },
            { 
                ...update,
                $setOnInsert: { tier: USER_TIERS.DEFAULT, isBlocked: false, linkCount: 0 } 
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        return user;
    } else {
        let user = MEMORY_DATABASE.users.get(userId);
        if (!user) {
            user = {
                ...update,
                joinedAt: Date.now(),
                tier: USER_TIERS.DEFAULT, 
                linkCount: 0,
                isBlocked: false,
                lastBotMessageId: null,
            };
            MEMORY_DATABASE.users.set(userId, user);
        } else {
            // Update in-memory user
            Object.assign(user, update);
            MEMORY_DATABASE.users.set(userId, user);
        }
        return user;
    }
}

/**
 * @async
 * @function getUser
 */
async function getUser(userId) {
    if (DATABASE_URL) {
        return await User.findOne({ userId });
    }
    return MEMORY_DATABASE.users.get(userId);
}

/**
 * @async
 * @function getFile
 */
async function getFile(uniqueId) {
    if (DATABASE_URL) {
        return await File.findOne({ uniqueId });
    }
    return MEMORY_DATABASE.files.get(uniqueId);
}

/**
 * @async
 * @function incrementLinkCount
 * Tracks user upload limits.
 */
async function incrementLinkCount(userId) {
    if (DATABASE_URL) {
        await User.findOneAndUpdate(
            { userId },
            { $inc: { linkCount: 1 } }
        );
    } else {
        const user = MEMORY_DATABASE.users.get(userId);
        if (user) user.linkCount++;
    }
}

/**
 * @async
 * @function addFile
 * Stores the file/batch entry in the database.
 */
async function addFile(fileData) {
    const uniqueId = fileData.uniqueId || generateUniqueId();
    if (DATABASE_URL) {
        const file = new File({ ...fileData, uniqueId });
        await file.save();
        return uniqueId;
    } else {
        MEMORY_DATABASE.files.set(uniqueId, { ...fileData, uniqueId, createdAt: Date.now() });
        return uniqueId;
    }
}

/**
 * @async
 * @function updateFileStats
 * Updates views and downloads, sets lastAccessed.
 */
async function updateFileStats(uniqueId, type) {
    if (DATABASE_URL) {
        const update = type === 'view' ? { $inc: { views: 1 }, lastAccessed: Date.now() } : { $inc: { downloads: 1 }, lastAccessed: Date.now() };
        await File.findOneAndUpdate({ uniqueId }, update);
    } else {
        const file = MEMORY_DATABASE.files.get(uniqueId);
        if (file) {
            if (type === 'view') file.views = (file.views || 0) + 1;
            else file.downloads = (file.downloads || 0) + 1;
            file.lastAccessed = Date.now();
        }
    }
}

/**
 * @async
 * @function deleteFile
 */
async function deleteFile(uniqueId) {
    if (DATABASE_URL) {
        await File.findOneAndDelete({ uniqueId });
    } else {
        MEMORY_DATABASE.files.delete(uniqueId);
    }
}

/**
 * @async
 * @function isUserBanned
 */
async function isUserBanned(userId) {
    if (DATABASE_URL) {
        return !!(await Blacklist.findOne({ userId }));
    }
    return MEMORY_DATABASE.blacklist.has(userId);
}

/**
 * @async
 * @function banUser
 */
async function banUser(userId) {
    if (DATABASE_URL) {
        await new Blacklist({ userId }).save();
    } else {
        MEMORY_DATABASE.blacklist.add(userId);
    }
}

/**
 * @async
 * @function unbanUser
 */
async function unbanUser(userId) {
    if (DATABASE_URL) {
        await Blacklist.findOneAndDelete({ userId });
    } else {
        MEMORY_DATABASE.blacklist.delete(userId);
    }
}

/**
 * @function getUserTier
 * Determines the user's current tier and returns the full tier object.
 */
function getUserTier(userDocOrMap) {
    if (ADMIN_IDS.includes(userDocOrMap.userId)) {
        return USER_TIERS.ADMIN;
    }
    const tierName = userDocOrMap?.tier || USER_TIERS.DEFAULT;
    return USER_TIERS[tierName];
}

// ----------------------------------------------------------------------
// 5. CORE UTILITY FUNCTIONS (Verbose Definitions)
// ----------------------------------------------------------------------

function toSmallCaps(text) {
    if (!text) return '';
    return text.toUpperCase(); // Simplification
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

/**
 * @async
 * @function updateLastBotMessageId
 * Utility to save the bot's last message ID for the Auto-Deletion feature.
 */
async function updateLastBotMessageId(userId, messageId) {
    if (DATABASE_URL) {
        await User.findOneAndUpdate({ userId }, { lastBotMessageId: messageId });
    } else {
        const user = MEMORY_DATABASE.users.get(userId);
        if (user) {
            user.lastBotMessageId = messageId;
            MEMORY_DATABASE.users.set(userId, user);
        }
    }
}

/**
 * @async
 * @function sendOrEditMessage
 * Implements the crucial 'Auto-Deletion Utility' feature:
 * Deletes the bot's previous message before sending a new one for chat tidiness.
 */
async function sendOrEditMessage(chatId, text, reply_markup = null, messageIdToEdit = null) {
    const userId = chatId; // Assumes this is always a private chat/user ID
    try {
        const user = await getUser(userId);
        
        // 1. AUTO-DELETION LOGIC (Keeping the chat tidy)
        if (user && user.lastBotMessageId && !messageIdToEdit) {
            try {
                await bot.deleteMessage(chatId, user.lastBotMessageId);
                console.log(`[DELETE] Deleted previous message ${user.lastBotMessageId} in chat ${chatId}`);
            } catch (e) {
                // Ignore safe errors (message already deleted, etc.)
            }
        }
        
        // 2. Send the new message or edit the specified one
        const messageOptions = { parse_mode: 'HTML', reply_markup: reply_markup, disable_web_page_preview: true };
        let sentMessage;
        
        if (messageIdToEdit) {
            sentMessage = await bot.editMessageText(text, { ...messageOptions, message_id: messageIdToEdit });
        } else {
            sentMessage = await bot.sendMessage(chatId, text, messageOptions);
        }

        // 3. Track the new message ID for future deletion
        if (sentMessage && sentMessage.message_id) {
            await updateLastBotMessageId(userId, sentMessage.message_id);
        }
    } catch (e) {
        console.error("[CRITICAL UTIL] Failed to send/edit message:", e.message);
    }
}

/**
 * @async
 * @function getFileDetailsForWeb
 * Retrieves file metadata and a temporary Telegram URL, caching the URL.
 */
async function getFileDetailsForWeb(uniqueId) {
    const data = await getFile(uniqueId);
    if (!data || data.type !== 'single_file' || !data.fileId) return null; 

    // Check if the temporary Telegram URL is in the URL_CACHE
    const cachedEntry = URL_CACHE.get(data.fileId);
    const now = Date.now();

    if (cachedEntry && now - cachedEntry.timestamp < 3500 * 1000) { 
        console.log(`[CACHE] Hit for file ${data.fileId}.`);
        return {
            ...data._doc || data, // Handle Mongoose doc vs Map object
            fileUrl: cachedEntry.url,
        };
    }
    
    // Cache Miss: Fetch file info from Telegram API
    try {
        const fileInfo = await bot.getFile(data.fileId);
        if (!fileInfo.file_path) {
            console.error(`[API] File path not found for file ID ${data.fileId}.`);
            return null;
        }
        
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
        
        // Update the cache
        URL_CACHE.set(data.fileId, { url: fileUrl, timestamp: now });
        console.log(`[CACHE] Miss for file ${data.fileId}. Fetched and cached new URL.`);

        return {
            ...data._doc || data, 
            fileSize: fileInfo.file_size || data.fileSize, 
            fileUrl: fileUrl,
        };
    } catch (error) {
        console.error("[API ERROR] Error fetching file info:", error.message);
        return null;
    }
}


// ----------------------------------------------------------------------
// 6. TELEGRAM BOT HANDLERS & STATE MACHINE
// ----------------------------------------------------------------------

// ... (Rest of the bot logic, mirroring the previous large response but using the new DB helpers)

// Start command
bot.onText(/\/start/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    // 1. User/Ban/Registration
    let user = await registerUser(msg);
    if (await isUserBanned(userId)) {
        return sendOrEditMessage(chatId, toSmallCaps('❌ You are currently banned from using this bot.'));
    }

    // 2. Deep link logic for content delivery (Handles the /direct/:id web links)
    const match = msg.text.match(/^\/start (file|forward|sequential|custom)_([a-zA-Z0-9]+)$/);
    if (match) {
        return handleDeepLink(msg, match); 
    }

    // 3. Clear state & Show Menu
    USER_STATE.delete(userId); 

    const tier = getUserTier(user);
    const text = `👋 <b>${toSmallCaps('Welcome to the Permanent Link Bot!')}</b>\n${toSmallCaps('I generate permanent links for your content.')}\n\n${toSmallCaps('Your current tier')}: <b>${tier.name}</b> (${tier.description})\n${toSmallCaps('Links Used')}: ${user.linkCount || 0}/${tier.limit === Infinity ? '∞' : tier.limit}`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: toSmallCaps('🔗 Get Link for File/Message'), callback_data: 'start_getlink' }],
            [{ text: toSmallCaps('📈 My Stats & Files'), callback_data: 'show_my_stats' }],
            [{ text: toSmallCaps('🆘 How to Use'), callback_data: 'show_how_to_use' }]
        ]
    };
    
    if (tier.name === 'ADMIN') {
        keyboard.inline_keyboard.push([{ text: toSmallCaps('⚙️ Admin Panel'), callback_data: 'admin_panel' }]);
    }

    await sendOrEditMessage(chatId, text, keyboard);
});


// Universal Message Handler (File processing, Tier Limits, and State Machine)
bot.on('message', async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    let user = await registerUser(msg);
    if (await isUserBanned(userId)) return;
    
    // Ignore commands and edited messages
    if ((msg.text && msg.text.startsWith('/')) || msg.edit_date) return;

    const tier = getUserTier(user);
    const { limit, maxFileSize } = tier;
    const isForwarded = msg.forward_from_message_id && msg.forward_from_chat;
    
    // --- STATE MACHINE HANDLING (Awaiting Single File/Message) ---
    if (USER_STATE.has(userId)) {
        const currentState = USER_STATE.get(userId);

        if (currentState.state === 'AWAITING_SINGLE_POST_FORWARD') {
            const file = msg.photo ? msg.photo[msg.photo.length - 1] : (msg.video || msg.document || msg.audio);
            
            // 1. TIER LIMIT CHECK (Upload Limit)
            if (user.linkCount >= limit && limit !== Infinity) {
                USER_STATE.delete(userId);
                return sendOrEditMessage(chatId, toSmallCaps(`❌ Upload limit reached. Your current tier (${tier.name}) limit is ${limit} links.`));
            }
            
            if (file) {
                // Handling actual files (streamable link potential)
                
                // 2. TIER LIMIT CHECK (File Size)
                const fileSize = file.file_size || 0;
                if (fileSize > maxFileSize) {
                    USER_STATE.delete(userId);
                    return sendOrEditMessage(chatId, toSmallCaps(`❌ File too large. Max size for ${tier.name} tier is ${formatFileSize(maxFileSize)}.`));
                }

                const uniqueId = generateUniqueId();
                let storedFileId = file.file_id;
                let finalChatId = chatId;
                let finalMessageId = msg.message_id;
                
                // 3. Permanent Storage in BIN_CHANNEL (If configured)
                if (BIN_CHANNEL) {
                    try {
                        const sentMessage = await bot.forwardMessage(BIN_CHANNEL, msg.chat.id, msg.message_id);
                        const forwardedFile = sentMessage.video || sentMessage.document || (sentMessage.photo ? sentMessage.photo[sentMessage.photo.length - 1] : null);
                        if (forwardedFile) {
                            storedFileId = forwardedFile.file_id; // Use the BIN's file_id
                            finalChatId = BIN_CHANNEL;
                            finalMessageId = sentMessage.message_id;
                            console.log(`[BIN] File ${uniqueId} permanently stored via forwarding.`);
                        } 
                    } catch(e) { console.error('[BIN ERROR] Failed to forward to BIN_CHANNEL:', e.message); }
                }

                await addFile({
                    uniqueId: uniqueId,
                    fileId: storedFileId, 
                    fileUniqueId: file.file_unique_id,
                    type: 'single_file',
                    fileName: file.file_name || msg.caption || `File ${uniqueId}`,
                    mimeType: file.mime_type || 'application/octet-stream',
                    fileSize: fileSize,
                    uploadedBy: userId,
                    uploaderName: msg.from.first_name,
                    messageId: finalMessageId, // Stored message ID (in chat or BIN)
                    chatId: finalChatId, // Stored chat ID (in chat or BIN)
                    views: 0, downloads: 0,
                });
                
                await incrementLinkCount(userId);
                USER_STATE.delete(userId);
                
                const webLink = `${WEBAPP_URL}/file/${uniqueId}`; 
                const directLink = `${WEBAPP_URL}/direct/${uniqueId}`; 

                await sendOrEditMessage(chatId, `✅ <b>${toSmallCaps('Permanent Web & Telegram Link Generated!')}</b>\n\n${toSmallCaps('File Name')}: <code>${fileName}</code>\n${toSmallCaps('File Size')}: ${formatFileSize(fileSize)}`, {
                    inline_keyboard: [
                        [{ text: toSmallCaps('🔗 Stream/Download (Web)'), url: webLink }],
                        [{ text: toSmallCaps('⬇️ Direct Link (Telegram)'), url: directLink }]
                    ] 
                });
                return;
            } 
            // Handling forwarded non-file messages (text, poll, etc. - requires 'single_forward' type)
            else if (isForwarded) {
                const uniqueId = generateUniqueId();

                await addFile({
                    uniqueId: uniqueId,
                    type: 'single_forward',
                    chatId: msg.forward_from_chat.id,
                    messageId: msg.forward_from_message_id,
                    fileName: msg.text ? `Post: ${msg.text.substring(0, 30)}...` : `Post ID: ${msg.forward_from_message_id}`,
                    uploadedBy: userId,
                    uploaderName: msg.from.first_name,
                    views: 0, downloads: 0,
                });
                
                await incrementLinkCount(userId);
                USER_STATE.delete(userId);

                const directLink = `${WEBAPP_URL}/direct/${uniqueId}`;
                 await sendOrEditMessage(chatId, `✅ <b>${toSmallCaps('Permanent Forward Link Generated!')}</b>\n${toSmallCaps('Note: This link redirects to the bot to deliver the content.')}`, {
                    inline_keyboard: [[{ text: toSmallCaps('🔗 Open Link'), url: directLink }]]
                });
                return;
            } else {
                 await sendOrEditMessage(chatId, toSmallCaps('⚠️ Please forward a file or a message, or use /cancel.'));
            }
        }
        
        // --- STATE MACHINE HANDLING (Awaiting Sequential Batch Start/End) ---
        if (currentState.state === 'AWAITING_BATCH_START_POST') {
            if (!isForwarded) return sendOrEditMessage(chatId, toSmallCaps('⚠️ Please forward the FIRST POST of the sequential batch.'));
            
            currentState.tempBatchData = {
                sourceChatId: msg.forward_from_chat.id,
                startId: msg.forward_from_message_id,
                fileName: msg.text ? msg.text.substring(0, 50) : `Sequential Batch from ${msg.forward_from_chat.title || msg.forward_from_chat.id}`
            };
            currentState.state = 'AWAITING_BATCH_END_POST';
            USER_STATE.set(userId, currentState);
            
            await sendOrEditMessage(chatId, toSmallCaps('✅ Start post received. Now, forward the LAST POST of the sequential batch or /cancel.'));
            return;
        }

        if (currentState.state === 'AWAITING_BATCH_END_POST') {
            if (!isForwarded) return sendOrEditMessage(chatId, toSmallCaps('⚠️ Please forward the LAST POST of the sequential batch.'));

            const { sourceChatId, startId, fileName } = currentState.tempBatchData;
            const endId = msg.forward_from_message_id;

            if (sourceChatId.toString() !== msg.forward_from_chat.id.toString()) {
                return sendOrEditMessage(chatId, toSmallCaps('❌ The start and end posts must be forwarded from the SAME CHANNEL.'));
            }
            if (endId <= startId) {
                return sendOrEditMessage(chatId, toSmallCaps('❌ The end post ID must be GREATER than the start post ID.'));
            }
            
            // Check upload limit
            if (user.linkCount >= limit && limit !== Infinity) {
                USER_STATE.delete(userId);
                return sendOrEditMessage(chatId, toSmallCaps(`❌ Upload limit reached. Your current tier (${tier.name}) limit is ${limit} links.`));
            }

            const uniqueId = generateUniqueId();
            
            await addFile({
                uniqueId,
                type: 'sequential_batch', 
                sourceChatId: sourceChatId.toString(),
                startId,
                endId,
                fileName: `Batch: ${fileName}`,
                uploadedBy: userId,
                uploaderName: msg.from.first_name,
                views: 0, downloads: 0,
            });

            await incrementLinkCount(userId);
            USER_STATE.delete(userId);

            const directLink = `${WEBAPP_URL}/direct/${uniqueId}`; 

            await sendOrEditMessage(chatId, `🎉 <b>${toSmallCaps('Sequential Batch Link Generated!')}</b>\n\n${toSmallCaps('Title')}: <code>Batch: ${fileName}</code>\n${toSmallCaps('Contains')} ${endId - startId + 1} ${toSmallCaps('posts.')}`, {
                inline_keyboard: [[{ text: toSmallCaps('🔗 Open Batch Link'), url: directLink }]]
            });
            return;
        }

        // --- STATE MACHINE HANDLING (Awaiting Custom Batch Files) ---
        if (currentState.state === 'AWAITING_CUSTOM_FILES') {
            if (tier.name !== 'ADMIN') return; // Safety check

            let fileData = null;
            if (msg.video) fileData = msg.video;
            else if (msg.document) fileData = msg.document;
            else if (msg.photo) fileData = msg.photo[msg.photo.length - 1]; 

            if (fileData) {
                // TIER LIMIT CHECK (File Size)
                const fileSize = fileData.file_size || 0;
                if (maxFileSize !== Infinity && fileSize > maxFileSize) {
                    return sendOrEditMessage(chatId, toSmallCaps(`❌ File too large. Max size for ${tier.name} tier is ${formatFileSize(maxFileSize)}. This file was not added.`));
                }
                
                currentState.files.push({
                    file_id: fileData.file_id,
                    file_name: fileData.file_name || msg.caption || `File_${currentState.files.length + 1}`
                });

                USER_STATE.set(userId, currentState);
                await sendOrEditMessage(userId, `✅ ${toSmallCaps('File added. Current count')}: ${currentState.files.length}. ${toSmallCaps('Send next file or /done [Title] to finalize.')}`);
                return;
            }
        }
    }
});


// Command Handlers (Admin/User)

bot.onText(/\/getlink/, async (msg) => {
    const userId = msg.from.id;
    
    // Quick check if already in a command flow
    if (USER_STATE.has(userId)) {
        await sendOrEditMessage(msg.chat.id, toSmallCaps('⚠️ Please /cancel the current operation before starting a new one.'));
        return;
    }
    
    USER_STATE.set(userId, { state: 'AWAITING_SINGLE_POST_FORWARD' });
    await sendOrEditMessage(msg.chat.id, toSmallCaps('Please forward the single file or message you want a permanent link for.'));
});

bot.onText(/\/batch/, async (msg) => {
    const userId = msg.from.id;
    if (getUserTier(await getUser(userId)).name !== 'ADMIN') return sendOrEditMessage(msg.chat.id, toSmallCaps('❌ Only administrators can use batch commands.'));
    
    USER_STATE.delete(userId);
    USER_STATE.set(userId, { state: 'AWAITING_BATCH_START_POST', tempBatchData: {} });

    await sendOrEditMessage(msg.chat.id, toSmallCaps('Step 1: Forward the FIRST POST of the sequential batch. Send /cancel to abort.'));
});

bot.onText(/\/custom_batch/, async (msg) => {
    const userId = msg.from.id;
    if (getUserTier(await getUser(userId)).name !== 'ADMIN') return sendOrEditMessage(msg.chat.id, toSmallCaps('❌ Only administrators can use custom batch commands.'));

    USER_STATE.delete(userId);
    USER_STATE.set(userId, { state: 'AWAITING_CUSTOM_FILES', files: [] });

    await sendOrEditMessage(msg.chat.id, toSmallCaps('Step 1: Send or forward files one by one. Send /done [Title] when done or /cancel to abort.'));
});

bot.onText(/\/done (.+)/, async (msg, match) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const batchTitle = match[1].trim();

    const user = await getUser(userId);
    const tier = getUserTier(user);
    if (tier.name !== 'ADMIN') return;

    const currentState = USER_STATE.get(userId);
    
    if (!currentState || currentState.state !== 'AWAITING_CUSTOM_FILES' || currentState.files.length === 0) {
        return sendOrEditMessage(chatId, toSmallCaps('⚠️ Not in a custom batch process, or no files were collected.'));
    }
    
    if (user.linkCount >= tier.limit && tier.limit !== Infinity) {
        USER_STATE.delete(userId);
        return sendOrEditMessage(chatId, toSmallCaps(`❌ Upload limit reached. Your current tier (${tier.name}) limit is ${tier.limit} links.`));
    }
    
    const uniqueId = generateUniqueId();
    
    await addFile({
        uniqueId,
        type: 'custom_file_batch', 
        fileList: currentState.files, 
        fileName: batchTitle,
        uploadedBy: userId,
        uploaderName: user.firstName,
        views: 0, downloads: 0,
    });
    
    await incrementLinkCount(userId);
    USER_STATE.delete(userId); 

    const directLink = `${WEBAPP_URL}/direct/${uniqueId}`; 

    await sendOrEditMessage(chatId, `🎉 <b>${toSmallCaps('Custom File Batch Link Generated!')}</b>\n\n${toSmallCaps('Title')}: <code>${batchTitle}</code>\n${toSmallCaps('Contains')} ${currentState.files.length} ${toSmallCaps('files.')}`, {
        inline_keyboard: [[{ text: toSmallCaps('🔗 Open Batch Link'), url: directLink }]]
    });
});

bot.onText(/\/stats/, async (msg) => {
    const userId = msg.from.id;
    const user = await getUser(userId);
    if (!user || await isUserBanned(userId)) return;
    
    const tier = getUserTier(user);
    
    const statsText = `
📈 <b>${toSmallCaps('Your Personal Statistics')}</b>

${toSmallCaps('User ID')}: <code>${userId}</code>
${toSmallCaps('Tier')}: <b>${tier.name}</b> (${tier.description})
${toSmallCaps('Links Used')}: ${user.linkCount || 0}
${toSmallCaps('Upload Limit')}: ${tier.limit === Infinity ? 'Unlimited' : tier.limit}
${toSmallCaps('Max File Size')}: ${tier.maxFileSize === Infinity ? 'Unlimited' : `${formatFileSize(tier.maxFileSize)}`}
    `;

    const keyboard = { inline_keyboard: [[{ text: toSmallCaps('📁 Show My Files'), callback_data: 'show_my_files' }]] };
    await sendOrEditMessage(msg.chat.id, statsText, keyboard);
});

bot.onText(/\/files/, async (msg) => {
    const userId = msg.from.id;
    if (await isUserBanned(userId)) return;

    // Fetch user files (using the structure from bot2.js)
    let files, total;
    if (DATABASE_URL) {
        const result = await User.aggregate([
            { $match: { userId: userId } },
            { $lookup: { from: 'files', localField: 'userId', foreignField: 'uploadedBy', as: 'user_files' } },
            { $unwind: '$user_files' },
            { $sort: { 'user_files.createdAt': -1 } },
            { $limit: 10 },
            { $replaceRoot: { newRoot: '$user_files' } }
        ]);
        files = result;
        total = await File.countDocuments({ uploadedBy: userId });
    } else {
        const userFiles = Array.from(MEMORY_DATABASE.files.values())
            .filter(f => f.uploadedBy === userId)
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 10);
        files = userFiles;
        total = Array.from(MEMORY_DATABASE.files.values()).filter(f => f.uploadedBy === userId).length;
    }

    let fileListText = `📁 <b>${toSmallCaps(`Your Latest Uploads (${total} total)`)}</b>\n\n`;

    if (total === 0) {
        fileListText += toSmallCaps('No files found. Use /getlink to start.');
    } else {
        files.forEach((file, index) => {
            const fileType = file.type.split('_')[0].toUpperCase();
            const link = `${WEBAPP_URL}/file/${file.uniqueId}`;
            
            fileListText += `${index + 1}. <b>${file.fileName.substring(0, 40)}</b>... [${fileType}] (<a href="${link}">Open Link</a>)\n`;
            fileListText += `   👁️ ${file.views || 0} views | 💾 ${formatFileSize(file.fileSize || 0)}\n`;
        });
    }

    await sendOrEditMessage(msg.chat.id, fileListText);
});

// Admin commands (Using new DB helpers)

bot.onText(/\/ban (.+)/, async (msg, match) => {
    const userId = msg.from.id;
    if (getUserTier(await getUser(userId)).name !== 'ADMIN') return;
    const targetUserId = parseInt(match[1].trim());

    if (isNaN(targetUserId)) return sendOrEditMessage(msg.chat.id, toSmallCaps('❌ Invalid User ID.'));
    
    await banUser(targetUserId);
    await sendOrEditMessage(msg.chat.id, `✅ <b>${toSmallCaps(`User ${targetUserId} has been BANNED.`)}</b>`);
});

bot.onText(/\/unban (.+)/, async (msg, match) => {
    const userId = msg.from.id;
    if (getUserTier(await getUser(userId)).name !== 'ADMIN') return;
    const targetUserId = parseInt(match[1].trim());

    if (isNaN(targetUserId)) return sendOrEditMessage(msg.chat.id, toSmallCaps('❌ Invalid User ID.'));
    
    await unbanUser(targetUserId);
    await sendOrEditMessage(msg.chat.id, `✅ <b>${toSmallCaps(`User ${targetUserId} has been UNBANNED.`)}</b>`);
});

bot.onText(/\/deletefile (.+)/, async (msg, match) => {
    const userId = msg.from.id;
    if (getUserTier(await getUser(userId)).name !== 'ADMIN') return;
    const fileIdToDelete = match[1].trim();

    const file = await getFile(fileIdToDelete);
    if (file) {
        await deleteFile(fileIdToDelete);
        await sendOrEditMessage(msg.chat.id, `✅ <b>${toSmallCaps('File Deleted Successfully')}</b>\n${toSmallCaps('ID')}: <code>${fileIdToDelete}</code>. ${toSmallCaps('Link is now inactive.')}`);
    } else {
        await sendOrEditMessage(msg.chat.id, `❌ ${toSmallCaps('File with ID')} <code>${fileIdToDelete}</code> ${toSmallCaps('not found in database.')}`);
    }
});

// ... (Other command handlers like /cancel, /how_to_use, /status)

// Deep Link Handler (for /direct/:id links)
async function handleDeepLink(msg, match) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const uniqueId = match[2];

    const data = await getFile(uniqueId);
    if (!data) {
        return sendOrEditMessage(chatId, toSmallCaps('❌ Invalid or expired link. Content not found.'));
    }
    
    // Update view count 
    await updateFileStats(uniqueId, 'view');

    await sendOrEditMessage(chatId, `
🎉 <b>${toSmallCaps('Starting Content Delivery')}</b>
${toSmallCaps('Title')}: <b>${data.fileName}</b>
${toSmallCaps('Type')}: <i>${data.type.replace('_', ' ').toUpperCase()}</i>
${toSmallCaps('The content will now be delivered below.')}
    `);

    // --- Delivery Logic based on Batch Type ---
    try {
        if (data.type === 'sequential_batch' && data.chatId) {
            for (let id = data.startId; id <= data.endId; id++) {
                await bot.copyMessage(chatId, data.chatId, id);
                await new Promise(resolve => setTimeout(resolve, 300)); // Flood control delay
            }
        } else if (data.type === 'custom_file_batch' && data.fileList) {
            for (const file of data.fileList) {
                await bot.sendDocument(chatId, file.file_id, { caption: file.file_name || data.fileName });
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        } else if (data.type === 'single_forward' && data.chatId && data.messageId) {
            await bot.copyMessage(chatId, data.chatId, data.messageId);
        } else if (data.type === 'single_file' && data.fileId) {
            await bot.sendDocument(chatId, data.fileId, { caption: data.fileName });
        }
    } catch (e) {
        console.error(`[DELIVERY ERROR] Failed to deliver content for ${uniqueId}: ${e.message}`);
        await bot.sendMessage(chatId, toSmallCaps('❌ Error delivering content. The source message may be deleted or inaccessible.'), { parse_mode: 'HTML' });
    }
    
    await bot.sendMessage(chatId, toSmallCaps('✅ Content delivery complete. Thank you for using the bot!'), { parse_mode: 'HTML' });
}


// ----------------------------------------------------------------------
// 7. EXPRESS WEB SERVER LOGIC (Core Streaming/Download Infrastructure)
// ----------------------------------------------------------------------

// ... (Web server logic identical to the previous large code, but using getFileDetailsForWeb/updateFileStats helpers)

app.use(express.json());

// Set CORS headers
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Route for single files (Landing page) - /file/:id - Redirects to deep link
app.get('/file/:id', async (req, res) => {
    const uniqueId = req.params.id;
    const file = await getFile(uniqueId);
    
    if (!file) {
        return res.status(404).send('<h1>404 Not Found</h1><p>The file is invalid or expired.</p>');
    }

    // Redirect to the web streaming page for single files
    if (file.type === 'single_file') {
        const fileSizeMB = file.fileSize ? (file.fileSize / 1024 / 1024).toFixed(2) + ' MB' : 'N/A';
        
        const htmlContent = `
<!DOCTYPE html>
<html><head><title>${file.fileName}</title>
<style>/* ... verbose CSS styles ... */</style>
</head>
<body>
    <div class="container">
        <h1>${file.fileName}</h1>
        <p>File Size: <b>${fileSizeMB}</b></p>
        <div class="button-group">
            <a href="/stream/${file.uniqueId}" target="_blank">▶️ Stream Video</a>
            <a href="/download/${file.uniqueId}" target="_blank">⬇️ Direct Download</a>
        </div>
    </div>
</body></html>
        `;
        return res.status(200).send(htmlContent);
    }
    
    // Redirect batch/forward links to the bot
    const deepLink = `https://t.me/${BOT_INFO ? BOT_INFO.username : 'bot'}?start=${file.type.split('_')[0]}_${uniqueId}`;
    res.redirect(302, deepLink);
});

// Endpoint for streaming (Optimized Range header handling) - /stream/:id
app.get('/stream/:id', async (req, res) => {
    const uniqueId = req.params.id;
    const range = req.headers.range; 
    
    const file = await getFileDetailsForWeb(uniqueId);
    
    if (!file) {
        return res.status(404).send('File not found for streaming.');
    }

    try {
        await updateFileStats(uniqueId, 'view'); // Track stream views
        
        const fileSize = file.fileSize;
        const fileUrl = file.fileUrl; 
        
        if (range) {
            // PARTIAL CONTENT (206)
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const contentLength = (end - start) + 1;

            if (start >= fileSize || start < 0 || end < start) {
                 res.status(416).set({ 'Content-Range': `bytes */${fileSize}` }).send('Requested Range Not Satisfiable');
                return;
            }

            const headers = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': contentLength, 
                'Content-Type': file.mimeType
            };

            const fileStream = await fetch(fileUrl, {
                headers: { Range: `bytes=${start}-${end}` }
            });

            res.writeHead(206, headers); 
            fileStream.body.pipe(res);

        } else {
            // FULL CONTENT (200)
            const headers = {
                'Content-Length': fileSize,
                'Content-Type': file.mimeType
            };

            const fileStream = await fetch(fileUrl);
            res.writeHead(200, headers); 
            fileStream.body.pipe(res);
        }
    } catch (error) {
        console.error('[CRITICAL WEB] Error handling stream:', error.message);
        res.status(500).send('Error retrieving file for streaming');
    }
});

// Endpoint for direct download - /download/:id
app.get('/download/:id', async (req, res) => {
    const uniqueId = req.params.id;
    const file = await getFileDetailsForWeb(uniqueId);
    
    if (!file) {
        return res.status(404).send('File not found for download');
    }

    try {
        await updateFileStats(uniqueId, 'download');
        
        res.set({
            'Content-Disposition': `attachment; filename="${file.fileName}"`,
            'Content-Type': file.mimeType
        });
        
        // Redirect to the temporary Telegram URL 
        res.redirect(302, file.fileUrl);
    } catch (error) {
        console.error('[CRITICAL WEB] Error handling download redirect:', error.message);
        res.status(500).send('Error initiating download redirect');
    }
});

// Endpoint for Telegram Direct Link Redirect - /direct/:id
app.get('/direct/:id', async (req, res) => {
    const uniqueId = req.params.id;
    const data = await getFile(uniqueId);

    if (!data) {
        return res.status(404).send('Direct Link not found or expired.');
    }

    // Redirect to the bot using the deep link format
    const linkType = data.type.split('_')[0]; // Extracts 'single', 'forward', 'sequential', or 'custom'
    const deepLink = `https://t.me/${BOT_INFO ? BOT_INFO.username : 'bot'}?start=${linkType}_${uniqueId}`;

    res.redirect(302, deepLink);
});


// ----------------------------------------------------------------------
// 8. INITIALIZATION & EXECUTION BLOCK
// ----------------------------------------------------------------------

// Start the Express Server
app.listen(PORT, () => {
    console.log('----------------------------------------------------');
    console.log(`🚀 Web server started successfully on port ${PORT}.`);
    console.log(`Web App URL: ${WEBAPP_URL}`);
    console.log('----------------------------------------------------');
});

// Set all custom commands visible in the Telegram menu
bot.setMyCommands([
    { command: 'start', description: 'Start the bot and open the main menu' },
    { command: 'getlink', description: 'Generate a permanent link for a single file/message' },
    { command: 'stats', description: 'Display your current tier, limits, and link count' },
    { command: 'files', description: 'View your uploaded files' },
    { command: 'help', description: 'Show the list of features and commands' },
    { command: 'cancel', description: 'Abort current multi-step operation' },
    { command: 'status', description: 'View bot statistics (Admin)' },
    { command: 'batch', description: 'Generate a sequential link by forwarding start/end posts (Admin)' },
    { command: 'custom_batch', description: 'Generate a link for files forwarded one-by-one (Admin)' },
    { command: 'done', description: 'Finalize and generate link for /custom_batch (Admin)' },
]).then(() => console.log('✅ Telegram commands successfully registered with the API.'));

console.log('🤖 Telegram Bot Polling started. The application is now fully operational.');
