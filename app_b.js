// BotPoint0-v1.0.0
require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcodeTerminal = require('qrcode-terminal'); // Renamed to avoid confusion with web QR
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Octokit } = require('@octokit/rest');

// --- Global State Variables ---
let connection = null;
let isSessionActive = false;
let currentQR = null;
let botStatus = 'initializing'; // initializing, qr_ready, connected, disconnected

// --- Configuration ---
const app = express();
const PORT = process.env.PORT || 3000;

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';

const USE_GITHUB_STORAGE = true;
const LOCAL_STORAGE_PATH = __dirname;

const statusSettings = {
  autoView: true,
  autoReact: true,
  autoLike: true,
  reactEmojis: ['💚', '❤️', '🔥', '😮', '👏'],
  saveMedia: true
};

const readReceiptSettings = {
  autoRead: false, 
  showReadReceipts: true 
};

let deletedMessages = {};

// --- Directory Setup ---
console.log('=== Bot Starting ===');
console.log('Storage type: GitHub (Exclusive)');
console.log('Local storage path:', LOCAL_STORAGE_PATH);

const MESSAGES_DIR = path.join(LOCAL_STORAGE_PATH, 'saved_messages');
const STATUS_DIR = path.join(LOCAL_STORAGE_PATH, 'status_updates');
const MEDIA_DIR = path.join(LOCAL_STORAGE_PATH, 'media');
const DELETED_DIR = path.join(LOCAL_STORAGE_PATH, 'deleted_messages');
const AUTH_DIR = path.join(LOCAL_STORAGE_PATH, 'auth_info');

[MESSAGES_DIR, STATUS_DIR, MEDIA_DIR, DELETED_DIR, AUTH_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`Created directory: ${dir}`);
    } catch (error) {
      console.error(`Error creating directory ${dir}:`, error);
    }
  }
});

// ==========================================
// EXPRESS WEB SERVER & INTERFACES
// ==========================================
app.use(express.json());

// 1. Standard Health Check
app.get('/', (req, res) => {
  res.status(200).json({
    status: botStatus,
    message: 'WhatsApp Bot Server is running!',
    uptime: formatUptime(process.uptime()),
    isLocal: LOCAL_STORAGE_PATH === __dirname
  });
});

// 2. API Endpoint for React Frontend (Optional Future Use)
app.get('/api/status', (req, res) => {
  res.json({
    status: botStatus,
    qr: currentQR
  });
});

// 3. The Web Management QR Interface
app.get('/qr', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WhatsApp Bot Management</title>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f0f2f5; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; color: #1c1e21; }
            .card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 90%; }
            h1 { font-size: 1.5rem; margin-top: 0; color: #128C7E; }
            #qrcode { margin: 20px auto; display: flex; justify-content: center; min-height: 256px; align-items: center; }
            .badge { display: inline-block; padding: 6px 12px; border-radius: 20px; font-size: 0.85rem; font-weight: bold; text-transform: uppercase; margin-bottom: 15px; }
            .badge.initializing { background: #e4e6eb; color: #4b4f56; }
            .badge.qr_ready { background: #e7f3ff; color: #1877f2; }
            .badge.connected { background: #d4edda; color: #155724; }
            .badge.disconnected { background: #fdecea; color: #e53935; }
            p { color: #65676b; font-size: 0.95rem; line-height: 1.5; }
            .loader { border: 4px solid #f3f3f3; border-top: 4px solid #128C7E; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style>
    </head>
    <body>
        <div class="card">
            <h1>BotPoint0 Manager</h1>
            <div id="statusBadge" class="badge initializing">Initializing...</div>
            
            <div id="qrcode">
                <div class="loader" id="loader"></div>
            </div>
            
            <p id="helperText">Booting up the WhatsApp engine. Please wait...</p>
        </div>

        <script>
            let qrCodeObj = null;
            let currentQrString = null;

            async function checkStatus() {
                try {
                    const response = await fetch('/api/status');
                    const data = await response.json();
                    
                    // Update Badge
                    const badge = document.getElementById('statusBadge');
                    badge.className = 'badge ' + data.status;
                    badge.innerText = data.status.replace('_', ' ');

                    const helperText = document.getElementById('helperText');
                    const loader = document.getElementById('loader');
                    const qrContainer = document.getElementById('qrcode');

                    if (data.status === 'qr_ready' && data.qr) {
                        if(loader) loader.style.display = 'none';
                        helperText.innerText = "Open WhatsApp on your phone and scan this code to link the bot.";
                        
                        // Only redraw if the QR string actually changed
                        if (currentQrString !== data.qr) {
                            qrContainer.innerHTML = ''; // Clear container
                            qrCodeObj = new QRCode(qrContainer, {
                                text: data.qr,
                                width: 256,
                                height: 256,
                                colorDark : "#1c1e21",
                                colorLight : "#ffffff",
                                correctLevel : QRCode.CorrectLevel.M
                            });
                            currentQrString = data.qr;
                        }
                    } 
                    else if (data.status === 'connected') {
                        qrContainer.innerHTML = '<svg viewBox="0 0 24 24" width="100" height="100" stroke="#128C7E" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
                        helperText.innerText = "Bot is successfully connected and actively monitoring messages!";
                        currentQrString = null;
                    } 
                    else if (data.status === 'disconnected') {
                        qrContainer.innerHTML = '<div class="loader"></div>';
                        helperText.innerText = "Connection lost. Attempting to restart engine...";
                        currentQrString = null;
                    }
                } catch (e) {
                    console.error('Error fetching status', e);
                }
            }

            // Poll backend every 2 seconds
            setInterval(checkStatus, 2000);
            checkStatus();
        </script>
    </body>
    </html>
  `);
});

// Start Express server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`👉 Web Management Interface available at: http://localhost:${PORT}/qr`);
  startBot();
});

server.on('error', (error) => {
  console.error('Server error:', error);
  setTimeout(() => {
    console.log('Attempting to restart server...');
    server.close();
    server.listen(PORT, '0.0.0.0');
  }, 5000);
});


// ==========================================
// GITHUB STORAGE FUNCTIONS
// ==========================================
async function saveToGitHub(filePath, content) {
  if (!USE_GITHUB_STORAGE) throw new Error('GitHub storage is required but not enabled');
  try {
    const fileContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    const encodedContent = Buffer.from(fileContent).toString('base64');
    let sha = null;
    try {
      const response = await octokit.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: filePath, ref: GITHUB_BRANCH });
      sha = response.data.sha;
    } catch (error) { if (error.status !== 404) throw error; }

    await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_OWNER, repo: GITHUB_REPO, path: filePath,
      message: `${sha ? 'Update' : 'Create'} ${path.basename(filePath)}`,
      content: encodedContent, branch: GITHUB_BRANCH, sha: sha 
    });
    return true;
  } catch (error) {
    console.error(`Error saving to GitHub: ${error.message}`);
    throw error;
  }
}

async function loadFromGitHub(filePath) {
  if (!USE_GITHUB_STORAGE) throw new Error('GitHub storage is required but not enabled');
  try {
    const response = await octokit.repos.getContent({ owner: GITHUB_OWNER, repo: GITHUB_REPO, path: filePath, ref: GITHUB_BRANCH });
    const content = Buffer.from(response.data.content, 'base64').toString();
    return JSON.parse(content);
  } catch (error) {
    if (error.status === 404) {
      const emptyContent = filePath.includes('deleted_messages') ? {} : [];
      await saveToGitHub(filePath, emptyContent);
      return emptyContent;
    }
    console.error(`Error loading from GitHub: ${error.message}`);
    throw error;
  }
}

async function saveDeletedMessages() {
  try { await saveToGitHub('deleted_messages.json', deletedMessages); } 
  catch (error) { console.error('Error saving deleted messages:', error); }
}

async function loadDeletedMessages() {
  try {
    const data = await loadFromGitHub('deleted_messages.json');
    deletedMessages = data || {};
  } catch (error) { deletedMessages = {}; }
}

// ==========================================
// MEDIA & MESSAGE HANDLERS
// ==========================================
async function downloadMedia(message, sender) {
  try {
    if (!message || !message.message) return null;
    
    let mediaType = null; let mediaContent = null;
    
    if (message.message.imageMessage) { mediaType = 'image'; mediaContent = message.message.imageMessage; } 
    else if (message.message.videoMessage) { mediaType = 'video'; mediaContent = message.message.videoMessage; } 
    else if (message.message.documentMessage) { mediaType = 'document'; mediaContent = message.message.documentMessage; } 
    else if (message.message.audioMessage) { mediaType = 'audio'; mediaContent = message.message.audioMessage; } 
    else if (message.message.stickerMessage) { mediaType = 'sticker'; mediaContent = message.message.stickerMessage; } 
    else { return null; }
    
    const timestamp = new Date().getTime();
    let extension = 'bin'; 
    
    if (mediaType === 'image') extension = 'jpg';
    else if (mediaType === 'video') extension = 'mp4';
    else if (mediaType === 'audio') extension = 'mp3';
    else if (mediaType === 'sticker') extension = 'webp';
    
    if (mediaType === 'document' && mediaContent.fileName) {
      const fileNameParts = mediaContent.fileName.split('.');
      if (fileNameParts.length > 1) extension = fileNameParts[fileNameParts.length - 1];
    }
    
    const fileName = `${sender}_${timestamp}.${extension}`;
    const filePath = path.join(MEDIA_DIR, fileName);
    if (!mediaContent) return null;
    
    return { type: mediaType, fileName: fileName, path: filePath, mime: mediaContent.mimetype };
  } catch (error) { return null; }
}

async function saveMessage(jid, message) {
  if (!jid || !message.key || !message.key.id) return;
  const fileId = `${jid.split('@')[0]}.json`;
  const githubPath = `messages/${fileId}`;
  let messages = {};
  
  try {
    messages = await loadFromGitHub(githubPath) || {};
    let mediaInfo = null;
    if (statusSettings.saveMedia && message.message) {
      const sender = message.key.participant || message.key.remoteJid.split('@')[0];
      mediaInfo = await downloadMedia(message, sender);
    }

    messages[message.key.id] = {
      key: message.key, message: message.message, messageTimestamp: message.messageTimestamp,
      status: message.status, mediaInfo: mediaInfo, savedAt: new Date().toISOString()
    };
    await saveToGitHub(githubPath, messages);
  } catch (error) { console.error('Error in saveMessage:', error); }
}

async function handleStatus(sock, message) {
  try {
    const statusId = message.key.id;
    const sender = message.key.participant || message.key.remoteJid.split('@')[0];
    const statusFilePath = path.join(STATUS_DIR, `${sender}.json`);
    
    let statuses = {};
    if (fs.existsSync(statusFilePath)) {
      try { statuses = JSON.parse(fs.readFileSync(statusFilePath, 'utf8')); } catch (err) {}
    }
    
    let mediaInfo = null;
    if (statusSettings.saveMedia) mediaInfo = await downloadMedia(message, sender); 
    
    statuses[statusId] = {
      key: message.key, message: message.message, messageTimestamp: message.messageTimestamp,
      mediaInfo: mediaInfo, savedAt: new Date().toISOString()
    };
    
    try { fs.writeFileSync(statusFilePath, JSON.stringify(statuses, null, 2)); } catch (err) {}

    if (statusSettings.autoView) await sock.readMessages([message.key]);

    if (statusSettings.autoLike) {
      await sock.sendMessage(message.key.remoteJid, { react: { text: '❤️', key: message.key } });
      await sock.sendMessage(message.key.remoteJid, { text: '❤️', quoted: message });
    } else if (statusSettings.autoReact) {
      const emoji = statusSettings.reactEmojis[Math.floor(Math.random() * statusSettings.reactEmojis.length)];
      await sock.sendMessage(message.key.remoteJid, { react: { text: emoji, key: message.key } });
    }
  } catch (error) { console.error('Error in handleStatus:', error); }
}

async function handleDeletedMessage(sock, message) {
  try {
    if (!message || !message.key || !message.key.remoteJid) return;
    const jid = message.key.remoteJid;
    const messageId = message.key.id;
    const fileId = `${jid.split('@')[0]}.json`;
    const filePath = path.join(MESSAGES_DIR, fileId);
    
    if (fs.existsSync(filePath)) {
      const savedMessages = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (savedMessages && savedMessages[messageId]) {
        const deletedMsg = savedMessages[messageId];
        if (!deletedMsg.key.fromMe) {
          let deletedContent = 'Unknown message content';
          if (deletedMsg.message) {
            deletedContent = deletedMsg.message.conversation || (deletedMsg.message.extendedTextMessage && deletedMsg.message.extendedTextMessage.text) || 'Media message';
          }
          
          if (!deletedMessages) deletedMessages = {};
          if (!deletedMessages[jid]) deletedMessages[jid] = {};
          
          const sender = (deletedMsg.key.participant || deletedMsg.key.remoteJid).split('@')[0];
          deletedMessages[jid][messageId] = {
            sender: sender, content: deletedContent,
            timestamp: deletedMsg.messageTimestamp || Math.floor(Date.now() / 1000),
            deletedAt: Math.floor(Date.now() / 1000), mediaInfo: deletedMsg.mediaInfo
          };
          
          saveDeletedMessages();
          let notificationText = `⚠️ *Message deleted by ${sender}*: "${deletedContent}"`;
          if (deletedMsg.mediaInfo) notificationText += `\n(Message contained ${deletedMsg.mediaInfo.type})`;
          await sock.sendMessage(jid, { text: notificationText });
        }
      }
    }
  } catch (error) { console.error('Error handling deleted message:', error); }
}

async function handleCommand(sock, jid, text, message) {
  const args = text.slice(1).trim().split(' ');
  const command = args.shift().toLowerCase();
  // ... (All your existing switch statements remain exactly the same here) ...
  switch (command) {
    case 'help': return sock.sendMessage(jid, { text: '🤖 *Botpoint0* 🤖\n\n!help - Show this help message\n!deleted - Show recently deleted messages\n!status - Show current status settings\n!viewstatus - View recent status updates\n!toggleview - Toggle auto status viewing\n!togglereact - Toggle auto status reactions\n!togglelike - Toggle auto status likes\n!togglemedia - Toggle media saving\n!stats - Show bot statistics\n!about - Show bot information' });
    case 'status': return sock.sendMessage(jid, { text: `📊 *Current Settings* 📊\nAuto View: ${statusSettings.autoView}\nAuto React: ${statusSettings.autoReact}\nAuto Like: ${statusSettings.autoLike}\nSave Media: ${statusSettings.saveMedia}` });
    case 'toggleview': statusSettings.autoView = !statusSettings.autoView; return sock.sendMessage(jid, { text: `🔄 Auto View: ${statusSettings.autoView}` });
    case 'togglereact': statusSettings.autoReact = !statusSettings.autoReact; return sock.sendMessage(jid, { text: `🔄 Auto React: ${statusSettings.autoReact}` });
    case 'togglelike': statusSettings.autoLike = !statusSettings.autoLike; return sock.sendMessage(jid, { text: `🔄 Auto Like: ${statusSettings.autoLike}` });
    case 'togglemedia': statusSettings.saveMedia = !statusSettings.saveMedia; return sock.sendMessage(jid, { text: `🔄 Save Media: ${statusSettings.saveMedia}` });
    case 'deleted': 
      try {
        if (!deletedMessages || !deletedMessages[jid]) return sock.sendMessage(jid, { text: 'No deleted messages found.' });
        const chatMsgs = deletedMessages[jid];
        const keys = Object.keys(chatMsgs);
        if (keys.length === 0) return sock.sendMessage(jid, { text: 'No deleted messages found.' });
        let response = '*Deleted Messages:*\n\n';
        keys.sort((a, b) => chatMsgs[b].deletedAt - chatMsgs[a].deletedAt).slice(0, 5).forEach((k, i) => {
          const m = chatMsgs[k]; const time = new Date(m.timestamp * (m.timestamp < 10000000000 ? 1000 : 1)).toLocaleTimeString();
          response += `${i + 1}. *${m.sender}* (${time}): "${m.content}" ${m.mediaInfo ? '['+m.mediaInfo.type+']' : ''}\n\n`;
        });
        return sock.sendMessage(jid, { text: response });
      } catch (e) { return sock.sendMessage(jid, { text: 'Error.' }); }
    case 'viewstatus': return sock.sendMessage(jid, { text: 'Check local logs for statuses.' });
    case 'stats': return sock.sendMessage(jid, { text: `Bot Uptime: ${formatUptime(process.uptime())}` });
    case 'about': return sock.sendMessage(jid, { text: 'Botpoint0-v1.0.0' });
    default: return null;
  }
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
  return `${d}d ${h}h ${m}m ${s}s`;
}

// ==========================================
// CORE BOT INITIALIZATION
// ==========================================
async function startBot() {
  console.log('=== Initializing WhatsApp Core ===');
  if (isSessionActive) return;
  
  isSessionActive = true;
  botStatus = 'initializing';
  loadDeletedMessages();
  
  const logger = pino({ level: 'info' }); // Quieter logs
  
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: false, 
      browser: Browsers.macOS('Desktop'),
      logger,
      markOnlineOnConnect: true,
      shouldSendReadReceipt: readReceiptSettings.showReadReceipts,
    });
    });
    
    connection = sock;
    sock.ev.removeAllListeners('connection.update');
    
    sock.ev.on('connection.update', async (update) => {
      const { connection: conn, lastDisconnect, qr } = update;
      
      // 1. Capture the QR String for the Web UI
      if (qr) {
        currentQR = qr;
        botStatus = 'qr_ready';
        // Also print to terminal just in case
        qrcodeTerminal.generate(qr, { small: true }); 
      }
      
      // 2. Handle Connection Dropped
      if (conn === 'close') {
        currentQR = null;
        isSessionActive = false;
        botStatus = 'disconnected';
        
        const shouldReconnect = (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log('Connection closed, attempting to reconnect...');
          setTimeout(startBot, 5000);
        } else {
          console.log('Logged out entirely.');
        }
      } 
      
      // 3. Handle Connection Success
      else if (conn === 'open') {
        currentQR = null;
        botStatus = 'connected';
        console.log('=== Bot is now connected! ===');
      }
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('messages.upsert', async ({ messages }) => {
      if (!messages || !Array.isArray(messages)) return;
      for (const message of messages) {
        try {
          if (!message || !message.key) continue;
          if (message.key && message.key.remoteJid) await saveMessage(message.key.remoteJid, message);
          if (message.key.remoteJid === 'status@broadcast') { await handleStatus(sock, message); continue; }
          if (message.messageStubType === 1) { await handleDeletedMessage(sock, message); continue; }
          
          const messageContent = message.message?.conversation || (message.message?.extendedTextMessage && message.message.extendedTextMessage.text) || '';
          if (messageContent.startsWith('!')) await handleCommand(sock, message.key.remoteJid, messageContent, message);
        } catch (error) { console.error('Error processing message:', error); }
      }
    });
    
    return sock;
  } catch (error) {
    console.error('Error in startBot:', error);
    isSessionActive = false;
    currentQR = null;
    botStatus = 'disconnected';
    setTimeout(startBot, 10000);
  }
}

// Graceful Shutdown
process.removeAllListeners('uncaughtException');
process.on('uncaughtException', (err) => { console.error('Uncaught Exception:', err); });
process.on('SIGINT', () => {
  console.log('Shutting down bot...');
  isSessionActive = false;
  if (connection) connection.logout();
  saveDeletedMessages();
  process.exit(0);

});


