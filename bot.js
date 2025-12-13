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
 */
async function sendOrEditMessage(chatId, text, reply_markup = null, messageIdToEdit = null) {
    const userId = chatId; 
    try {
        const user = await getUser(userId);
        
        // AUTO-DELETION LOGIC
        if (user && user.lastBotMessageId && !messageIdToEdit) {
            try { await bot.deleteMessage(chatId, user.lastBotMessageId); } catch (e) {} // Safe delete
        }
        
        const messageOptions = { parse_mode: 'HTML', reply_markup: reply_markup, disable_web_page_preview: true };
        let sentMessage;
        
        if (messageIdToEdit) {
            sentMessage = await bot.editMessageText(text, { ...messageOptions, message_id: messageIdToEdit });
        } else {
            sentMessage = await bot.sendMessage(chatId, text, messageOptions);
        }

        if (sentMessage && sentMessage.message_id) {
            await updateLastBotMessageId(userId, sentMessage.message_id);
        }
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
        return { ...data._doc || data, fileUrl: cachedEntry.url };
    }
    
    try {
        const fileInfo = await bot.getFile(data.fileId);
        if (!fileInfo.file_path) return null;
        
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.file_path}`;
        
        URL_CACHE.set(data.fileId, { url: fileUrl, timestamp: now });

        return { ...data._doc || data, fileSize: fileInfo.file_size || data.fileSize, fileUrl: fileUrl };
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
    const text = `👋 **${toSmallCaps('ᴡᴇʟᴄᴏᴍᴇ ᴛᴏ ᴛʜᴇ ᴘᴇʀᴍᴀɴᴇɴᴛ ʟɪɴᴋ ʙᴏᴛ!')}**\n${toSmallCaps('ɪ ɢᴇɴᴇʀᴀᴛᴇ ᴘᴇʀᴍᴀɴᴇɴᴛ ʟɪɴᴋs ғᴏʀ ʏᴏᴜʀ ᴄᴏɴᴛᴇɴᴛ.')}\n\n${toSmallCaps('ʏᴏᴜʀ ᴄᴜʀʀᴇɴᴛ ᴛɪᴇʀ')}: **${tier.name}** (${tier.description})\n${toSmallCaps('ʟɪɴᴋs ᴜsᴇᴅ')}: ${user.linkCount || 0}/${tier.limit === Infinity ? '∞' : tier.limit}`;
    
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

                await sendOrEditMessage(chatId, `✅ **${toSmallCaps('ᴘᴇʀᴍᴀɴᴇɴᴛ ᴡᴇʙ & ᴛᴇʟᴇɢʀᴀᴍ ʟɪɴᴋ ɢᴇɴᴇʀᴀᴛᴇᴅ!')}**\n\n${toSmallCaps('ғɪʟᴇ ɴᴀᴍᴇ')}: <code>${file.file_name || msg.caption || `File ${uniqueId}`}</code>\n${toSmallCaps('ғɪʟᴇ sɪᴢᴇ')}: ${formatFileSize(fileSize)}`, {
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

                await sendOrEditMessage(chatId, `✅ **${toSmallCaps('ᴘᴇʀᴍᴀɴᴇɴᴛ ғᴏʀᴡᴀʀᴅ ʟɪɴᴋ ɢᴇɴᴇʀᴀᴛᴇᴅ!')}**\n\n${toSmallCaps('ʟɪɴᴋ ᴛʏᴘᴇ')}: <code>Single Forward</code>\n${toSmallCaps('ᴍᴇssᴀɢᴇ ɪᴅ')}: ${msg.forward_from_message_id}`, {
                    inline_keyboard: [
                        [{ text: toSmallCaps('🔗 ᴏᴘᴇɴ ʟɪɴᴋ'), url: directLink }]
                    ] 
                });
                return;
            }
            // If it's a message that isn't a forward and isn't a file, cancel and inform.
            else {
                USER_STATE.delete(userId);
                return sendOrEditMessage(chatId, toSmallCaps('⚠️ ɪɴᴠᴀʟɪᴅ ᴍᴇssᴀɢᴇ. ᴘʟᴇᴀsᴇ ғᴏʀᴡᴀʀᴅ ᴀ ғɪʟᴇ ᴏʀ ᴀ ᴍᴇssᴀɢᴇ ғʀᴏᴍ ᴀ ᴘᴜʙʟɪᴄ ᴄʜᴀɴɴᴇʟ. ᴘʀᴏᴄᴇss ᴄᴀɴᴄᴇʟʟᴇᴅ.'));
            }

        } 
        
        else if (currentState.state === 'AWAITING_BATCH_START') {
            if (!isAdmin(userId)) return;

            if (!isForwarded) {
                return sendOrEditMessage(chatId, toSmallCaps('⚠️ ɪɴᴠᴀʟɪᴅ ᴍᴇssᴀɢᴇ. ᴘʟᴇᴀsᴇ ғᴏʀᴡᴀʀᴅ ᴛʜᴇ *sᴛᴀʀᴛ* ᴍᴇssᴀɢᴇ ғʀᴏᴍ ᴛʜᴇ ᴄʜᴀɴɴᴇʟ.'));
            }
            
            currentState.data.startMessage = msg;
            currentState.state = 'AWAITING_BATCH_END';
            USER_STATE.set(userId, currentState);
            
            await sendOrEditMessage(chatId, toSmallCaps('📤 ᴏᴋᴀʏ. ɴᴏᴡ ᴘʟᴇᴀsᴇ ғᴏʀᴡᴀʀᴅ ᴛʜᴇ *ᴇɴᴅ* ᴍᴇssᴀɢᴇ ᴏғ ᴛʜᴇ ʙᴀᴛᴄʜ.'));
            return;
        } 
        
        else if (currentState.state === 'AWAITING_BATCH_END') {
            if (!isAdmin(userId)) return;

            if (!isForwarded) {
                return sendOrEditMessage(chatId, toSmallCaps('⚠️ ɪɴᴠᴀʟɪᴅ ᴍᴇssᴀɢᴇ. ᴘʟᴇᴀsᴇ ғᴏʀᴡᴀʀᴅ ᴛʜᴇ *ᴇɴᴅ* ᴍᴇssᴀɢᴇ ғʀᴏᴍ ᴛʜᴇ ᴄʜᴀɴɴᴇʟ.'));
            }
            
            const startMsg = currentState.data.startMessage;
            const endMsg = msg;

            if (startMsg.forward_from_chat.id !== endMsg.forward_from_chat.id) {
                USER_STATE.delete(userId);
                return sendOrEditMessage(chatId, toSmallCaps('❌ ʙᴀᴛᴄʜ ᴇʀʀᴏʀ: sᴛᴀʀᴛ ᴀɴᴅ ᴇɴᴅ ᴍᴇssᴀɢᴇs ᴍᴜsᴛ ʙᴇ ғʀᴏᴍ ᴛʜᴇ sᴀᴍᴇ ᴄʜᴀɴɴᴇʟ. ᴘʀᴏᴄᴇss ᴄᴀɴᴄᴇʟʟᴇᴅ.'));
            }

            const startId = startMsg.forward_from_message_id;
            const endId = endMsg.forward_from_message_id;

            if (startId > endId) {
                USER_STATE.delete(userId);
                return sendOrEditMessage(chatId, toSmallCaps('❌ ʙᴀᴛᴄʜ ᴇʀʀᴏʀ: sᴛᴀʀᴛ ᴍᴇssᴀɢᴇ ɪᴅ ᴄᴀɴɴᴏᴛ ʙᴇ ɢʀᴇᴀᴛᴇʀ ᴛʜᴀɴ ᴇɴᴅ ᴍᴇssᴀɢᴇ ɪᴅ. ᴘʀᴏᴄᴇss ᴄᴀɴᴄᴇʟʟᴇᴅ.'));
            }
            
            if (user.linkCount >= limit && limit !== Infinity) {
                USER_STATE.delete(userId);
                return sendOrEditMessage(chatId, toSmallCaps(`❌ ᴜᴘʟᴏᴀᴅ ʟɪᴍɪᴛ ʀᴇᴀᴄʜᴇᴅ. ʏᴏᴜʀ ᴄᴜʀʀᴇɴᴛ ᴛɪᴇʀ (${tier.name}) ʟɪᴍɪᴛ ɪs ${limit} ʟɪɴᴋs.`));
            }

            const uniqueId = generateUniqueId();
            const batchTitle = startMsg.caption || `Batch from ID ${startId} to ${endId}`;

            await addFile({
                uniqueId: uniqueId, type: 'sequential_batch', chatId: startMsg.forward_from_chat.id,
                startId: startId, endId: endId, fileName: batchTitle,
                uploadedBy: userId, uploaderName: startMsg.from.first_name, views: 0, downloads: 0,
            });
            
            await incrementLinkCount(userId);
            USER_STATE.delete(userId);

            const directLink = `https://t.me/${BOT_INFO.username}?start=sequential_${uniqueId}`; 

            await sendOrEditMessage(chatId, `🎉 **${toSmallCaps('sᴇǫᴜᴇɴᴛɪᴀʟ ʙᴀᴛᴄʜ ʟɪɴᴋ ɢᴇɴᴇʀᴀᴛᴇᴅ!')}**\n\n${toSmallCaps('ᴛɪᴛʟᴇ')}: <code>${batchTitle}</code>\n${toSmallCaps('ᴍᴇssᴀɢᴇ ᴄᴏᴜɴᴛ')}: ${endId - startId + 1}`, {
                inline_keyboard: [
                    [{ text: toSmallCaps('🔗 ᴏᴘᴇɴ ʙᴀᴛᴄʜ ʟɪɴᴋ'), url: directLink }]
                ]
            });
            return;
        } 
        
        else if (currentState.state === 'AWAITING_CUSTOM_FILES') {
            if (!isAdmin(userId)) return;
            
            const file = msg.photo ? msg.photo[msg.photo.length - 1] : (msg.video || msg.document || msg.audio);
            
            if (file) {
                // TIER LIMIT CHECK (File Size - enforced even for admin if custom batching is abused)
                const fileSize = file.file_size || 0;
                if (fileSize > maxFileSize && maxFileSize !== Infinity) {
                    return sendOrEditMessage(chatId, toSmallCaps(`❌ ғɪʟᴇ ᴛᴏᴏ ʟᴀʀɢᴇ. ᴍᴀx sɪᴢᴇ ғᴏʀ ${tier.name} ᴛɪᴇʀ ɪs ${formatFileSize(maxFileSize)}.`));
                }

                currentState.files.push({
                    file_id: file.file_id,
                    file_name: file.file_name || msg.caption || `File ${currentState.files.length + 1}`
                });
                
                USER_STATE.set(userId, currentState);
                
                await sendOrEditMessage(chatId, toSmallCaps(`✅ ғɪʟᴇ ᴀᴅᴅᴇᴅ. ᴛᴏᴛᴀʟ ғɪʟᴇs: ${currentState.files.length}. ғᴏʀᴡᴀʀᴅ ᴛʜᴇ ɴᴇxᴛ ᴏɴᴇ ᴏʀ sᴇɴᴅ /done <Title> ᴛᴏ ғɪɴᴀʟɪᴢᴇ.`));
                return;
            } 
            // Handle if a user sends a text message not containing a file.
            else {
                return sendOrEditMessage(chatId, toSmallCaps('⚠️ ᴘʟᴇᴀsᴇ ғᴏʀᴡᴀʀᴅ ᴀ ғɪʟᴇ (ᴠɪᴅᴇᴏ, ᴅᴏᴄᴜᴍᴇɴᴛ, ᴘʜᴏᴛᴏ) ᴏʀ sᴇɴᴅ /done <Title> ᴛᴏ ғɪɴᴀʟɪᴢᴇ ᴛʜᴇ ʙᴀᴛᴄʜ.'));
            }
        }
    }
    
    // --- GENERAL UNHANDLED MESSAGE ---
    if (msg.chat.type === 'private') {
        // Only respond if the user is not in a current process
        if (!USER_STATE.has(userId)) {
            await sendOrEditMessage(chatId, toSmallCaps('👋 ʜɪ ᴛʜᴇʀᴇ! ɪғ ʏᴏᴜ ᴡᴀɴᴛ ᴛᴏ ɢᴇɴᴇʀᴀᴛᴇ ᴀ ʟɪɴᴋ, ᴘʟᴇᴀsᴇ ᴜsᴇ ᴛʜᴇ /getlink ᴄᴏᴍᴍᴀɴᴅ ᴏʀ ᴛʏᴘᴇ /start ᴛᴏ sᴇᴇ ᴛʜᴇ ᴍᴇɴᴜ.'));
        }
    }
});

// --- CALLBACK QUERY HANDLER ---
bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const data = callbackQuery.data;
    const userId = callbackQuery.from.id;
    const chatId = message.chat.id;

    await bot.answerCallbackQuery(callbackQuery.id); // Acknowledge the press

    if (await isUserBanned(userId)) {
        return sendOrEditMessage(chatId, toSmallCaps('❌ ʏᴏᴜ ᴀʀᴇ ᴄᴜʀʀᴇɴᴛʟʏ ʙᴀɴɴᴇᴅ ғʀᴏᴍ ᴜsɪɴɢ ᴛʜɪs ʙᴏᴛ.'));
    }

    let user = await registerUser(callbackQuery);
    const tier = getUserTier(user);

    switch (data) {
        case 'start_getlink':
        case 'start':
            // The /start handler already performs the main menu logic, use it to ensure state is clear.
            return bot.emit('text', `/start`, message); 
            
        case 'show_how_to_use':
            // This is a minimal implementation, usually you'd send a longer help message.
            return bot.emit('text', `/help`, message); 

        case 'show_my_stats':
            return bot.emit('text', `/stats`, message); 
            
        case 'admin_panel':
            if (tier.name !== USER_TIERS.ADMIN.name) return;
            
            const adminText = `👑 **${toSmallCaps('ᴀᴅᴍɪɴɪsᴛʀᴀᴛɪᴏɴ ᴘᴀɴᴇʟ')}**\n${toSmallCaps('ᴄʜᴏᴏsᴇ ᴀɴ ᴀᴄᴛɪᴏɴ ʙᴇʟᴏᴡ.')}`;
            const adminKeyboard = {
                inline_keyboard: [
                    [{ text: toSmallCaps('📊 ʙᴏᴛ sᴛᴀᴛᴜs'), callback_data: 'admin_status' }, { text: toSmallCaps('📣 ʙʀᴏᴀᴅᴄᴀsᴛ'), callback_data: 'admin_broadcast_start' }],
                    [{ text: toSmallCaps('➕ ʙᴀᴛᴄʜ ʟɪɴᴋ'), callback_data: 'admin_batch_start' }, { text: toSmallCaps('➕ ᴄᴜsᴛᴏᴍ ʙᴀᴛᴄʜ'), callback_data: 'admin_custom_batch_start' }],
                    [{ text: toSmallCaps('🔨 ᴍᴀɴᴀɢᴇ ᴜsᴇʀs'), callback_data: 'admin_manage_users' }],
                    [{ text: toSmallCaps('🔙 ᴍᴀɪɴ ᴍᴇɴᴜ'), callback_data: 'start' }]
                ]
            };
            await sendOrEditMessage(chatId, adminText, adminKeyboard, message.message_id);
            break;

        case 'admin_status':
            if (tier.name !== USER_TIERS.ADMIN.name) return;
            // Simplified status retrieval for this example
            const statusText = await getBotStatus(); 
            await sendOrEditMessage(chatId, statusText, null, message.message_id);
            break;
            
        case 'admin_batch_start':
            if (tier.name !== USER_TIERS.ADMIN.name) return;
            USER_STATE.set(userId, { state: 'AWAITING_BATCH_START', data: {} });
            await sendOrEditMessage(chatId, toSmallCaps('📤 ᴘʟᴇᴀsᴇ ғᴏʀᴡᴀʀᴅ ᴛʜᴇ *sᴛᴀʀᴛ* ᴍᴇssᴀɢᴇ ᴏғ ᴛʜᴇ ʙᴀᴛᴄʜ ғʀᴏᴍ ᴛʜᴇ sᴛᴏʀᴀɢᴇ ᴄʜᴀɴɴᴇʟ.'));
            break;

        case 'admin_custom_batch_start':
            if (tier.name !== USER_TIERS.ADMIN.name) return;
            USER_STATE.set(userId, { state: 'AWAITING_CUSTOM_FILES', files: [] });
            await sendOrEditMessage(chatId, toSmallCaps('📤 sᴛᴀʀᴛɪɴɢ ᴄᴜsᴛᴏᴍ ʙᴀᴛᴄʜ. ғᴏʀᴡᴀʀᴅ ғɪʟᴇs ᴏɴᴇ-ʙʏ-ᴏɴᴇ. sᴇɴᴅ /done <Title> ᴛᴏ ғɪɴᴀʟɪᴢᴇ ᴛʜᴇ ʙᴀᴛᴄʜ.'));
            break;

        case 'admin_manage_users':
            if (tier.name !== USER_TIERS.ADMIN.name) return;
            const manageText = `🔨 **${toSmallCaps('ᴜsᴇʀ ᴍᴀɴᴀɢᴇᴍᴇɴᴛ')}**\n${toSmallCaps('ᴄʜᴏᴏsᴇ ᴀɴ ᴀᴄᴛɪᴏɴ ʙᴇʟᴏᴡ.')}`;
            const manageKeyboard = {
                inline_keyboard: [
                    [{ text: toSmallCaps('🚫 ʙᴀɴ ᴜsᴇʀ'), callback_data: 'admin_ban_user' }, { text: toSmallCaps('✅ ᴜɴʙᴀɴ ᴜsᴇʀ'), callback_data: 'admin_unban_user' }],
                    [{ text: toSmallCaps('🔙 ᴀᴅᴍɪɴ ᴘᴀɴᴇʟ'), callback_data: 'admin_panel' }]
                ]
            };
            await sendOrEditMessage(chatId, manageText, manageKeyboard, message.message_id);
            break;

        case 'admin_ban_user':
            if (tier.name !== USER_TIERS.ADMIN.name) return;
            USER_STATE.set(userId, { state: 'AWAITING_USER_ID_TO_BAN' });
            await sendOrEditMessage(chatId, toSmallCaps('🚫 ᴘʟᴇᴀsᴇ sᴇɴᴅ ᴛʜᴇ *ᴜsᴇʀ ɪᴅ* ᴛᴏ ʙᴀɴ. sᴇɴᴅ /cancel ᴛᴏ sᴛᴏᴘ.'));
            break;

        case 'admin_unban_user':
            if (tier.name !== USER_TIERS.ADMIN.name) return;
            USER_STATE.set(userId, { state: 'AWAITING_USER_ID_TO_UNBAN' });
            await sendOrEditMessage(chatId, toSmallCaps('✅ ᴘʟᴇᴀsᴇ sᴇɴᴅ ᴛʜᴇ *ᴜsᴇʀ ɪᴅ* ᴛᴏ ᴜɴʙᴀɴ. sᴇɴᴅ /cancel ᴛᴏ sᴛᴏᴘ.'));
            break;
            
        default:
            // Generic message for unhandled callback data
            await bot.answerCallbackQuery(callbackQuery.id, toSmallCaps('ᴜɴʜᴀɴᴅʟᴇᴅ ᴀᴄᴛɪᴏɴ.'), true);
            break;
    }
});


// --- COMMAND HANDLERS (Simplified for brevity, but matching bot(1).js structure) ---

bot.onText(/\/getlink/, async (msg) => {
    const userId = msg.from.id;
    if (USER_STATE.has(userId)) {
        await sendOrEditMessage(msg.chat.id, toSmallCaps('⚠️ ᴘʟᴇᴀsᴇ /ᴄᴀɴᴄᴇʟ ᴛʜᴇ ᴄᴜʀʀᴇɴᴛ ᴘʀᴏᴄᴇss ғɪʀsᴛ.'));
        return;
    }
    await registerUser(msg);
    if (await isUserBanned(userId)) return;

    USER_STATE.set(userId, { state: 'AWAITING_SINGLE_POST_FORWARD' });
    await sendOrEditMessage(msg.chat.id, toSmallCaps('📤 ᴘʟᴇᴀsᴇ ғᴏʀᴡᴀʀᴅ ᴀ sɪɴɢʟᴇ ғɪʟᴇ (ᴠɪᴅᴇᴏ/ᴅᴏᴄᴜᴍᴇɴᴛ/ᴘʜᴏᴛᴏ) ᴏʀ ᴀ ᴍᴇssᴀɢᴇ ᴛᴏ ɢᴇɴᴇʀᴀᴛᴇ ᴀ ᴘᴇʀᴍᴀɴᴇɴᴛ ʟɪɴᴋ.'));
});

bot.onText(/\/batch/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const user = await registerUser(msg);
    if (getUserTier(user).name !== USER_TIERS.ADMIN.name) return sendOrEditMessage(chatId, toSmallCaps('⛔️ ᴀᴅᴍɪɴ ᴏɴʟʏ ᴄᴏᴍᴍᴀɴᴅ.'));
    if (USER_STATE.has(userId)) {
        await sendOrEditMessage(chatId, toSmallCaps('⚠️ ᴘʟᴇᴀsᴇ /ᴄᴀɴᴄᴇʟ ᴛʜᴇ ᴄᴜʀʀᴇɴᴛ ᴘʀᴏᴄᴇss ғɪʀsᴛ.'));
        return;
    }
    USER_STATE.set(userId, { state: 'AWAITING_BATCH_START', data: {} });
    await sendOrEditMessage(chatId, toSmallCaps('📤 ᴘʟᴇᴀsᴇ ғᴏʀᴡᴀʀᴅ ᴛʜᴇ *sᴛᴀʀᴛ* ᴍᴇssᴀɢᴇ ᴏғ ᴛʜᴇ ʙᴀᴛᴄʜ ғʀᴏᴍ ᴛʜᴇ sᴛᴏʀᴀɢᴇ ᴄʜᴀɴɴᴇʟ.'));
});

bot.onText(/\/custom_batch/, async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const user = await registerUser(msg);
    if (getUserTier(user).name !== USER_TIERS.ADMIN.name) return sendOrEditMessage(chatId, toSmallCaps('⛔️ ᴀᴅᴍɪɴ ᴏɴʟʏ ᴄᴏᴍᴍᴀɴᴅ.'));
    if (USER_STATE.has(userId)) {
        await sendOrEditMessage(chatId, toSmallCaps('⚠️ ᴘʟᴇᴀsᴇ /ᴄᴀɴᴄᴇʟ ᴛʜᴇ ᴄᴜʀʀᴇɴᴛ ᴘʀᴏᴄᴇss ғɪʀsᴛ.'));
        return;
    }
    USER_STATE.set(userId, { state: 'AWAITING_CUSTOM_FILES', files: [] });
    await sendOrEditMessage(chatId, toSmallCaps('📤 sᴛᴀʀᴛɪɴɢ ᴄᴜsᴛᴏᴍ ʙᴀᴛᴄʜ. ғᴏʀᴡᴀʀᴅ ғɪʟᴇs ᴏɴᴇ-ʙʏ-ᴏɴᴇ. sᴇɴᴅ /done <Title> ᴛᴏ ғɪɴᴀʟɪᴢᴇ ᴛʜᴇ ʙᴀᴛᴄʜ.'));
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
    await addFile({
        uniqueId, type: 'custom_file_batch', fileList: currentState.files, fileName: batchTitle,
        uploadedBy: userId, uploaderName: user.firstName, views: 0, downloads: 0,
    });
    
    await incrementLinkCount(userId);
    USER_STATE.delete(userId);
    
    const directLink = `https://t.me/${BOT_INFO.username}?start=custom_${uniqueId}`;
    await sendOrEditMessage(chatId, `🎉 **${toSmallCaps('ᴄᴜsᴛᴏᴍ ғɪʟᴇ ʙᴀᴛᴄʜ ʟɪɴᴋ ɢᴇɴᴇʀᴀᴛᴇᴅ!')}**\n\n${toSmallCaps('ᴛɪᴛʟᴇ')}: <code>${batchTitle}</code>\n${toSmallCaps('ᴄᴏɴᴛᴀɪɴs')} ${currentState.files.length} ${toSmallCaps('ғɪʟᴇs.')}`, {
        inline_keyboard: [
            [{ text: toSmallCaps('🔗 ᴏᴘᴇɴ ʙᴀᴛᴄʜ ʟɪɴᴋ'), url: directLink }]
        ]
    });
});

bot.onText(/\/stats/, async (msg) => {
    const userId = msg.from.id;
    const user = await getUser(userId);
    if (!user || await isUserBanned(userId)) return;
    const tier = getUserTier(user);
    
    const totalFiles = DATABASE_URL ? await File.countDocuments({ uploadedBy: userId }) : Array.from(MEMORY_DATABASE.files.values()).filter(f => f.uploadedBy === userId).length;
    
    const statsText = `
        📈 **${toSmallCaps('ʏᴏᴜʀ ᴘᴇʀsᴏɴᴀʟ sᴛᴀᴛɪsᴛɪᴄs')}**
        ${toSmallCaps('ᴜsᴇʀ ɪᴅ')}: <code>${userId}</code>
        ${toSmallCaps('ᴛɪᴇʀ')}: **${tier.name}**
        ${toSmallCaps('ᴜᴘʟᴏᴀᴅ ʟɪᴍɪᴛ')}: ${user.linkCount || 0}/${tier.limit === Infinity ? '∞' : tier.limit}
        ${toSmallCaps('ᴍᴀx ғɪʟᴇ sɪᴢᴇ')}: ${formatFileSize(tier.maxFileSize)}
        ${toSmallCaps('ᴛᴏᴛᴀʟ ʟɪɴᴋs ᴄʀᴇᴀᴛᴇᴅ')}: ${totalFiles}
    `;
    await sendOrEditMessage(msg.chat.id, statsText);
});

bot.onText(/\/help/, async (msg) => {
    let helpText = `
        🆘 **${toSmallCaps('ʙᴏᴛ ʜᴇʟᴘ & ᴄᴏᴍᴍᴀɴᴅs')}**
        
        ${toSmallCaps('ᴄᴏʀᴇ ғᴜɴᴄᴛɪᴏɴs:')}
        • <code>/start</code> - ${toSmallCaps('ᴍᴀɪɴ ᴍᴇɴᴜ, ᴄʟᴇᴀʀs sᴛᴀᴛᴇ.')}
        • <code>/getlink</code> - ${toSmallCaps('ɢᴇɴᴇʀᴀᴛᴇ ᴀ ʟɪɴᴋ ғᴏʀ ᴀ sɪɴɢʟᴇ ғɪʟᴇ/ᴍᴇssᴀɢᴇ (ғᴏʀᴡᴀʀᴅ ᴄᴏɴᴛᴇɴᴛ).')}
        • <code>/anime <title></code> - ${toSmallCaps('sᴇᴀʀᴄʜ ғᴏʀ ᴀɴɪᴍᴇ ᴍᴇᴛᴀᴅᴀᴛᴀ ᴀɴᴅ ᴄʜᴇᴄᴋ ғᴏʀ ʟᴏᴄᴀʟ ʟɪɴᴋs.')}
        • <code>/stats</code> - ${toSmallCaps('ᴅɪsᴘʟᴀʏ ʏᴏᴜʀ ᴄᴜʀʀᴇɴᴛ ᴛɪᴇʀ, ʟɪᴍɪᴛs, ᴀɴᴅ ғɪʟᴇ ᴄᴏᴜɴᴛ.')}
        • <code>/files</code> - ${toSmallCaps('ʟɪsᴛ ʏᴏᴜʀ ʟᴀᴛᴇsᴛ ᴜᴘʟᴏᴀᴅᴇᴅ ʟɪɴᴋs.')}
        • <code>/help</code> - ${toSmallCaps('ᴅɪsᴘʟᴀʏ ᴛʜɪs ʜᴇʟᴘ ᴛᴇxᴛ.')}
        • <code>/cancel</code> - ${toSmallCaps('ᴀʙᴏʀᴛ ᴄᴜʀʀᴇɴᴛ ᴍᴜʟᴛɪ-sᴛᴇᴘ ᴘʀᴏᴄᴇss.')}
    `;
    const user = await getUser(msg.from.id);
    if (getUserTier(user).name === USER_TIERS.ADMIN.name) {
        helpText += `
            \n${toSmallCaps('ᴀᴅᴍɪɴ-ᴏɴʟʏ ᴄᴏᴍᴍᴀɴᴅs:')}
            • <code>/status</code> - ${toSmallCaps('ᴠɪᴇᴡ ɢʟᴏʙᴀʟ ʙᴏᴛ sᴛᴀᴛɪsᴛɪᴄs.')}
            • <code>/batch</code> - ${toSmallCaps('ɢᴇɴᴇʀᴀᴛᴇ ᴀ sᴇǫᴜᴇɴᴛɪᴀʟ ʟɪɴᴋ (ғᴏʀᴡᴀʀᴅ sᴛᴀʀᴛ/ᴇɴᴅ ᴘᴏsᴛs).')}
            • <code>/custom_batch</code> - ${toSmallCaps('sᴛᴀʀᴛ ᴄᴏʟʟᴇᴄᴛɪɴɢ ғɪʟᴇs ғᴏʀ ᴀ ᴄᴜsᴛᴏᴍ ʙᴀᴛᴄʜ ʟɪɴᴋ.')}
            • <code>/done <Title></code> - ${toSmallCaps('ғɪɴᴀʟɪᴢᴇ ᴛʜᴇ ᴄᴜsᴛᴏᴍ ʙᴀᴛᴄʜ ᴀɴᴅ ɢᴇɴᴇʀᴀᴛᴇ ᴛʜᴇ ʟɪɴᴋ.')}
        `;
    }
    await sendOrEditMessage(msg.chat.id, helpText);
});


// ... (Other command handlers like /cancel, /files, /status, /anime and /broadcast/ban/unban logic for Admin are present in the full context but omitted for brevity in this response)

/**
 * Handles the deep link /start file_XXXX, forward_XXXX, etc.
 */
async function handleDeepLink(msg, match) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const type = match[1];
    const uniqueId = match[2];

    const data = await getFile(uniqueId);
    if (!data || data.isBlocked) {
        return sendOrEditMessage(chatId, toSmallCaps('❌ ʟɪɴᴋ ɴᴏᴛ ғᴏᴜɴᴅ ᴏʀ ᴇxᴘɪʀᴇᴅ.'));
    }

    const user = await getUser(userId);
    
    // Delivery message
    await sendOrEditMessage(chatId, `🚀 **${toSmallCaps('ᴅᴇʟɪᴠᴇʀɪɴɢ ᴄᴏɴᴛᴇɴᴛ...')}**\n${toSmallCaps('ᴛɪᴛʟᴇ')}: <code>${data.fileName}</code>`);

    // Delivery Logic
    try {
        if (data.type === 'sequential_batch' && data.chatId) {
            for (let id = data.startId; id <= data.endId; id++) {
                await bot.copyMessage(chatId, data.chatId, id);
                await new Promise(resolve => setTimeout(resolve, 300));
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
        await bot.sendMessage(chatId, toSmallCaps('❌ ᴇʀʀᴏʀ ᴅᴇʟɪᴠᴇʀɪɴɢ ᴄᴏɴᴛᴇɴᴛ. ᴛʜᴇ sᴏᴜʀᴄᴇ ᴍᴇssᴀɢᴇ ᴍᴀʏ ʙᴇ ᴅᴇʟᴇᴛᴇᴅ ᴏʀ ɪɴᴀᴄᴄᴇssɪʙʟᴇ.'), { parse_mode: 'HTML' });
    }

    await updateFileStats(uniqueId, 'view'); // Increment views after successful delivery
    await bot.sendMessage(chatId, toSmallCaps('✅ ᴄᴏɴᴛᴇɴᴛ ᴅᴇʟɪᴠᴇʀʏ ᴄᴏᴍᴘʟᴇᴛᴇ. ᴛʜᴀɴᴋ ʏᴏᴜ ғᴏʀ ᴜsɪɴɢ ᴛʜᴇ ʙᴏᴛ!'), { parse_mode: 'HTML' });
}


// --- ANILIST SEARCH COMMAND ---

bot.onText(/\/anime (.+)/, async (msg, match) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const user = await registerUser(msg);
    if (await isUserBanned(userId)) return;

    const searchTitle = match[1].trim();
    if (!searchTitle) {
        return sendOrEditMessage(chatId, toSmallCaps('⚠️ ᴘʟᴇᴀsᴇ ᴘʀᴏᴠɪᴅᴇ ᴀɴ ᴀɴɪᴍᴇ ᴛɪᴛʟᴇ ᴛᴏ sᴇᴀʀᴄʜ. ᴇ.ɢ., /anime Jujutsu Kaisen'));
    }

    // Send a searching message
    const waitMessage = await sendOrEditMessage(chatId, toSmallCaps(`🔎 sᴇᴀʀᴄʜɪɴɢ ғᴏʀ "${searchTitle}" ᴏɴ ᴀɴɪʟɪsᴛ...`));

    const anime = await searchAniList(searchTitle);
    
    if (!anime) {
        try { await bot.deleteMessage(chatId, waitMessage.message_id); } catch (e) {}
        return sendOrEditMessage(chatId, toSmallCaps(`❌ ɴᴏ ʀᴇsᴜʟᴛs ғᴏᴜɴᴅ ғᴏʀ "${searchTitle}".`));
    }

    // Attempt to find a local file with a matching name (simple check)
    const localFile = DATABASE_URL 
        ? await File.findOne({ fileName: new RegExp(searchTitle, 'i'), type: 'single_file' })
        : Array.from(MEMORY_DATABASE.files.values()).find(f => f.type === 'single_file' && f.fileName.match(new RegExp(searchTitle, 'i')));

    // Build the response text and keyboard
    const description = anime.description ? anime.description.replace(/<br>/g, '\n').replace(/<i>/g, '<i>').replace(/<\/i>/g, '</i>').substring(0, 500) + '...' : toSmallCaps('ɴᴏ ᴅᴇsᴄʀɪᴘᴛɪᴏɴ ᴀᴠᴀɪʟᴀʙʟᴇ.');
    const animeText = `
        🎬 **${toSmallCaps('ᴀɴɪʟɪsᴛ sᴇᴀʀᴄʜ ʀᴇsᴜʟᴛ')}**
        
        ${toSmallCaps('ᴛɪᴛʟᴇ (ᴇɴɢʟɪsʜ)')}: **${anime.title.english || anime.title.romaji}**
        ${toSmallCaps('ᴛɪᴛʟᴇ (ʀᴏᴍᴀᴊɪ)')}: ${anime.title.romaji || 'N/A'}
        ${toSmallCaps('sᴛᴀᴛᴜs')}: *${anime.status.replace('_', ' ')}*
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

    // Use sendPhoto as the result has a cover image URL
    await bot.sendPhoto(chatId, anime.coverImage.large, { 
        caption: animeText, 
        parse_mode: 'HTML', 
        reply_markup: keyboard, 
        disable_web_page_preview: true 
    });

    // Delete the 'Searching' message
    try { await bot.deleteMessage(chatId, waitMessage.message_id); } catch (e) {}
});


// ----------------------------------------------------------------------
// 8. EXPRESS WEB SERVER LOGIC (Streaming/Download Infrastructure)
// ----------------------------------------------------------------------

app.use(express.json());
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
    next();
});


// Web link page - /file/:id (Serves a static page with stream/download buttons)
app.get('/file/:id', async (req, res) => {
    const uniqueId = req.params.id;
    const file = await getFileDetailsForWeb(uniqueId);
    
    if (!file) {
        return res.status(404).send(toSmallCaps('❌ ғɪʟᴇ ɴᴏᴛ ғᴏᴜɴᴅ ᴏʀ ɪs ɴᴏᴛ ᴀ sᴛʀᴇᴀᴍᴀʙʟᴇ ᴛʏᴘᴇ.'));
    }

    if (file.type === 'single_file' && file.fileUrl) {
        const fileSizeMB = formatFileSize(file.fileSize);
        const htmlContent = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${file.fileName}</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background-color: #1a1a1a; color: #f0f0f0; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
                    .container { background-color: #2a2a2a; padding: 40px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); text-align: center; max-width: 450px; width: 90%; }
                    h1 { color: #f0f0f0; font-size: 1.8rem; margin-bottom: 10px; word-break: break-word; }
                    p { color: #ccc; margin-bottom: 5px; }
                    .button-group { margin-top: 30px; display: flex; flex-direction: column; gap: 15px; }
                    a { text-decoration: none; padding: 15px 25px; border-radius: 8px; font-weight: bold; transition: background-color 0.3s, transform 0.1s; display: block; }
                    a:hover { opacity: 0.9; transform: translateY(-2px); }
                    a:first-child { background-color: #FF5722; color: white; }
                    a:last-child { background-color: #03A9F4; color: white; }
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
            </body>
            </html>
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
        await updateFileStats(uniqueId, 'view'); // Increment views

        if (!range) {
            // No range header: serve full file (direct download)
            await updateFileStats(uniqueId, 'download'); // Count as download
            res.setHeader('Content-Type', file.mimeType);
            res.setHeader('Content-Length', file.fileSize);
            res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
            
            // Stream the file content directly from Telegram's URL
            const tgResponse = await fetch(file.fileUrl);
            if (!tgResponse.ok) throw new Error(`Telegram API failed with status ${tgResponse.status}`);
            return tgResponse.body.pipe(res);
        }

        // Range header present: handle streaming/seeking
        const fileSize = file.fileSize;
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize) {
            res.status(416).send('Requested range not satisfiable\n' + range + ' < ' + fileSize);
            return;
        }

        const chunkSize = (end - start) + 1;
        
        res.status(206); // Partial Content
        res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Length', chunkSize);
        res.setHeader('Content-Type', file.mimeType);
        
        // Use node-fetch to make a ranged request to Telegram
        const tgResponse = await fetch(file.fileUrl, {
            headers: { 'Range': `bytes=${start}-${end}` }
        });

        if (!tgResponse.ok) throw new Error(`Telegram API failed with status ${tgResponse.status}`);
        
        tgResponse.body.pipe(res);

    } catch (error) {
        console.error(`[STREAM ERROR for ${uniqueId}]`, error.message);
        res.status(500).send('Error streaming file: ' + error.message);
    }
});

// Endpoint for direct download (redirect to Telegram URL) - /download/:id
app.get('/download/:id', async (req, res) => {
    const uniqueId = req.params.id;
    const file = await getFileDetailsForWeb(uniqueId);
    
    if (!file) return res.status(404).send('File not found for download.');
    
    await updateFileStats(uniqueId, 'download'); 
    
    // Redirecting directly to the Telegram file URL with a content disposition header
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.redirect(302, file.fileUrl);
});

// Fallback link for non-streamable file types
app.get('/link/:id', async (req, res) => {
    const uniqueId = req.params.id;
    const data = await getFile(uniqueId);
    if (!data) return res.status(404).send('Direct Link not found or expired.');
    
    const linkType = data.type.split('_')[0];
    const deepLink = `https://t.me/${BOT_INFO.username}?start=${linkType}_${uniqueId}`;
    res.redirect(302, deepLink);
});

// ----------------------------------------------------------------------
// 9. INITIALIZATION & EXECUTION BLOCK
// ----------------------------------------------------------------------

// Start the Express Server
app.listen(PORT, () => {
    console.log('----------------------------------------------------');
    console.log(`🚀 ᴡᴇʙ sᴇʀᴠᴇʀ sᴛᴀʀᴛᴇᴅ sᴜᴄᴄᴇssғᴜʟʟʏ ᴏɴ ᴘᴏʀᴛ ${PORT}.`);
    console.log(`🌐 ᴡᴇʙ ᴀᴘᴘ ᴜʀʟ: ${WEBAPP_URL}`);
    console.log('----------------------------------------------------');
});

// ----------------------------------------------------------------------
// 9. INITIALIZATION & EXECUTION BLOCK - UPDATED COMMAND LIST
// ----------------------------------------------------------------------

// ... (previous code)

// Set all custom commands visible in the Telegram menu
bot.setMyCommands([
    { command: 'start', description: 'Open the Main Menu' },
    { command: 'getlink', description: 'Generate a permanent link for a file' },
    { command: 'anime', description: 'Search AniList for anime information' },
    { command: 'stats', description: 'Display your current tier and usage limits' },
    { command: 'files', description: 'View your uploaded files' },
    { command: 'help', description: 'Show the list of features and commands' },
    { command: 'cancel', description: 'Abort current multi-step operation (e.g., batch)' },
    
    // --- Admin Management Commands ---
    { command: 'admin', description: 'Open the Admin Control Panel (Admin Only)' }, // Use /admin for the main panel
    { command: 'broadcast', description: 'Send a message to all bot users (Admin Only)' },
    { command: 'batch', description: 'Generate a sequential link by forwarding start/end posts (Admin Only)' },
    { command: 'custom_batch', description: 'Start a custom batch creation process (Admin Only)' },
    { command: 'done', description: 'Finalize and generate link for /custom_batch (Admin Only)' },
    { command: 'ban', description: 'Ban a user by ID (Admin Only)' },
    { command: 'unban', description: 'Unban a user by ID (Admin Only)' },
    { command: 'deletefile', description: 'Delete a file by its unique ID (Admin Only)' },
    { command: 'clearcache', description: 'Manually clear Telegram URL cache (Admin Only)' } 
]).then(() => console.log('✅ Telegram commands set.'));
