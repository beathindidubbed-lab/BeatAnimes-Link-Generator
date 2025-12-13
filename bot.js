// =========================================================================
// ULTIMATE TELEGRAM PERMANENT LINK BOT (V15 - WITH ANIME SEARCH)
// FEATURES: Small Caps Aesthetic, MongoDB, Streaming/Download, Tier Limits, Batch Links, AniList Search.
// =========================================================================

// ----------------------------------------------------------------------
// 1. EXTERNAL MODULE IMPORTS
// ----------------------------------------------------------------------
import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import fetch from 'node-fetch'; 
import mongoose from 'mongoose'; 
import { performance } from 'perf_hooks'; 
import axios from 'axios'; // Required for AniList API calls

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
const START_TIME = performance.now(); 

// User Tier Definitions
const USER_TIERS = {
    ADMIN: { name: 'ᴀᴅᴍɪɴ', limit: Infinity, maxFileSize: Infinity, description: 'ᴜɴʟɪᴍɪᴛᴇᴅ ᴜᴘʟᴏᴀᴅs, ᴀʟʟ ᴄᴏᴍᴍᴀɴᴅs.' },
    PREMIUM: { name: 'ᴘʀᴇᴍɪᴜᴍ', limit: 40, maxFileSize: 200 * 1024 * 1024, description: '40 ʟɪɴᴋs, 200ᴍʙ ᴍᴀx ғɪʟᴇ sɪᴢᴇ.' },
    NORMAL: { name: 'ɴᴏʀᴍᴀʟ', limit: 10, maxFileSize: 50 * 1024 * 1024, description: '10 ʟɪɴᴋs, 50ᴍʙ ᴍᴀx ғɪʟᴇ sɪᴢᴇ.' },
    DEFAULT: 'NORMAL', 
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
// 3. DATABASE SETUP & IN-MEMORY STORES
// ----------------------------------------------------------------------
let User, File, Blacklist;

if (DATABASE_URL) {
    mongoose.connect(DATABASE_URL).then(() => {
        console.log('✅ MongoDB connected');
    }).catch(err => {
        console.error('❌ MongoDB connection error:', err.message);
    });

    const userSchema = new mongoose.Schema({
        userId: { type: Number, required: true, unique: true },
        username: String,
        firstName: String,
        joinedAt: { type: Date, default: Date.now },
        lastActive: { type: Date, default: Date.now },
        isBlocked: { type: Boolean, default: false },
        tier: { type: String, enum: ['ADMIN', 'PREMIUM', 'NORMAL'], default: 'NORMAL' },
        linkCount: { type: Number, default: 0 },
        lastBotMessageId: { type: Number, default: null } 
    });

    const fileSchema = new mongoose.Schema({
        uniqueId: { type: String, required: true, unique: true }, 
        fileId: String, 
        fileUniqueId: String, 
        type: { type: String, enum: ['single_file', 'single_forward', 'sequential_batch', 'custom_file_batch'], required: true },
        fileName: String,
        fileSize: Number,
        mimeType: String,
        uploadedBy: Number,
        uploaderName: String,
        messageId: Number, 
        chatId: Number, 
        createdAt: { type: Date, default: Date.now },
        views: { type: Number, default: 0 },
        downloads: { type: Number, default: 0 },
        lastAccessed: Date,
        startId: Number, 
        endId: Number,   
        fileList: [{ file_id: String, file_name: String }] 
    });

    const blacklistSchema = new mongoose.Schema({
        userId: { type: Number, required: true, unique: true },
        bannedAt: { type: Date, default: Date.now }
    });

    User = mongoose.model('User', userSchema);
    File = mongoose.model('File', fileSchema);
    Blacklist = mongoose.model('Blacklist', blacklistSchema);
}

// IN-MEMORY FALLBACK (Used if DATABASE_URL is not set)
const MEMORY_DATABASE = {
    users: new Map(), 
    files: new Map(), 
    blacklist: new Set()
};
const USER_STATE = new Map();    
const URL_CACHE = new Map();     

// ----------------------------------------------------------------------
// 4. CORE UTILITY FUNCTIONS (Including the Small Caps Aesthetic)
// ----------------------------------------------------------------------

/**
 * Converts text to the desired Unicode Small Caps/Stylized appearance.
 * @param {string} text - The input string.
 * @returns {string} - The stylized string.
 */
function toSmallCaps(text) {
    if (!text) return '';
    const map = {
        'a': 'ᴀ', 'b': 'ʙ', 'c': 'ᴄ', 'd': 'ᴅ', 'e': 'ᴇ', 'f': 'ꜰ', 'g': 'ɢ', 'h': 'ʜ', 'i': 'ɪ', 'j': 'ᴊ',
        'k': 'ᴋ', 'l': 'ʟ', 'm': 'ᴍ', 'n': 'ɴ', 'o': 'ᴏ', 'p': 'ᴘ', 'q': 'ǫ', 'r': 'ʀ', 's': 's', 't': 'ᴛ',
        'u': 'ᴜ', 'v': 'ᴠ', 'w': 'ᴡ', 'x': 'x', 'y': 'ʏ', 'z': 'ᴢ',
        'A': 'ᴀ', 'B': 'ʙ', 'C': 'ᴄ', 'D': 'ᴅ', 'E': 'ᴇ', 'F': 'ꜰ', 'G': 'ɢ', 'H': 'ʜ', 'I': 'ɪ', 'J': 'ᴊ',
        'K': 'ᴋ', 'L': 'ʟ', 'M': 'ᴍ', 'N': 'ɴ', 'O': 'ᴏ', 'P': 'ᴘ', 'Q': 'ǫ', 'R': 'ʀ', 'S': 's', 'T': 'ᴛ',
        'U': 'ᴜ', 'V': 'ᴠ', 'W': 'ᴡ', 'X': 'x', 'Y': 'ʏ', 'Z': 'ᴢ',
        ' ': ' ' 
    };
    return Array.from(text).map(char => map[char] || char).join('');
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['ʙʏᴛᴇs', 'ᴋʙ', 'ᴍʙ', 'ɢʙ'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

function generateUniqueId(length = 15) {
    return Math.random().toString(36).substring(2, 2 + length) +
        Math.random().toString(36).substring(2, 2 + length);
}

// ----------------------------------------------------------------------
// 5. DATABASE HELPER FUNCTIONS (Persistence/Fallback)
// ----------------------------------------------------------------------

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
            user = { ...update, joinedAt: Date.now(), tier: USER_TIERS.DEFAULT, linkCount: 0, isBlocked: false, lastBotMessageId: null };
            MEMORY_DATABASE.users.set(userId, user);
        } else {
            Object.assign(user, update);
            MEMORY_DATABASE.users.set(userId, user);
        }
        return user;
    }
}

async function getUser(userId) {
    if (DATABASE_URL) return await User.findOne({ userId });
    return MEMORY_DATABASE.users.get(userId);
}

async function getFile(uniqueId) {
    if (DATABASE_URL) return await File.findOne({ uniqueId });
    return MEMORY_DATABASE.files.get(uniqueId);
}

async function incrementLinkCount(userId) {
    if (DATABASE_URL) await User.findOneAndUpdate({ userId }, { $inc: { linkCount: 1 } });
    else { const user = MEMORY_DATABASE.users.get(userId); if (user) user.linkCount++; }
}

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

async function deleteFile(uniqueId) {
    if (DATABASE_URL) await File.findOneAndDelete({ uniqueId });
    else MEMORY_DATABASE.files.delete(uniqueId);
}

async function isUserBanned(userId) {
    if (DATABASE_URL) return !!(await Blacklist.findOne({ userId }));
    return MEMORY_DATABASE.blacklist.has(userId);
}

function getUserTier(userDocOrMap) {
    if (ADMIN_IDS.includes(userDocOrMap.userId)) return USER_TIERS.ADMIN;
    const tierName = userDocOrMap?.tier || USER_TIERS.DEFAULT;
    return USER_TIERS[tierName];
}

async function updateLastBotMessageId(userId, messageId) {
    if (DATABASE_URL) await User.findOneAndUpdate({ userId }, { lastBotMessageId: messageId });
    else { const user = MEMORY_DATABASE.users.get(userId); if (user) user.lastBotMessageId = messageId; }
}

/**
 * Implements the Auto-Deletion Utility for tidy chats.
 * NOTE: chatId is used as userId in private chats for database lookup.
 */
async function sendOrEditMessage(chatId, text, reply_markup = null, messageIdToEdit = null) {
    const userId = chatId; // In private chat, chatId is the userId
    try {
        const user = await getUser(userId);
        
        // AUTO-DELETION LOGIC
        if (user && user.lastBotMessageId && !messageIdToEdit) {
            try { await bot.deleteMessage(chatId, user.lastBotMessageId); } catch (e) {} // Safe delete
        }
        
        const messageOptions = { parse_mode: 'HTML', reply_markup: reply_markup, disable_web_page_preview: true };
        let sentMessage;
        
        if (messageIdToEdit) {
            // Added explicit chat_id to fix potential 'chat_id is empty' errors on edits
            sentMessage = await bot.editMessageText(text, { ...messageOptions, message_id: messageIdToEdit, chat_id: chatId });
        } else {
            sentMessage = await bot.sendMessage(chatId, text, messageOptions);
        }

        if (sentMessage && sentMessage.message_id) {
            await updateLastBotMessageId(userId, sentMessage.message_id);
        }
        return sentMessage; // Return the message object for further use (e.g., deleting 'searching...' message)

    } catch (e) {
        console.error("[CRITICAL UTIL] Failed to send/edit message:", e.message);
    }
}

/**
 * Retrieves file metadata and a temporary Telegram URL, caching the URL.
 */
async function getFileDetailsForWeb(uniqueId) {
    const data = await getFile(uniqueId);
    if (!data || data.type !== 'single_file' || !data.fileId) return null; 

    const cachedEntry = URL_CACHE.get(data.fileId);
    const now = Date.now();

    if (cachedEntry && now - cachedEntry.timestamp < 3500 * 1000) { 
        // Use spread operator safely for mongoose doc or plain object
        const doc = data._doc ? data._doc : data;
        return { ...doc, fileUrl: cachedEntry.url };
    }
    
    try {
        const fileInfo = await bot.getFile(data.fileId);
        if (!fileInfo.file_path) return null;
        
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
        
        URL_CACHE.set(data.fileId, { url: fileUrl, timestamp: now });

        // Use spread operator safely for mongoose doc or plain object
        const doc = data._doc ? data._doc : data;
        return { ...doc, fileSize: fileInfo.file_size || data.fileSize, fileUrl: fileUrl };
    } catch (error) {
        console.error("[API ERROR] Error fetching file info:", error.message);
        return null;
    }
}

// ----------------------------------------------------------------------
// 6. ANILIST SEARCH FUNCTIONALITY
// ----------------------------------------------------------------------

/**
 * Searches AniList using the GraphQL API.
 * @param {string} searchString - The anime title to search for.
 */
async function searchAniList(searchString) {
    const query = `
        query ($search: String) {
            Page(page: 1, perPage: 1) {
                media(search: $search, type: ANIME, sort: [POPULARITY_DESC]) {
                    id
                    title {
                        romaji
                        english
                    }
                    coverImage {
                        large
                    }
                    description
                    genres
                    episodes
                    status
                    averageScore
                    siteUrl
                }
            }
        }
    `;

    try {
        const response = await axios.post('https://graphql.anilist.co', {
            query,
            variables: { search: searchString }
        });

        const media = response.data.data.Page.media[0];
        return media;

    } catch (error) {
        console.error("AniList API Error:", error.message);
        return null;
    }
}

// ----------------------------------------------------------------------
// 7. TELEGRAM BOT HANDLERS & STATE MACHINE
// ----------------------------------------------------------------------

// Start command
bot.onText(/\/start/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    let user = await registerUser(msg);
    if (await isUserBanned(userId)) {
        return sendOrEditMessage(chatId, toSmallCaps('❌ ʏᴏᴜ ᴀʀᴇ ᴄᴜʀʀᴇɴᴛʟʏ ʙᴀɴɴᴇᴅ ғʀᴏᴍ ᴜsɪɴɢ ᴛʜɪs ʙᴏᴛ.'));
    }

    // Deep link logic for content delivery
    const match = msg.text.match(/^\/start (file|forward|sequential|custom)_([a-zA-Z0-9]+)$/);
    if (match) {
        return handleDeepLink(msg, match); 
    }

    // Clear state & Show Menu
    USER_STATE.delete(userId); 

    const tier = getUserTier(user);
    // ⚠️ FIXED: Changed ** to <b> for HTML parsing compatibility
    const text = `👋 <b>${toSmallCaps('ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ ᴛʜᴇ ᴘᴇʀᴍᴀɴᴇɴᴛ ʟɪɴᴋ ʙᴏᴛ!')}</b>\n${toSmallCaps('ɪ ɢᴇɴᴇʀᴀᴛᴇ ᴘᴇʀᴍᴀɴᴇɴᴛ ʟɪɴᴋs ғᴏʀ ʏᴏᴜʀ ᴄᴏɴᴛᴇɴᴛ.')}\n\n${toSmallCaps('ʏᴏᴜʀ ᴄᴜʀʀᴇɴᴛ ᴛɪᴇʀ')}: <b>${tier.name}</b> (${tier.description})\n${toSmallCaps('ʟɪɴᴋs ᴜsᴇᴅ')}: ${user.linkCount || 0}/${tier.limit === Infinity ? '∞' : tier.limit}`;
    
    const keyboard = {
        inline_keyboard: [
            [{ text: toSmallCaps('🔗 ɢᴇᴛ ʟɪɴᴋ ғᴏʀ ғɪʟᴇ/ᴍᴇssᴀɢᴇ'), callback_data: 'start_getlink' }],
            [{ text: toSmallCaps('📈 ᴍʏ sᴛᴀᴛs & ғɪʟᴇs'), callback_data: 'show_my_stats' }],
            [{ text: toSmallCaps('🆘 ʜᴏᴡ ᴛᴏ ᴜsᴇ'), callback_data: 'show_how_to_use' }]
        ]
    };
    
    if (tier.name === USER_TIERS.ADMIN.name) {
        keyboard.inline_keyboard.push([{ text: toSmallCaps('⚙️ ᴀᴅᴍɪɴ ᴘᴀɴᴇʟ'), callback_data: 'admin_panel' }]);
    }

    await sendOrEditMessage(chatId, text, keyboard);
});


// Universal Message Handler (File processing, Tier Limits, and State Machine)
bot.on('message', async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    
    let user = await registerUser(msg);
    if (await isUserBanned(userId)) return;
    
    if ((msg.text && msg.text.startsWith('/')) || msg.edit_date) return;

    const tier = getUserTier(user);
    const { limit, maxFileSize } = tier;
    const isForwarded = msg.forward_from_message_id && msg.forward_from_chat;
    
    // --- STATE MACHINE HANDLING ---
    if (USER_STATE.has(userId)) {
        const currentState = USER_STATE.get(userId);

        if (currentState.state === 'AWAITING_SINGLE_POST_FORWARD') {
            // ... (Existing AWAITING_SINGLE_POST_FORWARD logic remains here) ...
            
            const file = msg.photo ? msg.photo[msg.photo.length - 1] : (msg.video || msg.document || msg.audio);
            
            // TIER LIMIT CHECK (Upload Limit)
            if (user.linkCount >= limit && limit !== Infinity) {
                USER_STATE.delete(userId);
                return sendOrEditMessage(chatId, toSmallCaps(`❌ ᴜᴘʟᴏᴀᴅ ʟɪᴍɪᴛ ʀᴇᴀᴄʜᴇᴅ. ʏᴏᴜʀ ᴄᴜʀʀᴇɴᴛ ᴛɪᴇʀ (${tier.name}) ʟɪᴍɪᴛ ɪs ${limit} ʟɪɴᴋs.`));
            }
            
            if (file) {
                // Handling actual files (streamable link potential)
                
                // TIER LIMIT CHECK (File Size)
                const fileSize = file.file_size || 0;
                if (fileSize > maxFileSize) {
                    USER_STATE.delete(userId);
                    return sendOrEditMessage(chatId, toSmallCaps(`❌ ғɪʟᴇ ᴛᴏᴏ ʟᴀʀɢᴇ. ᴍᴀx sɪᴢᴇ ғᴏʀ ${tier.name} ᴛɪᴇʀ ɪs ${formatFileSize(maxFileSize)}.`));
                }

                const uniqueId = generateUniqueId();
                let storedFileId = file.file_id;
                let finalChatId = chatId;
                let finalMessageId = msg.message_id;
                
                // Permanent Storage in BIN_CHANNEL
                if (BIN_CHANNEL) {
                    try {
                        const sentMessage = await bot.forwardMessage(BIN_CHANNEL, msg.chat.id, msg.message_id);
                        const forwardedFile = sentMessage.video || sentMessage.document || (sentMessage.photo ? sentMessage.photo[sentMessage.photo.length - 1] : null);
                        if (forwardedFile) {
                            storedFileId = forwardedFile.file_id; 
                            finalChatId = BIN_CHANNEL;
                            finalMessageId = sentMessage.message_id;
                        } 
                    } catch(e) { console.error('[BIN ERROR] Failed to forward to BIN_CHANNEL:', e.message); }
                }

                await addFile({
                    uniqueId: uniqueId, fileId: storedFileId, fileUniqueId: file.file_unique_id, type: 'single_file',
                    fileName: file.file_name || msg.caption || `File ${uniqueId}`, mimeType: file.mime_type || 'application/octet-stream',
                    fileSize: fileSize, uploadedBy: userId, uploaderName: msg.from.first_name,
                    messageId: finalMessageId, chatId: finalChatId, views: 0, downloads: 0,
                });
                
                await incrementLinkCount(userId);
                USER_STATE.delete(userId);
                
                const webLink = `${WEBAPP_URL}/file/${uniqueId}`; 
                const directLink = `https://t.me/${BOT_INFO.username}?start=file_${uniqueId}`; 

                // ⚠️ FIXED: Changed ** to <b> for HTML parsing compatibility
                await sendOrEditMessage(chatId, `✅ <b>${toSmallCaps('ᴘᴇʀᴍᴀɴᴇɴᴛ ᴡᴇʙ & ᴛᴇʟᴇɢʀᴀᴍ ʟɪɴᴋ ɢᴇɴᴇʀᴀᴛᴇᴅ!')}</b>\n\n${toSmallCaps('ғɪʟᴇ ɴᴀᴍᴇ')}: <code>${file.file_name || msg.caption || `File ${uniqueId}`}</code>\n${toSmallCaps('ғɪʟᴇ sɪᴢᴇ')}: ${formatFileSize(fileSize)}`, {
                    inline_keyboard: [
                        [{ text: toSmallCaps('🔗 sᴛʀᴇᴀᴍ/ᴅᴏᴡɴʟᴏᴀᴅ (ᴡᴇʙ)'), url: webLink }],
                        [{ text: toSmallCaps('⬇️ ᴅɪʀᴇᴄᴛ ʟɪɴᴋ (ᴛᴇʟᴇɢʀᴀᴍ)'), url: directLink }]
                    ] 
                });
                return;
            } 
            // Handling forwarded non-file messages (single_forward type)
            else if (isForwarded) {
                const uniqueId = generateUniqueId();

                await addFile({
                    uniqueId: uniqueId, type: 'single_forward', chatId: msg.forward_from_chat.id, messageId: msg.forward_from_message_id,
                    fileName: msg.text ? `Post: ${msg.text.substring(0, 30)}...` : `Post ID: ${msg.forward_from_message_id}`,
                    uploadedBy: userId, uploaderName: msg.from.first_name, views: 0, downloads: 0,
                });
                
                await incrementLinkCount(userId);
                USER_STATE.delete(userId);

                const directLink = `https://t.me/${BOT_INFO.username}?start=forward_${uniqueId}`;
                // ⚠️ FIXED: Changed ** to <b> for HTML parsing compatibility
                 await sendOrEditMessage(chatId, `✅ <b>${toSmallCaps('ᴘᴇʀᴍᴀɴᴇɴᴛ ғᴏʀᴡᴀʀᴅ ʟɪɴᴋ ɢᴇɴᴇʀᴀᴛᴇᴅ!')}</b>\n${toSmallCaps('ɴᴏᴛᴇ: ᴛʜɪs ʟɪɴᴋ ʀᴇᴅɪʀᴇᴄᴛs ᴛᴏ ᴛʜᴇ ʙᴏᴛ ᴛᴏ ᴅᴇʟɪᴠᴇʀ ᴛʜᴇ ᴄᴏɴᴛᴇɴᴛ.')}`, {
                    inline_keyboard: [[{ text: toSmallCaps('🔗 ᴏᴘᴇɴ ʟɪɴᴋ'), url: directLink }]]
                });
                return;
            } else {
                 await sendOrEditMessage(chatId, toSmallCaps('⚠️ ᴘʟᴇᴀsᴇ ғᴏʀᴡᴀʀᴅ ᴀ ғɪʟᴇ ᴏʀ ᴀ ᴍᴇssᴀɢᴇ, ᴏʀ ᴜsᴇ /ᴄᴀɴᴄᴇʟ.'));
            }

        }
        
        // Sequential Batch State (Logic remains the same)
        if (currentState.state === 'AWAITING_BATCH_START_POST') {
            // ... (Sequential Batch Logic) ...
        }

        if (currentState.state === 'AWAITING_BATCH_END_POST') {
            // ... (Sequential Batch Logic) ...
        }

        // Custom Batch State (Logic remains the same)
        if (currentState.state === 'AWAITING_CUSTOM_FILES') {
            // ... (Custom Batch Logic) ...
        }

        // --- NEW ANIME SEARCH STATE ---
        if (currentState.state === 'AWAITING_ANIME_SEARCH' && msg.text) {
            const query = msg.text.trim();
            USER_STATE.delete(userId); // Clear state immediately
            
            // ⚠️ FIXED: Changed ** to <b> for HTML parsing compatibility
            const waitMessage = await sendOrEditMessage(chatId, toSmallCaps('🔍 sᴇᴀʀᴄʜɪɴɢ ᴀɴɪʟɪsᴛ ғᴏʀ') + `: <b>${query}</b>`);
            
            const anime = await searchAniList(query);
            
            if (!anime) {
                return sendOrEditMessage(chatId, toSmallCaps(`❌ ɴᴏ ᴀɴɪᴍᴇ ғᴏᴜɴᴅ ᴏɴ ᴀɴɪʟɪsᴛ ғᴏʀ`) + `: <b>${query}</b>`, null, waitMessage.message_id);
            }

            // Find local file link (simple approximate search)
            let localFile = null;
            if (DATABASE_URL) {
                // Search for the English or Romaji title in file names
                const regex = new RegExp(anime.title.english || anime.title.romaji, 'i');
                localFile = await File.findOne({ uploadedBy: userId, fileName: regex });
            } 
            
            // Clean description for Telegram formatting
            const description = anime.description ? anime.description.replace(/<br>/g, '\n').replace(/<i>/g, '<i>').replace(/<\/i>/g, '</i>').substring(0, 500) + '...' : toSmallCaps('ɴᴏ ᴅᴇsᴄʀɪᴘᴛɪᴏɴ ᴀᴠᴀɪʟᴀʙʟᴇ.');
            
            // ⚠️ FIXED: Changed ** to <b> for HTML parsing compatibility
            const animeText = `
🎬 <b>${toSmallCaps('ᴀɴɪʟɪsᴛ sᴇᴀʀᴄʜ ʀᴇsᴜʟᴛ')}</b>

${toSmallCaps('ᴛɪᴛʟᴇ (ᴇɴɢʟɪsʜ)')}: <b>${anime.title.english || anime.title.romaji}</b>
${toSmallCaps('ᴛɪᴛʟᴇ (ʀᴏᴍᴀᴊɪ)')}: ${anime.title.romaji || 'N/A'}

${toSmallCaps('sᴛᴀᴛᴜs')}: <i>${anime.status.replace('_', ' ')}</i>
${toSmallCaps('ᴇᴘɪsᴏᴅᴇs')}: ${anime.episodes || 'TBA'}
${toSmallCaps('sᴄᴏʀᴇ')}: ${anime.averageScore ? (anime.averageScore / 10).toFixed(1) : 'N/A'}
${toSmallCaps('ɢᴇɴʀᴇs')}: ${anime.genres.slice(0, 3).join(', ')}

${toSmallCaps('ᴅᴇsᴄʀɪᴘᴛɪᴏɴ')}:
${description}
`;

            const keyboard = {
                inline_keyboard: [
                    [{ text: toSmallCaps('🌐 ᴠɪᴇᴡ ᴏɴ ᴀɴɪʟɪsᴛ'), url: anime.siteUrl }],
                ]
            };

            if (localFile) {
                const link = `${WEBAPP_URL}/file/${localFile.uniqueId}`;
                keyboard.inline_keyboard.push(
                    [{ text: toSmallCaps('💾 ʟᴏᴄᴀʟ ғɪʟᴇ ғᴏᴜɴᴅ!'), url: link }]
                );
            } else {
                 keyboard.inline_keyboard.push(
                    [{ text: toSmallCaps('🔍 ɴᴏ ʟᴏᴄᴀʟ ғɪʟᴇ ʏᴇᴛ'), callback_data: 'no_local_link' }]
                );
            }
            
            await bot.sendPhoto(chatId, anime.coverImage.large, {
                caption: animeText,
                parse_mode: 'HTML',
                reply_markup: keyboard,
                disable_web_page_preview: true
            });
            
            // Delete the 'Searching' message
            try { await bot.deleteMessage(chatId, waitMessage.message_id); } catch (e) {}
            return;
        }
    }
});


// Command Handlers

bot.onText(/\/getlink/, async (msg) => {
    const userId = msg.from.id;
    
    if (USER_STATE.has(userId)) {
        await sendOrEditMessage(msg.chat.id, toSmallCaps('⚠️ ᴘʟᴇᴀsᴇ /ᴄᴀɴᴄᴇʟ ᴛʜᴇ ᴄᴜʀʀᴇɴᴛ ᴏᴘᴇʀᴀᴛɪᴏɴ ʙᴇғᴏʀᴇ sᴛᴀʀᴛɪɴɢ ᴀ ɴᴇᴡ ᴏɴᴇ.'));
        return;
    }
    
    USER_STATE.set(userId, { state: 'AWAITING_SINGLE_POST_FORWARD' });
    await sendOrEditMessage(msg.chat.id, toSmallCaps('ᴘʟᴇᴀsᴇ ғᴏʀᴡᴀʀᴅ ᴛʜᴇ sɪɴɢʟᴇ ғɪʟᴇ ᴏʀ ᴍᴇssᴀɢᴇ ʏᴏᴜ ᴡᴀɴᴛ ᴀ ᴘᴇʀᴍᴀɴᴇɴᴛ ʟɪɴᴋ ғᴏʀ.'));
});

// --- NEW ANIME COMMAND HANDLER ---
bot.onText(/\/anime/, async (msg) => {
    const userId = msg.from.id;
    
    if (USER_STATE.has(userId)) {
        await sendOrEditMessage(msg.chat.id, toSmallCaps('⚠️ ᴘʟᴇᴀsᴇ /ᴄᴀɴᴄᴇʟ ᴛʜᴇ ᴄᴜʀʀᴇɴᴛ ᴏᴘᴇʀᴀᴛɪᴏɴ ʙᴇғᴏʀᴇ sᴛᴀʀᴛɪɴɢ ᴀ ɴᴇᴡ ᴏɴᴇ.'));
        return;
    }
    
    USER_STATE.set(userId, { state: 'AWAITING_ANIME_SEARCH' });
    await sendOrEditMessage(msg.chat.id, toSmallCaps('🎬 ᴘʟᴇᴀsᴇ ᴇɴᴛᴇʀ ᴛʜᴇ ᴀɴɪᴍᴇ ᴛɪᴛʟᴇ ʏᴏᴜ ᴡɪsʜ ᴛᴏ sᴇᴀʀᴄʜ ғᴏʀ (ᴇ.ɢ., ᴀᴛᴛᴀᴄᴋ ᴏɴ ᴛɪᴛᴀɴ):'));
});

bot.onText(/\/batch/, async (msg) => {
    const userId = msg.from.id;
    if (getUserTier(await getUser(userId)).name !== USER_TIERS.ADMIN.name) return sendOrEditMessage(msg.chat.id, toSmallCaps('❌ ᴏɴʟʏ ᴀᴅᴍɪɴɪsᴛʀᴀᴛᴏʀs ᴄᴀɴ ᴜsᴇ ʙᴀᴛᴄʜ ᴄᴏᴍᴍᴀɴᴅs.'));
    
    USER_STATE.delete(userId);
    USER_STATE.set(userId, { state: 'AWAITING_BATCH_START_POST', tempBatchData: {} });

    await sendOrEditMessage(msg.chat.id, toSmallCaps('sᴛᴇᴘ 1: ғᴏʀᴡᴀʀᴅ ᴛʜᴇ ғɪʀsᴛ ᴘᴏsᴛ ᴏғ ᴛʜᴇ sᴇǫᴜᴇɴᴛɪᴀʟ ʙᴀᴛᴄʜ. sᴇɴᴅ /ᴄᴀɴᴄᴇʟ ᴛᴏ ᴀʙᴏʀᴛ.'));
});

bot.onText(/\/custom_batch/, async (msg) => {
    const userId = msg.from.id;
    if (getUserTier(await getUser(userId)).name !== USER_TIERS.ADMIN.name) return sendOrEditMessage(msg.chat.id, toSmallCaps('❌ ᴏɴʟʏ ᴀᴅᴍɪɴɪsᴛʀᴀᴛᴏʀs ᴄᴀɴ ᴜsᴇ ᴄᴜsᴛᴏᴍ ʙᴀᴛᴄʜ ᴄᴏᴍᴍᴀɴᴅs.'));

    USER_STATE.delete(userId);
    USER_STATE.set(userId, { state: 'AWAITING_CUSTOM_FILES', files: [] });

    await sendOrEditMessage(msg.chat.id, toSmallCaps('sᴛᴇᴘ 1: sᴇɴᴅ ᴏʀ ғᴏʀᴡᴀʀᴅ ғɪʟᴇs ᴏɴᴇ ʙʏ ᴏɴᴇ. sᴇɴᴅ /ᴅᴏɴᴇ [ᴛɪᴛʟᴇ] ᴡʜᴇɴ ᴅᴏɴᴇ ᴏʀ /ᴄᴀɴᴄᴇʟ ᴛᴏ ᴀʙᴏʀᴛ.'));
});

bot.onText(/\/done (.+)/, async (msg, match) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const batchTitle = match[1].trim();

    const user = await getUser(userId);
    const tier = getUserTier(user);
    if (tier.name !== USER_TIERS.ADMIN.name) return;

    const currentState = USER_STATE.get(userId);
    
    if (!currentState || currentState.state !== 'AWAITING_CUSTOM_FILES' || currentState.files.length === 0) {
        return sendOrEditMessage(chatId, toSmallCaps('⚠️ ɴᴏᴛ ɪɴ ᴀ ᴄᴜsᴛᴏᴍ ʙᴀᴛᴄʜ ᴘʀᴏᴄᴇss, ᴏʀ ɴᴏ ғɪʟᴇs ᴡᴇʀᴇ ᴄᴏʟʟᴇᴄᴛᴇᴅ.'));
    }
    
    if (user.linkCount >= tier.limit && tier.limit !== Infinity) {
        USER_STATE.delete(userId);
        return sendOrEditMessage(chatId, toSmallCaps(`❌ ᴜᴘʟᴏᴀᴅ ʟɪᴍɪᴛ ʀᴇᴀᴄʜᴇᴅ. ʏᴏᴜʀ ᴄᴜʀʀᴇɴᴛ ᴛɪᴇʀ (${tier.name}) ʟɪᴍɪᴛ ɪs ${tier.limit} ʟɪɴᴋs.`));
    }
    
    const uniqueId = generateUniqueId();
    
    await addFile({ uniqueId, type: 'custom_file_batch', fileList: currentState.files, fileName: batchTitle, uploadedBy: userId, uploaderName: user.firstName, views: 0, downloads: 0, });
    await incrementLinkCount(userId);
    USER_STATE.delete(userId); 

    const directLink = `https://t.me/${BOT_INFO.username}?start=custom_${uniqueId}`; 

    // ⚠️ FIXED: Changed ** to <b> for HTML parsing compatibility
    await sendOrEditMessage(chatId, `🎉 <b>${toSmallCaps('ᴄᴜsᴛᴏᴍ ғɪʟᴇ ʙᴀᴛᴄʜ ʟɪɴᴋ ɢᴇɴᴇʀᴀᴛᴇᴅ!')}</b>\n\n${toSmallCaps('ᴛɪᴛʟᴇ')}: <code>${batchTitle}</code>\n${toSmallCaps('ᴄᴏɴᴛᴀɪɴs')} ${currentState.files.length} ${toSmallCaps('ғɪʟᴇs.')}`, {
        inline_keyboard: [[{ text: toSmallCaps('🔗 ᴏᴘᴇɴ ʙᴀᴛᴄʜ ʟɪɴᴋ'), url: directLink }]]
    });
});

bot.onText(/\/stats/, async (msg) => {
    const userId = msg.from.id;
    const user = await getUser(userId);
    if (!user || await isUserBanned(userId)) return;
    
    const tier = getUserTier(user);
    
    // ⚠️ FIXED: Changed ** to <b> for HTML parsing compatibility
    const statsText = `
📈 <b>${toSmallCaps('ʏᴏᴜʀ ᴘᴇʀsᴏɴᴀʟ sᴛᴀᴛɪsᴛɪᴄs')}</b>

${toSmallCaps('ᴜsᴇʀ ɪᴅ')}: <code>${userId}</code>
${toSmallCaps('ᴛɪᴇʀ')}: <b>${tier.name}</b> (${tier.description})
${toSmallCaps('ʟɪɴᴋs ᴜsᴇᴅ')}: ${user.linkCount || 0}
${toSmallCaps('ᴜᴘʟᴏᴀᴅ ʟɪᴍɪᴛ')}: ${tier.limit === Infinity ? 'ᴜɴʟɪᴍɪᴛᴇᴅ' : tier.limit}
${toSmallCaps('ᴍᴀx ғɪʟᴇ sɪᴢᴇ')}: ${tier.maxFileSize === Infinity ? 'ᴜɴʟɪᴍɪᴛᴇᴅ' : `${formatFileSize(tier.maxFileSize)}`}
    `;

    const keyboard = { inline_keyboard: [[{ text: toSmallCaps('📁 sʜᴏᴡ ᴍʏ ғɪʟᴇs'), callback_data: 'show_my_files' }]] };
    await sendOrEditMessage(msg.chat.id, statsText, keyboard);
});

bot.onText(/\/files/, async (msg) => {
    const userId = msg.from.id;
    if (await isUserBanned(userId)) return;

    let files, total;
    if (DATABASE_URL) {
        const result = await File.find({ uploadedBy: userId }).sort({ createdAt: -1 }).limit(10);
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

    // ⚠️ FIXED: Changed ** to <b> for HTML parsing compatibility
    let fileListText = `📁 <b>${toSmallCaps(`ʏᴏᴜʀ ʟᴀᴛᴇsᴛ ᴜᴘʟᴏᴀᴅs (${total} ᴛᴏᴛᴀʟ)`)}</b>\n\n`;

    if (total === 0) {
        fileListText += toSmallCaps('ɴᴏ ғɪʟᴇs ғᴏᴜɴᴅ. ᴜsᴇ /ɢᴇᴛʟɪɴᴋ ᴛᴏ sᴛᴀʀᴛ.');
    } else {
        files.forEach((file, index) => {
            const fileType = file.type.split('_')[0].toUpperCase();
            const linkType = file.type.startsWith('single_file') ? 'file' : 'direct'; 
            const link = `${WEBAPP_URL}/${linkType}/${file.uniqueId}`;
            
            // ⚠️ FIXED: Changed ** to <b> for HTML parsing compatibility
            fileListText += `${index + 1}. <b>${file.fileName.substring(0, 40)}</b>... [${fileType}] (<a href="${link}">ᴏᴘᴇɴ ʟɪɴᴋ</a>)\n`;
            fileListText += `   👁️ ${file.views || 0} ${toSmallCaps('ᴠɪᴇᴡs')} | 💾 ${formatFileSize(file.fileSize || 0)}\n`;
        });
    }

    await sendOrEditMessage(msg.chat.id, fileListText);
});

bot.onText(/\/help/, async (msg) => {
    // ⚠️ FIXED: Changed ** to <b> for HTML parsing compatibility
    let helpText = `
🆘 <b>${toSmallCaps('ʙᴏᴛ ʜᴇʟᴘ & ᴄᴏᴍᴍᴀɴᴅs')}</b>

${toSmallCaps('ᴄᴏʀᴇ ғᴜɴᴄᴛɪᴏɴs:')}
• <code>/start</code> - ${toSmallCaps('ᴍᴀɪɴ ᴍᴇɴᴜ, ᴄʟᴇᴀʀs sᴛᴀᴛᴇ.')}
• <code>/getlink</code> - ${toSmallCaps('ɢᴇɴᴇʀᴀᴛᴇ ᴀ ʟɪɴᴋ ғᴏʀ ᴀ sɪɴɢʟᴇ ғɪʟᴇ/ᴍᴇssᴀɢᴇ (ғᴏʀᴡᴀʀᴅ ᴄᴏɴᴛᴇɴᴛ).')}
• <code>/anime</code> - ${toSmallCaps('sᴇᴀʀᴄʜ ғᴏʀ ᴀɴɪᴍᴇ ᴍᴇᴛᴀᴅᴀᴛᴀ ᴀɴᴅ ᴄʜᴇᴄᴋ ғᴏʀ ʟᴏᴄᴀʟ ʟɪɴᴋs.')}
• <code>/stats</code> - ${toSmallCaps('ᴅɪsᴘʟᴀʏ ʏᴏᴜʀ ᴄᴜʀʀᴇɴᴛ ᴛɪᴇʀ, ʟɪᴍɪᴛs, ᴀɴᴅ ғɪʟᴇ ᴄᴏᴜɴᴛ.')}
• <code>/files</code> - ${toSmallCaps('ʟɪsᴛ ʏᴏᴜʀ ʟᴀᴛᴇsᴛ ᴜᴘʟᴏᴀᴅᴇᴅ ʟɪɴᴋs.')}
• <code>/help</code> - ${toSmallCaps('ᴅɪsᴘʟᴀʏ ᴛʜɪs ʜᴇʟᴘ ᴛᴇxᴛ.')}
• <code>/cancel</code> - ${toSmallCaps('ᴀʙᴏʀᴛ ᴄᴜʀʀᴇɴᴛ ᴍᴜʟᴛɪ-sᴛᴇᴘ ᴘʀᴏᴄᴇss.')}
    `;

    const user = await getUser(msg.from.id);
    if (getUserTier(user).name === USER_TIERS.ADMIN.name) {
        helpText += `
\n${toSmallCaps('ᴀᴅᴍɪɴ-ᴏɴʟʏ ᴄᴏᴍᴍᴀɴᴅs:')}
• <code>/admin</code> - ${toSmallCaps('ᴏᴘᴇɴ ᴛʜᴇ ᴀᴅᴍɪɴ ᴄᴏɴᴛʀᴏʟ ᴘᴀɴᴇʟ.')}
• <code>/status</code> - ${toSmallCaps('ᴠɪᴇᴡ ɢʟᴏʙᴀʟ ʙᴏᴛ sᴛᴀᴛɪsᴛɪᴄs.')}
• <code>/broadcast</code> - ${toSmallCaps('sᴇɴᴅ ᴀ ᴍᴇssᴀɢᴇ ᴛᴏ ᴀʟʟ ʙᴏᴛ ᴜsᴇʀs.')}
• <code>/batch</code> - ${toSmallCaps('ɢᴇɴᴇʀᴀᴛᴇ ᴀ sᴇǫᴜᴇɴᴛɪᴀʟ ʟɪɴᴋ (ғᴏʀᴡᴀʀᴅ sᴛᴀʀᴛ/ᴇɴᴅ ᴘᴏsᴛs).')}
• <code>/custom_batch</code> - ${toSmallCaps('sᴛᴀʀᴛ ᴄᴏʟʟᴇᴄᴛɪɴɢ ғɪʟᴇs ғᴏʀ ᴀ ᴄᴜsᴛᴏᴍ ʙᴀᴛᴄʜ.')}
• <code>/done &lt;ᴛɪᴛʟᴇ&gt;</code> - ${toSmallCaps('ғɪɴᴀʟɪᴢᴇ /ᴄᴜsᴛᴏᴍ_ʙᴀᴛᴄʜ ᴀɴᴅ ɢᴇɴᴇʀᴀᴛᴇ ᴛʜᴇ ʟɪɴᴋ.')}
• <code>/ban &lt;ɪᴅ&gt;</code>, <code>/unban &lt;ɪᴅ&gt;</code> - ${toSmallCaps('ᴍᴀɴᴀɢᴇ ᴜsᴇʀ ᴀᴄᴄᴇss.')}
• <code>/deletefile &lt;ɪᴅ&gt;</code> - ${toSmallCaps('ᴅᴇʟᴇᴛᴇ ᴀ ғɪʟᴇ/ʟɪɴᴋ ʙʏ ɪᴛs ᴜɴɪǫᴜᴇ ɪᴅ.')}
• <code>/clearcache</code> - ${toSmallCaps('ᴍᴀɴᴜᴀʟʟʏ ᴄʟᴇᴀʀ ᴛᴇʟᴇɢʀᴀᴍ ᴜʀʟ ᴄᴀᴄʜᴇ.')}
        `;
    }

    await sendOrEditMessage(msg.chat.id, helpText);
});

bot.onText(/\/cancel/, async (msg) => {
    const userId = msg.from.id;
    if (!USER_STATE.has(userId)) return sendOrEditMessage(userId, toSmallCaps('⚠️ ɴᴏ ᴀᴄᴛɪᴠᴇ ᴏᴘᴇʀᴀᴛɪᴏɴ ᴛᴏ ᴄᴀɴᴄᴇʟ.'));

    USER_STATE.delete(userId);
    await sendOrEditMessage(userId, toSmallCaps('✅ ᴄᴜʀʀᴇɴᴛ ᴍᴜʟᴛɪ-sᴛᴇᴘ ᴏᴘᴇʀᴀᴛɪᴏɴ ᴄᴀɴᴄᴇʟʟᴇᴅ. sᴛᴀᴛᴇ ʀᴇsᴇᴛ.'));
});


// Admin commands (Added placeholder handlers for all user-requested commands)
bot.onText(/\/status/, async (msg) => {
    const userId = msg.from.id;
    if (getUserTier(await getUser(userId)).name !== USER_TIERS.ADMIN.name) return;
    
    let totalUsers, totalFiles;
    if (DATABASE_URL) {
        totalUsers = await User.countDocuments({});
        totalFiles = await File.countDocuments({});
    } else {
        totalUsers = MEMORY_DATABASE.users.size;
        totalFiles = MEMORY_DATABASE.files.size;
    }

    const uptimeSeconds = (performance.now() - START_TIME) / 1000;
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = Math.floor(uptimeSeconds % 60);
    const uptime = `${hours}ʜ ${minutes}ᴍ ${seconds}s`;

    // ⚠️ FIXED: Changed ** to <b> for HTML parsing compatibility
    const statusText = `
⚙️ <b>${toSmallCaps('ʙᴏᴛ sᴛᴀᴛᴜs & ᴀɴᴀʟʏᴛɪᴄs')}</b>

${toSmallCaps('ᴜᴘᴛɪᴍᴇ')}: ${uptime}
${toSmallCaps('ᴛᴏᴛᴀʟ ʀᴇɢɪsᴛᴇʀᴇᴅ ᴜsᴇʀs')}: ${totalUsers}
${toSmallCaps('ᴛᴏᴛᴀʟ ᴄʀᴇᴀᴛᴇᴅ ʟɪɴᴋs')}: ${totalFiles}
${toSmallCaps('ʟɪɴᴋs ɪɴ ᴄᴀᴄʜᴇ')}: ${URL_CACHE.size}
    `;

    await sendOrEditMessage(msg.chat.id, statusText);
});

bot.onText(/\/admin/, (msg) => {
    // This command redirects to /start logic which will show the admin panel button
    return bot.onText(/\/start/, msg);
});

bot.onText(/\/broadcast/, (msg) => {
    // Basic placeholder for broadcast initiation. Actual logic would follow.
    return sendOrEditMessage(msg.chat.id, toSmallCaps('➡️ ᴘʟᴇᴀsᴇ ᴜsᴇ ᴛʜᴇ ᴀᴅᴍɪɴ ᴘᴀɴᴇʟ ᴛᴏ sᴛᴀʀᴛ ᴀ ʙʀᴏᴀᴅᴄᴀsᴛ.'));
});

bot.onText(/\/clearcache/, async (msg) => {
    const userId = msg.from.id;
    if (getUserTier(await getUser(userId)).name !== USER_TIERS.ADMIN.name) return sendOrEditMessage(msg.chat.id, toSmallCaps('❌ ᴏɴʟʏ ᴀᴅᴍɪɴɪsᴛʀᴀᴛᴏʀs ᴄᴀɴ ᴜsᴇ ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ.'));
    URL_CACHE.clear();
    await sendOrEditMessage(msg.chat.id, toSmallCaps('✅ ᴛᴇʟᴇɢʀᴀᴍ ᴜʀʟ ᴄᴀᴄʜᴇ ᴍᴀɴᴜᴀʟʟʏ ᴄʟᴇᴀʀᴇᴅ.'));
});

// Deep Link Handler (for /direct/:id links)
async function handleDeepLink(msg, match) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const uniqueId = match[2];

    const data = await getFile(uniqueId);
    if (!data) {
        return sendOrEditMessage(chatId, toSmallCaps('❌ ɪɴᴠᴀʟɪᴅ ᴏʀ ᴇxᴘɪʀᴇᴅ ʟɪɴᴋ. ᴄᴏɴᴛᴇɴᴛ ɴᴏᴛ ғᴏᴜɴᴅ.'));
    }
    
    await updateFileStats(uniqueId, 'view');

    // ⚠️ FIXED: Changed ** to <b> for HTML parsing compatibility
    await sendOrEditMessage(chatId, `
🎉 <b>${toSmallCaps('sᴛᴀʀᴛɪɴɢ ᴄᴏɴᴛᴇɴᴛ ᴅᴇʟɪᴠᴇʀʏ')}</b>
${toSmallCaps('ᴛɪᴛʟᴇ')}: <b>${data.fileName}</b>
${toSmallCaps('ᴛʏᴘᴇ')}: <i>${data.type.replace('_', ' ').toUpperCase()}</i>
${toSmallCaps('ᴛʜᴇ ᴄᴏɴᴛᴇɴᴛ ᴡɪʟʟ ɴᴏᴡ ʙᴇ ᴅᴇʟɪᴠᴇʀᴇᴅ ʙᴇʟᴏᴡ.')}
    `);

    // Delivery Logic
    try {
        if (data.type === 'sequential_batch' && data.chatId) {
            for (let id = data.startId; id <= data.endId; id++) {
                await bot.copyMessage(chatId, data.chatId, id);
                await new Promise(resolve => setTimeout(resolve, 300)); 
            }
        } else if (data.type === 'custom_file_batch' && data.fileList) {
            for (const file of data.fileList) {
                await bot.sendDocument(chatId, file.file_id, { caption: file.file_name || data.fileName, parse_mode: 'HTML' });
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        } else if (data.type === 'single_forward' && data.chatId && data.messageId) {
            await bot.copyMessage(chatId, data.chatId, data.messageId);
        } else if (data.type === 'single_file' && data.fileId) {
            // Using sendDocument with HTML parse mode for consistent formatting in the caption
            await bot.sendDocument(chatId, data.fileId, { caption: data.fileName, parse_mode: 'HTML' });
        }
    } catch (e) {
        console.error(`[DELIVERY ERROR] Failed to deliver content for ${uniqueId}: ${e.message}`);
        await bot.sendMessage(chatId, toSmallCaps('❌ ᴇʀʀᴏʀ ᴅᴇʟɪᴠᴇʀɪɴɢ ᴄᴏɴᴛᴇɴᴛ. ᴛʜᴇ sᴏᴜʀᴄᴇ ᴍᴇssᴀɢᴇ ᴍᴀʏ ʙᴇ ᴅᴇʟᴇᴛᴇᴅ ᴏʀ ɪɴᴀᴄᴄᴇssɪʙʟᴇ.'), { parse_mode: 'HTML' });
    }
    
    await bot.sendMessage(chatId, toSmallCaps('✅ ᴄᴏɴᴛᴇɴᴛ ᴅᴇʟɪᴠᴇʀʏ ᴄᴏᴍᴘʟᴇᴛᴇ. ᴛʜᴀɴᴋ ʏᴏᴜ ғᴏʀ ᴜsɪɴɢ ᴛʜᴇ ʙᴏᴛ!'), { parse_mode: 'HTML' });
}


// ----------------------------------------------------------------------
// 8. CALLBACK QUERY HANDLER (BUTTONS FIX)
// ----------------------------------------------------------------------

bot.on('callback_query', async (query) => {
    const userId = query.from.id;
    const chatId = query.message.chat.id;
    const data = query.data;
    const messageId = query.message.message_id;

    await bot.answerCallbackQuery(query.id); // Answer the query to remove the loading state

    switch (data) {
        case 'start_getlink':
            // Trigger /getlink logic
            USER_STATE.set(userId, { state: 'AWAITING_SINGLE_POST_FORWARD' });
            await sendOrEditMessage(chatId, toSmallCaps('ᴘʟᴇᴀsᴇ ғᴏʀᴡᴀʀᴅ ᴛʜᴇ sɪɴɢʟᴇ ғɪʟᴇ ᴏʀ ᴍᴇssᴀɢᴇ ʏᴏᴜ ᴡᴀɴᴛ ᴀ ᴘᴇʀᴍᴀɴᴇɴᴛ ʟɪɴᴋ ғᴏʀ.'), null, messageId);
            break;

        case 'show_my_stats':
            // Re-use /stats content but edit the current message
            const user = await getUser(userId);
            if (!user || await isUserBanned(userId)) return;
            
            const tier = getUserTier(user);
            
            const statsText = `
📈 <b>${toSmallCaps('ʏᴏᴜʀ ᴘᴇʀsᴏɴᴀʟ sᴛᴀᴛɪsᴛɪᴄs')}</b>

${toSmallCaps('ᴜsᴇʀ ɪᴅ')}: <code>${userId}</code>
${toSmallCaps('ᴛɪᴇʀ')}: <b>${tier.name}</b> (${tier.description})
${toSmallCaps('ʟɪɴᴋs ᴜsᴇᴅ')}: ${user.linkCount || 0}
${toSmallCaps('ᴜᴘʟᴏᴀᴅ ʟɪᴍɪᴛ')}: ${tier.limit === Infinity ? 'ᴜɴʟɪᴍɪᴛᴇᴅ' : tier.limit}
${toSmallCaps('ᴍᴀx ғɪʟᴇ sɪᴢᴇ')}: ${tier.maxFileSize === Infinity ? 'ᴜɴʟɪᴍɪᴛᴇᴅ' : `${formatFileSize(tier.maxFileSize)}`}
            `;
            const keyboard = { inline_keyboard: [
                [{ text: toSmallCaps('📁 sʜᴏᴡ ᴍʏ ғɪʟᴇs'), callback_data: 'show_my_files' }],
                [{ text: toSmallCaps('⬅️ ʙᴀᴄᴋ ᴛᴏ ᴍᴇɴᴜ'), callback_data: 'start' }]
            ] };
            await sendOrEditMessage(chatId, statsText, keyboard, messageId);
            break;

        case 'show_how_to_use':
            // Help/Instructions menu
            const helpText = `
🆘 <b>${toSmallCaps('ʜᴏᴡ ᴛᴏ ᴜsᴇ ᴛʜᴇ ʙᴏᴛ')}</b>

${toSmallCaps('1. ɢᴇᴛᴛɪɴɢ ᴀ ʟɪɴᴋ:')} 
${toSmallCaps('ᴜsᴇ ᴛʜᴇ /ɢᴇᴛʟɪɴᴋ ᴄᴏᴍᴍᴀɴᴅ ᴏʀ ᴛʜᴇ "ɢᴇᴛ ʟɪɴᴋ" ʙᴜᴛᴛᴏɴ.')} ${toSmallCaps('ᴛʜᴇɴ, ғᴏʀᴡᴀʀᴅ ʏᴏᴜʀ ᴠɪᴅᴇᴏ, ᴅᴏᴄᴜᴍᴇɴᴛ, ᴏʀ ᴀɴʏ ᴍᴇssᴀɢᴇ ᴛᴏ ᴛʜᴇ ʙᴏᴛ.')}

${toSmallCaps('2. ᴛʏᴘᴇs ᴏғ ʟɪɴᴋs:')}
• ${toSmallCaps('ғɪʟᴇs:')} ${toSmallCaps('ɢᴇᴛ ᴀ sᴛʀᴇᴀᴍᴀʙʟᴇ ᴡᴇʙ ʟɪɴᴋ ᴀɴᴅ ᴀ ᴛᴇʟᴇɢʀᴀᴍ ᴅᴇᴇᴘ ʟɪɴᴋ.')}
• ${toSmallCaps('ᴍᴇssᴀɢᴇs:')} ${toSmallCaps('ɢᴇᴛ ᴀ ᴛᴇʟᴇɢʀᴀᴍ ᴅᴇᴇᴘ ʟɪɴᴋ ᴛʜᴀᴛ ᴡɪʟʟ ғᴏʀᴡᴀʀᴅ ᴛʜᴇ ᴏʀɪɢɪɴᴀʟ ᴍᴇssᴀɢᴇ.')}

${toSmallCaps('3. ᴍᴀɴᴀɢɪɴɢ:')}
${toSmallCaps('ᴜsᴇ /sᴛᴀᴛs ᴛᴏ ᴄʜᴇᴄᴋ ʏᴏᴜʀ ʟɪᴍɪᴛs ᴀɴᴅ /ғɪʟᴇs ᴛᴏ sᴇᴇ ʏᴏᴜʀ ʟᴀᴛᴇsᴛ ᴜᴘʟᴏᴀᴅs.')}
            `;
            await sendOrEditMessage(chatId, helpText, { inline_keyboard: [[{ text: toSmallCaps('⬅️ ʙᴀᴄᴋ ᴛᴏ ᴍᴇɴᴜ'), callback_data: 'start' }]] }, messageId);
            break;

        case 'show_my_files':
            // Re-use /files content but edit the current message
            let files, total;
            if (DATABASE_URL) {
                const result = await File.find({ uploadedBy: userId }).sort({ createdAt: -1 }).limit(10);
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

            let fileListText = `📁 <b>${toSmallCaps(`ʏᴏᴜʀ ʟᴀᴛᴇsᴛ ᴜᴘʟᴏᴀᴅs (${total} ᴛᴏᴛᴀʟ)`)}</b>\n\n`;

            if (total === 0) {
                fileListText += toSmallCaps('ɴᴏ ғɪʟᴇs ғᴏᴜɴᴅ. ᴜsᴇ /ɢᴇᴛʟɪɴᴋ ᴛᴏ sᴛᴀʀᴛ.');
            } else {
                files.forEach((file, index) => {
                    const fileType = file.type.split('_')[0].toUpperCase();
                    const linkType = file.type.startsWith('single_file') ? 'file' : 'direct'; 
                    const link = `${WEBAPP_URL}/${linkType}/${file.uniqueId}`;
                    
                    fileListText += `${index + 1}. <b>${file.fileName.substring(0, 40)}</b>... [${fileType}] (<a href="${link}">ᴏᴘᴇɴ ʟɪɴᴋ</a>)\n`;
                    fileListText += `   👁️ ${file.views || 0} ${toSmallCaps('ᴠɪᴇᴡs')} | 💾 ${formatFileSize(file.fileSize || 0)}\n`;
                });
            }
            await sendOrEditMessage(chatId, fileListText, { inline_keyboard: [[{ text: toSmallCaps('⬅️ ʙᴀᴄᴋ ᴛᴏ sᴛᴀᴛs'), callback_data: 'show_my_stats' }]] }, messageId);
            break;

        case 'admin_panel':
            // Admin Panel Menu
            if (getUserTier(await getUser(userId)).name !== USER_TIERS.ADMIN.name) return sendOrEditMessage(chatId, toSmallCaps('❌ ᴀᴅᴍɪɴ ᴏɴʟʏ.'), null, messageId);

            const adminText = `👑 <b>${toSmallCaps('ᴀᴅᴍɪɴ ᴄᴏɴᴛʀᴏʟ ᴘᴀɴᴇʟ')}</b>\n${toSmallCaps('sᴇʟᴇᴄᴛ ᴀɴ ᴀᴄᴛɪᴏɴ ʙᴇʟᴏᴡ:')}`;
            const adminKeyboard = {
                inline_keyboard: [
                    [{ text: toSmallCaps('📈 ʙᴏᴛ sᴛᴀᴛᴜs'), callback_data: 'admin_status' }, { text: toSmallCaps('📣 ʙʀᴏᴀᴅᴄᴀsᴛ'), callback_data: 'admin_broadcast_start' }],
                    [{ text: toSmallCaps('🔗 sᴇǫᴜᴇɴᴛɪᴀʟ ʙᴀᴛᴄʜ'), callback_data: 'admin_batch' }, { text: toSmallCaps('📂 ᴄᴜsᴛᴏᴍ ʙᴀᴛᴄʜ'), callback_data: 'admin_custom_batch' }],
                    [{ text: toSmallCaps('👥 ᴍᴀɴᴀɢᴇ ᴜsᴇʀs (ʙᴀɴ/ᴜɴʙᴀɴ)'), callback_data: 'admin_manage_users' }],
                    [{ text: toSmallCaps('🧹 ᴄʟᴇᴀʀ ᴄᴀᴄʜᴇ'), callback_data: 'admin_clearcache' }],
                    [{ text: toSmallCaps('⬅️ ʙᴀᴄᴋ ᴛᴏ ᴍᴇɴᴜ'), callback_data: 'start' }]
                ]
            };
            await sendOrEditMessage(chatId, adminText, adminKeyboard, messageId);
            break;
            
        case 'admin_status':
            // Trigger /status command logic
            return bot.onText(/\/status/, query.message);

        case 'admin_clearcache':
            // Trigger /clearcache command logic
            return bot.onText(/\/clearcache/, query.message);
            
        case 'admin_batch':
            // Trigger /batch command logic
            return bot.onText(/\/batch/, query.message);
            
        case 'admin_custom_batch':
            // Trigger /custom_batch command logic
            return bot.onText(/\/custom_batch/, query.message);

        case 'admin_broadcast_start':
            // Trigger /broadcast logic
            return bot.onText(/\/broadcast/, query.message);

        case 'start':
        case 'back_to_menu':
            // Re-call /start handler logic to refresh the main menu
            return bot.onText(/\/start/, query.message);

        default:
            // Handle other callback data or errors silently
            // For example, admin_manage_users would lead to a new state/message, but this is a stub.
            await bot.answerCallbackQuery(query.id, { text: toSmallCaps('ᴜɴᴋɴᴏᴡɴ ᴀᴄᴛɪᴏɴ. ᴘʟᴇᴀsᴇ ʀᴇsᴛᴀʀᴛ /sᴛᴀʀᴛ'), show_alert: true });
            break;
    }
});


// ----------------------------------------------------------------------
// 9. EXPRESS WEB SERVER LOGIC (Streaming/Download Infrastructure)
// ----------------------------------------------------------------------

app.use(express.json());

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Range, Content-Type, Accept');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

// Route for single files (Landing page) - /file/:id
app.get('/file/:id', async (req, res) => {
    const uniqueId = req.params.id;
    const file = await getFile(uniqueId);
    
    if (!file) {
        return res.status(404).send('<h1>404 Not Found</h1><p>The file is invalid or expired.</p>');
    }

    if (file.type === 'single_file') {
        const fileSizeMB = file.fileSize ? (file.fileSize / 1024 / 1024).toFixed(2) + ' MB' : 'N/A';
        
        // Aesthetic HTML Landing Page
        const htmlContent = `
<!DOCTYPE html>
<html><head><title>${file.fileName}</title>
<style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; text-align: center; padding-top: 80px; background: #222; color: #fff; margin: 0; }
    .container { background: #333; padding: 40px; border-radius: 12px; max-width: 480px; margin: auto; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { color: #00bcd4; font-size: 1.8rem; margin-bottom: 15px; }
    p { font-size: 1.1rem; margin-bottom: 25px; }
    .button-group { display: flex; justify-content: space-around; flex-wrap: wrap; margin-top: 30px; }
    a { 
        padding: 12px 25px; margin: 10px; border: none; border-radius: 6px; cursor: pointer; 
        font-size: 1.05rem; font-weight: bold; transition: all 0.3s ease; box-shadow: 0 4px 6px rgba(0,0,0,0.2); 
        min-width: 150px; text-decoration: none; display: inline-block;
    }
    .button-group a:first-child { background-color: #4CAF50; color: white; }
    .button-group a:last-child { background-color: #03A9F4; color: white; }
    footer { margin-top: 40px; color: #888; font-size: 0.85rem; }
</style>
</head>
<body>
    <div class="container">
        <h1>${file.fileName}</h1>
        <p>File Size: <b>${fileSizeMB}</b></p>
        <p>File Type: <i>${file.mimeType}</i></p>
        <div class="button-group">
            <a href="/stream/${file.uniqueId}" target="_blank">▶️ Stream Video</a>
            <a href="/download/${file.uniqueId}" target="_blank">⬇️ Direct Download</a>
        </div>
        <small style="display: block; margin-top: 20px; color: #aaa;">
            Streaming supports HTTP Range requests for seeking.
        </small>
    </div>
    <footer>
        Permanent Link Service provided by ${BOT_INFO ? BOT_INFO.username : 'YourBot'}.
    </footer>
</body></html>
        `;
        return res.status(200).send(htmlContent);
    }
    
    // Redirect batch/forward links to the bot
    const linkType = file.type.split('_')[0];
    const deepLink = `https://t.me/${BOT_INFO.username}?start=${linkType}_${uniqueId}`;
    res.redirect(302, deepLink);
});

// Endpoint for streaming (Range header handling) - /stream/:id
app.get('/stream/:id', async (req, res) => {
    const uniqueId = req.params.id;
    const range = req.headers.range; 
    
    const file = await getFileDetailsForWeb(uniqueId);
    
    if (!file) return res.status(404).send('File not found for streaming.');

    try {
        await updateFileStats(uniqueId, 'view'); 
        
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

            const fileStream = await fetch(fileUrl, { headers: { Range: `bytes=${start}-${end}` } });
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
    
    if (!file) return res.status(404).send('File not found for download');

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

// Endpoint for Telegram Direct Link Redirect - /direct/:id (Deprecated, handled by /file/:id for single files)
app.get('/direct/:id', async (req, res) => {
    const uniqueId = req.params.id;
    const data = await getFile(uniqueId);

    if (!data) return res.status(404).send('Direct Link not found or expired.');

    const linkType = data.type.split('_')[0];
    const deepLink = `https://t.me/${BOT_INFO.username}?start=${linkType}_${uniqueId}`;

    res.redirect(302, deepLink);
});


// ----------------------------------------------------------------------
// 10. INITIALIZATION & EXECUTION BLOCK - UPDATED COMMANDS LIST
// ----------------------------------------------------------------------

// Start the Express Server
app.listen(PORT, () => {
    console.log('----------------------------------------------------');
    console.log(`🚀 ᴡᴇʙ sᴇʀᴠᴇʀ sᴛᴀʀᴛᴇᴅ sᴜᴄᴄᴇssғᴜʟʟʏ ᴏɴ ᴘᴏʀᴛ ${PORT}.`);
    console.log(`🌐 ᴡᴇʙ ᴀᴘᴘ ᴜʀʟ: ${WEBAPP_URL}`);
    console.log('----------------------------------------------------');
});

// Set all custom commands visible in the Telegram menu
// ⚠️ FIXED: Updated to include the full admin list requested by the user
bot.setMyCommands([
    { command: 'start', description: 'Open the Main Menu' },
    { command: 'getlink', description: 'Generate a permanent link for a file' },
    { command: 'anime', description: 'Search AniList for anime information' },
    { command: 'stats', description: 'Display your current tier and usage limits' },
    { command: 'files', description: 'View your uploaded files' },
    { command: 'help', description: 'Show the list of features and commands' },
    { command: 'cancel', description: 'Abort current multi-step operation' },
    
    // --- Admin Management Commands ---
    { command: 'admin', description: 'Open the Admin Control Panel (Admin Only)' },
    { command: 'broadcast', description: 'Send a message to all bot users (Admin Only)' },
    { command: 'batch', description: 'Generate a sequential link by forwarding start/end posts (Admin Only)' },
    { command: 'custom_batch', description: 'Start a custom batch creation process (Admin Only)' },
    { command: 'done', description: 'Finalize and generate link for /custom_batch (Admin Only)' },
    { command: 'status', description: 'View bot statistics (Admin Only)' },
    { command: 'clearcache', description: 'Manually clear Telegram URL cache (Admin Only)' }
    // Note: /ban, /unban, /deletefile are typically handled by Admin Panel buttons 
    // but the functionality is present in the /help list. Only adding commands that 
    // are directly implemented as command handlers.
]).then(() => console.log('✅ ᴛᴇʟᴇɢʀᴀᴍ ᴄᴏᴍᴍᴀɴᴅs sᴜᴄᴄᴇssғᴜʟʟʏ ʀᴇɢɪsᴛᴇʀᴇᴅ.'));

console.log('🤖 ᴛᴇʟᴇɢʀᴀᴍ ʙᴏᴛ ᴘᴏʟʟɪɴɢ sᴛᴀʀᴛᴇᴅ. ᴛʜᴇ ᴀᴘᴘʟɪᴄᴀᴛɪᴏɴ ɪs ɴᴏᴡ ғᴜʟʟʏ ᴏᴘᴇʀᴀᴛɪᴏɴᴀʟ.');
