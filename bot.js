// ============================================
// TELEGRAM PERMANENT LINK BOT
// Creates permanent streaming links for Telegram videos
// ============================================

import TelegramBot from 'node-telegram-bot-api';
import express from 'express';
import fetch from 'node-fetch';

// ============================================
// CONFIGURATION
// ============================================
const BOT_TOKEN = process.env.BOT_TOKEN; // Your bot token from @BotFather
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://your-app.onrender.com'; // Your server URL
const PORT = process.env.PORT || 3000;

// Validate
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN is required!');
    process.exit(1);
}

// ============================================
// DATABASE - Store file information
// ============================================
const FILE_DATABASE = new Map(); // In production, use PostgreSQL/MongoDB

// ============================================
// TELEGRAM BOT
// ============================================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

console.log('✅ Bot started successfully!');

// ============================================
// BOT COMMANDS
// ============================================

// /start command
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, `
🎬 <b>Welcome to BeatAnimes Link Generator!</b>

Send me any video file from your channel and I'll generate a permanent streaming link for it.

<b>How to use:</b>
1. Forward any video from your channel to me
2. I'll generate a permanent link
3. Use that link in your website

<b>Commands:</b>
/help - Show this message
/stats - Show statistics
    `, { parse_mode: 'HTML' });
});

// Handle video messages
bot.on('message', async (msg) => {
    // Ignore commands
    if (msg.text && msg.text.startsWith('/')) return;
    
    const chatId = msg.chat.id;
    
    // Check if message has video
    if (!msg.video && !msg.document) {
        bot.sendMessage(chatId, '⚠️ Please send a video file!');
        return;
    }
    
    try {
        // Get file info
        const file = msg.video || msg.document;
        const fileId = file.file_id;
        const fileUniqueId = file.file_unique_id;
        const fileName = file.file_name || `video_${fileUniqueId}.mp4`;
        const fileSize = file.file_size;
        
        bot.sendMessage(chatId, '⏳ Generating permanent link...');
        
        // Get file path from Telegram
        const fileInfo = await bot.getFile(fileId);
        const filePath = fileInfo.file_path;
        
        // Generate unique ID for our database
        const uniqueId = generateUniqueId();
        
        // Store in database
        FILE_DATABASE.set(uniqueId, {
            fileId: fileId,
            fileUniqueId: fileUniqueId,
            fileName: fileName,
            fileSize: fileSize,
            filePath: filePath,
            createdAt: Date.now(),
            views: 0
        });
        
        // Generate permanent link
        const permanentLink = `${WEBAPP_URL}/stream/${uniqueId}`;
        const downloadLink = `${WEBAPP_URL}/download/${uniqueId}`;
        
        // Send response
        bot.sendMessage(chatId, `
✅ <b>Permanent Link Generated!</b>

📁 <b>File:</b> ${fileName}
💾 <b>Size:</b> ${formatFileSize(fileSize)}

🔗 <b>Streaming Link:</b>
<code>${permanentLink}</code>

⬇️ <b>Download Link:</b>
<code>${downloadLink}</code>

<b>This link is permanent and will never expire!</b>

Use this in your HTML:
<code>&lt;video src="${permanentLink}" controls&gt;&lt;/video&gt;</code>
        `, { 
            parse_mode: 'HTML',
            disable_web_page_preview: true 
        });
        
        console.log(`✅ Generated link for: ${fileName} (${uniqueId})`);
        
    } catch (error) {
        console.error('❌ Error:', error);
        bot.sendMessage(chatId, '❌ Error generating link. Please try again.');
    }
});

// /stats command
bot.onText(/\/stats/, (msg) => {
    const chatId = msg.chat.id;
    
    let totalSize = 0;
    let totalViews = 0;
    
    for (const file of FILE_DATABASE.values()) {
        totalSize += file.fileSize;
        totalViews += file.views;
    }
    
    bot.sendMessage(chatId, `
📊 <b>Statistics</b>

📁 Total Files: ${FILE_DATABASE.size}
💾 Total Storage: ${formatFileSize(totalSize)}
👁️ Total Views: ${totalViews}
    `, { parse_mode: 'HTML' });
});

// ============================================
// EXPRESS SERVER - Serve files
// ============================================
const app = express();

// Health check
app.get('/ping', (req, res) => {
    res.json({ 
        status: 'ok',
        files: FILE_DATABASE.size,
        uptime: process.uptime()
    });
});

// Stream video
app.get('/stream/:id', async (req, res) => {
    const fileId = req.params.id;
    
    const fileData = FILE_DATABASE.get(fileId);
    
    if (!fileData) {
        return res.status(404).send('File not found');
    }
    
    try {
        // Increment view count
        fileData.views++;
        
        // Get file URL from Telegram
        const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${fileData.filePath}`;
        
        console.log(`📺 Streaming: ${fileData.fileName} (View #${fileData.views})`);
        
        // Fetch file from Telegram and stream to client
        const response = await fetch(fileUrl);
        
        if (!response.ok) {
            throw new Error('Failed to fetch file from Telegram');
        }
        
        // Set headers for video streaming
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `inline; filename="${fileData.fileName}"`);
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
        
        // Stream the file
        response.body.pipe(res);
        
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
