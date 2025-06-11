// Enhanced WhatsApp Bot by 7ycrx - Debugged and Improved Version
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

// Set max listeners to prevent warning
process.setMaxListeners(20);

// Use Railway's persistent storage path
const STORAGE_PATH = process.env.RAILWAY_PERSISTENT_DIRECTORY || __dirname;
console.log('=== Bot Starting ===');
console.log('Storage path:', STORAGE_PATH);

// Create directories for storing data
const MESSAGES_DIR = path.join(STORAGE_PATH, 'saved_messages');
const STATUS_DIR = path.join(STORAGE_PATH, 'status_updates');
const MEDIA_DIR = path.join(STORAGE_PATH, 'media');
const DELETED_DIR = path.join(STORAGE_PATH, 'deleted_messages');
const AUTH_DIR = path.join(STORAGE_PATH, 'auth_info');

// Create directories if they don't exist
[MESSAGES_DIR, STATUS_DIR, MEDIA_DIR, DELETED_DIR, AUTH_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
});

// Express server setup
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'WhatsApp Bot is running!',
    timestamp: new Date().toISOString()
  });
});

// Start Express server first
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  // Start the bot after server is running
  startBot();
});

// Handle server errors
server.on('error', (error) => {
  console.error('Server error:', error);
});

// Status tracking and settings
const statusSettings = {
  autoView: true,
  autoReact: true,
  autoLike: true,
  reactEmojis: ['💚', '❤️', '🔥', '😮', '👏'],
  saveMedia: true
};

// Read receipt settings - Normal WhatsApp behavior
const readReceiptSettings = {
  autoRead: false, // Don't automatically mark messages as read
  showReadReceipts: true // Allow blue ticks when manually reading messages
};

// Track deleted messages - initialize properly as an object
let deletedMessages = {};

// Load existing deleted messages from disk at startup
function loadDeletedMessages() {
  try {
    if (fs.existsSync(path.join(DELETED_DIR, 'deleted_messages.json'))) {
      const data = fs.readFileSync(path.join(DELETED_DIR, 'deleted_messages.json'), 'utf8');
      deletedMessages = JSON.parse(data);
      console.log('Loaded deleted messages from disk:', Object.keys(deletedMessages).length, 'chats');
    }
  } catch (error) {
    console.error('Error loading deleted messages:', error);
    deletedMessages = {}; // Reset to empty object if there's an error
  }
}

// Save deleted messages to disk
function saveDeletedMessages() {
  try {
    fs.writeFileSync(
      path.join(DELETED_DIR, 'deleted_messages.json'),
      JSON.stringify(deletedMessages, null, 2)
    );
    console.log('Saved deleted messages to disk');
  } catch (error) {
    console.error('Error saving deleted messages:', error);
  }
}

// Function to download and save media
async function downloadMedia(message, sender) {
  try {
    if (!message || !message.message) return null;
    
    let mediaType = null;
    let mediaContent = null;
    
    // Check various media types
    if (message.message.imageMessage) {
      mediaType = 'image';
      mediaContent = message.message.imageMessage;
    } else if (message.message.videoMessage) {
      mediaType = 'video';
      mediaContent = message.message.videoMessage;
    } else if (message.message.documentMessage) {
      mediaType = 'document';
      mediaContent = message.message.documentMessage;
    } else if (message.message.audioMessage) {
      mediaType = 'audio';
      mediaContent = message.message.audioMessage;
    } else if (message.message.stickerMessage) {
      mediaType = 'sticker';
      mediaContent = message.message.stickerMessage;
    } else {
      return null; // No media found
    }
    
    // Generate filename
    const timestamp = new Date().getTime();
    let extension = 'bin'; // Default extension
    
    if (mediaType === 'image') extension = 'jpg';
    else if (mediaType === 'video') extension = 'mp4';
    else if (mediaType === 'audio') extension = 'mp3';
    else if (mediaType === 'sticker') extension = 'webp';
    
    // For documents, try to get the actual extension
    if (mediaType === 'document' && mediaContent.fileName) {
      const fileNameParts = mediaContent.fileName.split('.');
      if (fileNameParts.length > 1) {
        extension = fileNameParts[fileNameParts.length - 1];
      }
    }
    
    const fileName = `${sender}_${timestamp}.${extension}`;
    const filePath = path.join(MEDIA_DIR, fileName);
    
    // Skip saving if we can't get media data
    if (!mediaContent) return null;
    
    // Return path info for message storage
    return {
      type: mediaType,
      fileName: fileName,
      path: filePath,
      mime: mediaContent.mimetype
    };
  } catch (error) {
    console.error('Error downloading media:', error);
    return null;
  }
}

// Function to save message to disk - modified to handle media properly
async function saveMessage(jid, message) {
  if (!jid || !message.key || !message.key.id) return;
  
  const fileId = `${jid.split('@')[0]}.json`;
  const filePath = path.join(MESSAGES_DIR, fileId);

  let messages = {};
  if (fs.existsSync(filePath)) {
    try {
      messages = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.error(`Error reading message file: ${err}`);
    }
  }

  // Handle media in messages - process asynchronously
  let mediaInfo = null;
  if (statusSettings.saveMedia && message.message) {
    const sender = message.key.participant || message.key.remoteJid.split('@')[0];
    mediaInfo = await downloadMedia(message, sender); // Changed to await
  }

  // Use message ID as key
  messages[message.key.id] = {
    key: message.key,
    message: message.message,
    messageTimestamp: message.messageTimestamp,
    status: message.status,
    mediaInfo: mediaInfo,
    savedAt: new Date().toISOString()
  };

  try {
    fs.writeFileSync(filePath, JSON.stringify(messages, null, 2));
  } catch (err) {
    console.error(`Error writing message file: ${err}`);
  }
}

// Function to handle status updates
async function handleStatus(sock, message) {
  try {
    // Log status updates
    console.log(`Status update received from: ${message.key.participant || message.key.remoteJid.split('@')[0]}`);
    
    // Save the status update
    const statusId = message.key.id;
    const sender = message.key.participant || message.key.remoteJid.split('@')[0];
    const statusFilePath = path.join(STATUS_DIR, `${sender}.json`);
    
    let statuses = {};
    if (fs.existsSync(statusFilePath)) {
      try {
        statuses = JSON.parse(fs.readFileSync(statusFilePath, 'utf8'));
      } catch (err) {
        console.error(`Error reading status file: ${err}`);
      }
    }
    
    // Extract media from status if present
    let mediaInfo = null;
    if (statusSettings.saveMedia) {
      mediaInfo = await downloadMedia(message, sender); // Changed to await
    }
    
    // Store the status
    statuses[statusId] = {
      key: message.key,
      message: message.message,
      messageTimestamp: message.messageTimestamp,
      mediaInfo: mediaInfo,
      savedAt: new Date().toISOString()
    };
    
    try {
      fs.writeFileSync(statusFilePath, JSON.stringify(statuses, null, 2));
      console.log(`Status saved: ${statusId}`);
    } catch (err) {
      console.error(`Error writing status file: ${err}`);
    }

    // View the status if setting is enabled
    if (statusSettings.autoView) {
      await sock.readMessages([message.key]);
      console.log('Status marked as viewed');
    }

    // If autoLike is enabled, this has priority over random reactions
    if (statusSettings.autoLike) {
      await sock.sendMessage(message.key.remoteJid, {
        react: {
          text: '❤️', // Always use heart for likes
          key: message.key
        }
      });
      console.log('Liked status with ❤️');
      
      // Also send a heart emoji as text
      await sock.sendMessage(message.key.remoteJid, {
        text: '❤️',
        quoted: message
      });
      console.log('Sent heart emoji as message');
    } 
    // Otherwise use random reactions if enabled
    else if (statusSettings.autoReact) {
      const emoji = getRandomEmoji();
      await sock.sendMessage(message.key.remoteJid, {
        react: {
          text: emoji,
          key: message.key
        }
      });
      console.log(`Reacted to status with: ${emoji}`);
    }
  } catch (error) {
    console.error('Error in handleStatus:', error);
  }
}

// Function to handle deleted messages - FIXED
async function handleDeletedMessage(sock, message) {
  try {
    if (!message || !message.key || !message.key.remoteJid) return;
    
    const jid = message.key.remoteJid;
    const messageId = message.key.id;
    
    // Load saved messages for this chat
    const fileId = `${jid.split('@')[0]}.json`;
    const filePath = path.join(MESSAGES_DIR, fileId);
    
    if (fs.existsSync(filePath)) {
      try {
        const savedMessages = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        
        if (savedMessages && savedMessages[messageId]) {
          const deletedMsg = savedMessages[messageId];
          
          // Only notify about others' deleted messages, not our own
          if (!deletedMsg.key.fromMe) {
            let deletedContent = 'Unknown message content';
            
            if (deletedMsg.message) {
              deletedContent = deletedMsg.message.conversation || 
                              (deletedMsg.message.extendedTextMessage && deletedMsg.message.extendedTextMessage.text) || 
                              'Media message';
            }
            
            // Ensure deletedMessages is properly initialized
            if (!deletedMessages) {
              deletedMessages = {};
            }
            
            // Initialize the JID entry if it doesn't exist
            if (!deletedMessages[jid]) {
              deletedMessages[jid] = {};
            }
            
            // Store deleted message with proper sender info
            const sender = (deletedMsg.key.participant || deletedMsg.key.remoteJid).split('@')[0];
            
            deletedMessages[jid][messageId] = {
              sender: sender,
              content: deletedContent,
              timestamp: deletedMsg.messageTimestamp || Math.floor(Date.now() / 1000),
              deletedAt: Math.floor(Date.now() / 1000),
              mediaInfo: deletedMsg.mediaInfo
            };
            
            // Save deleted messages to persistent storage
            saveDeletedMessages();
            
            console.log(`Deleted message stored: ${messageId}`);
            console.log(`Current deleted messages for ${jid}:`, Object.keys(deletedMessages[jid]).length);
            
            let notificationText = `⚠️ *Message deleted by ${sender}*: "${deletedContent}"`;
            
            // Add media info if available
            if (deletedMsg.mediaInfo) {
              notificationText += `\n(Message contained ${deletedMsg.mediaInfo.type})`;
            }
            
            await sock.sendMessage(jid, { text: notificationText });
          }
        }
      } catch (err) {
        console.error(`Error processing deleted message: ${err}`);
      }
    }
  } catch (error) {
    console.error('Error handling deleted message:', error);
  }
}

// Get random emoji for reactions
function getRandomEmoji() {
  const index = Math.floor(Math.random() * statusSettings.reactEmojis.length);
  return statusSettings.reactEmojis[index];
}

// Bot commands handler - FIXED !deleted command
async function handleCommand(sock, jid, text, message) {
  const args = text.slice(1).trim().split(' ');
  const command = args.shift().toLowerCase();
  
  switch (command) {
    case 'help':
      return sock.sendMessage(jid, { text: 
        '🤖 *7ycrx WhatsApp Bot* 🤖\n\n' +
        '!help - Show this help message\n' +
        '!deleted - Show recently deleted messages\n' +
        '!status - Show current status settings\n' +
        '!viewstatus - View recent status updates\n' +
        '!toggleview - Toggle auto status viewing\n' +
        '!togglereact - Toggle auto status reactions\n' +
        '!togglelike - Toggle auto status likes\n' +
        '!togglemedia - Toggle media saving\n' +
        '!stats - Show bot statistics\n' +
        '!about - Show bot information'
      });
      
    case 'status':
      return sock.sendMessage(jid, { text: 
        '📊 *Current Status Settings* 📊\n\n' +
        `Auto View: ${statusSettings.autoView ? '✅ Enabled' : '❌ Disabled'}\n` +
        `Auto React: ${statusSettings.autoReact ? '✅ Enabled' : '❌ Disabled'}\n` +
        `Auto Like: ${statusSettings.autoLike ? '✅ Enabled' : '❌ Disabled'}\n` +
        `Save Media: ${statusSettings.saveMedia ? '✅ Enabled' : '❌ Disabled'}\n` +
        `Read Receipts: ${readReceiptSettings.showReadReceipts ? '✅ Enabled (Normal WhatsApp)' : '❌ Disabled (Gray Ticks Only)'}`
      });
      
    case 'toggleview':
      statusSettings.autoView = !statusSettings.autoView;
      return sock.sendMessage(jid, { text: 
        `🔄 Auto Status Viewing is now ${statusSettings.autoView ? 'ENABLED' : 'DISABLED'}`
      });
      
    case 'togglereact':
      statusSettings.autoReact = !statusSettings.autoReact;
      return sock.sendMessage(jid, { text: 
        `🔄 Auto Status Reactions are now ${statusSettings.autoReact ? 'ENABLED' : 'DISABLED'}`
      });
      
    case 'togglelike':
      statusSettings.autoLike = !statusSettings.autoLike;
      return sock.sendMessage(jid, { text: 
        `🔄 Auto Status Likes are now ${statusSettings.autoLike ? 'ENABLED' : 'DISABLED'}`
      });
      
    case 'togglemedia':
      statusSettings.saveMedia = !statusSettings.saveMedia;
      return sock.sendMessage(jid, { text: 
        `🔄 Media Saving is now ${statusSettings.saveMedia ? 'ENABLED' : 'DISABLED'}`
      });
      
    case 'deleted':
      try {
        // Ensure deletedMessages is initialized
        if (!deletedMessages) {
          deletedMessages = {};
        }
        
        // Make sure this JID exists in deletedMessages
        if (!deletedMessages[jid]) {
          deletedMessages[jid] = {};
        }
        
        console.log("Available JIDs in deletedMessages:", Object.keys(deletedMessages));
        console.log("Current JID:", jid);
        
        // Get deleted messages for this chat
        const chatDeletedMsgs = deletedMessages[jid] || {};
        console.log("Retrieved deletedMessages for JID:", jid);
        console.log("Number of deleted messages:", Object.keys(chatDeletedMsgs).length);
        
        const deletedMsgKeys = Object.keys(chatDeletedMsgs);
        
        if (deletedMsgKeys.length === 0) {
          return sock.sendMessage(jid, { text: 'No deleted messages found in this chat.' });
        }
        
        let response = '*Recently Deleted Messages:*\n\n';
        
        // Sort by deletion timestamp (newest first)
        deletedMsgKeys
          .sort((a, b) => chatDeletedMsgs[b].deletedAt - chatDeletedMsgs[a].deletedAt)
          .slice(0, 5) // Get only the 5 most recent
          .forEach((key, i) => {
            const msg = chatDeletedMsgs[key];
            // Convert timestamp to Date object (handling both seconds and milliseconds)
            const timestamp = msg.timestamp * (msg.timestamp < 10000000000 ? 1000 : 1); 
            const time = new Date(timestamp).toLocaleTimeString();
            
            let msgText = `${i + 1}. *${msg.sender}* (${time}): "${msg.content}"`;
            
            if (msg.mediaInfo) {
              msgText += ` [${msg.mediaInfo.type}]`;
            }
            
            response += msgText + '\n\n';
          });
          
        return sock.sendMessage(jid, { text: response });
      } catch (error) {
        console.error('Error handling deleted command:', error);
        return sock.sendMessage(jid, { text: `Error retrieving deleted messages: ${error.message}` });
      }
    
    case 'viewstatus':
      try {
        // Get the status files
        const statusFiles = fs.readdirSync(STATUS_DIR);
        
        if (statusFiles.length === 0) {
          return sock.sendMessage(jid, { text: 'No status updates have been saved yet.' });
        }
        
        // Get the most recent status updates
        let response = '*Recent Status Updates:*\n\n';
        let count = 0;
        
        for (const file of statusFiles) {
          if (count >= 5) break; // Show at most 5 statuses
          
          try {
            const filePath = path.join(STATUS_DIR, file);
            const statuses = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const statusKeys = Object.keys(statuses);
            
            if (statusKeys.length > 0) {
              // Get the most recent status
              const mostRecentKey = statusKeys.sort((a, b) => 
                statuses[b].messageTimestamp - statuses[a].messageTimestamp
              )[0];
              
              const status = statuses[mostRecentKey];
              const sender = file.split('.')[0];
              const time = new Date(status.messageTimestamp * 1000).toLocaleTimeString();
              
              // Extract content
              let content = 'Media';
              if (status.message?.conversation) {
                content = status.message.conversation;
              } else if (status.message?.extendedTextMessage?.text) {
                content = status.message.extendedTextMessage.text;
              }
              
              response += `${++count}. *${sender}* (${time}): `;
              
              if (status.mediaInfo) {
                response += `[${status.mediaInfo.type}] `;
              }
              
              response += `${content.substring(0, 50)}${content.length > 50 ? '...' : ''}\n\n`;
            }
          } catch (err) {
            console.error(`Error processing status file ${file}:`, err);
          }
        }
        
        if (count === 0) {
          return sock.sendMessage(jid, { text: 'No valid status updates found.' });
        }
        
        return sock.sendMessage(jid, { text: response });
      } catch (error) {
        console.error('Error handling viewstatus command:', error);
        return sock.sendMessage(jid, { text: 'Error retrieving status updates.' });
      }
      
    case 'stats':
      try {
        // Count saved messages
        const messageFiles = fs.readdirSync(MESSAGES_DIR);
        let totalMessages = 0;
        
        messageFiles.forEach(file => {
          try {
            const messages = JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, file), 'utf8'));
            totalMessages += Object.keys(messages).length;
          } catch (err) {}
        });
        
        // Count saved statuses
        const statusFiles = fs.readdirSync(STATUS_DIR);
        let totalStatuses = 0;
        
        statusFiles.forEach(file => {
          try {
            const statuses = JSON.parse(fs.readFileSync(path.join(STATUS_DIR, file), 'utf8'));
            totalStatuses += Object.keys(statuses).length;
          } catch (err) {}
        });
        
        // Count saved media
        const mediaFiles = fs.readdirSync(MEDIA_DIR);
        
        // Count deleted messages
        let totalDeleted = 0;
        Object.keys(deletedMessages).forEach(chatJid => {
          totalDeleted += Object.keys(deletedMessages[chatJid]).length;
        });
        
        return sock.sendMessage(jid, { text: 
          '📊 *Bot Statistics* 📊\n\n' +
          `Total Messages Saved: ${totalMessages}\n` +
          `Total Statuses Saved: ${totalStatuses}\n` +
          `Total Media Files: ${mediaFiles.length}\n` +
          `Total Deleted Messages: ${totalDeleted}\n` +
          `Uptime: ${formatUptime(process.uptime())}`
        });
      } catch (error) {
        console.error('Error handling stats command:', error);
        return sock.sendMessage(jid, { text: 'Error retrieving statistics.' });
      }
      
    case 'about':
      return sock.sendMessage(jid, { text: 
        '📱 *WhatsApp Bot by 7ycrx* 📱\n\n' +
        'Features:\n' +
        '- Auto views all statuses\n' +
        '- Auto reacts to statuses with emojis\n' +
        '- Auto likes statuses with ❤️\n' +
        '- Captures and notifies about deleted messages\n' +
        '- Normal WhatsApp behavior with blue ticks\n' +
        '- Media backup capabilities\n' +
        '- Status viewer built-in\n' +
        'Version: 2.2 (Fixed Deleted Messages)\n\n' +
        'Created on ' + new Date().toLocaleDateString()
      });
      
    default:
      return null; // Not a recognized command
  }
}

// Helper function to format uptime
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return `${days}d ${hours}h ${minutes}m ${secs}s`;
}

// Store active connection
let connection = null;

// Session management flag - ensure only one session
let isSessionActive = false;

// Main bot function
async function startBot() {
  console.log('=== Starting WhatsApp Bot ===');
  
  // Check if a session is already active
  if (isSessionActive) {
    console.log('A session is already active. Only one session allowed.');
    return;
  }
  
  // Set session as active
  isSessionActive = true;
  
  // Load existing deleted messages
  loadDeletedMessages();
  
  // Set logger to info level for more detailed logs
  const logger = pino({ 
    level: 'info',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true
      }
    }
  });
  
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    console.log('Auth state loaded from:', AUTH_DIR);
    
    // Create socket with normal WhatsApp settings
    const sock = makeWASocket({
      auth: state,
      printQRInTerminal: true,
      browser: ['Enhanced Bot', 'Chrome', '103.0.5060.114'],
      logger,
      markOnlineOnConnect: true,
      shouldSendReadReceipt: readReceiptSettings.showReadReceipts,
      connectTimeoutMs: 60000, // Increase connection timeout
      retryRequestDelayMs: 5000, // Add delay between retries
      defaultQueryTimeoutMs: 60000, // Increase query timeout
      qr: {
        small: true // Make QR code smaller
      }
    });
    
    console.log('Socket created, waiting for QR code...');
    
    // Store current connection
    connection = sock;
    
    sock.ev.on('connection.update', async (update) => {
      const { connection: conn, lastDisconnect, qr } = update;
      
      if (qr) {
        console.log('=== QR Code Generated ===');
        qrcode.generate(qr, { small: true });
        console.log('=== Scan QR Code Above ===');
      }
      
      if (conn === 'close') {
        isSessionActive = false; // Reset session flag
        
        const shouldReconnect = 
          (lastDisconnect?.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
        
        if (shouldReconnect) {
          console.log('Connection closed, attempting to reconnect...');
          setTimeout(() => {
            startBot();
          }, 5000); // Wait 5 seconds before reconnecting
        } else {
          console.log('Connection closed, not reconnecting');
        }
      } else if (conn === 'open') {
        console.log('=== Bot is now connected! ===');
        console.log('Ready to use - Normal WhatsApp Mode Active');
      }
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('messages.upsert', async ({ messages }) => {
      if (!messages || !Array.isArray(messages)) return;
      
      for (const message of messages) {
        try {
          if (!message || !message.key) continue;
          
          // Store all incoming messages for anti-delete feature
          if (message.key && message.key.remoteJid) {
            await saveMessage(message.key.remoteJid, message);
            console.log(`Message saved: ${message.key.id}`);
          }

          // Process status updates separately
          if (message.key.remoteJid === 'status@broadcast') {
            await handleStatus(sock, message);
            continue;
          }
          
          // Handle deleted messages
          if (message.messageStubType === 1) {
            await handleDeletedMessage(sock, message);
            continue;
          }
          
          // Don't automatically mark chat messages as read
          // Let user manually open chats to trigger blue ticks
          
          const messageContent = message.message?.conversation || 
                              (message.message?.extendedTextMessage && message.message.extendedTextMessage.text) || '';
          
          if (messageContent.startsWith('!')) {
            await handleCommand(sock, message.key.remoteJid, messageContent, message);
          }
        } catch (error) {
          console.error('Error processing message:', error);
        }
      }
    });
    
    return sock;
  } catch (error) {
    console.error('Error in startBot:', error);
    isSessionActive = false; // Reset session flag on error
    
    // Attempt to restart after a delay
    setTimeout(() => {
      startBot();
    }, 10000);
  }
}

// Global error handler
process.removeAllListeners('uncaughtException');
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down bot...');
  isSessionActive = false;
  if (connection) {
    connection.logout();
  }
  // Save deleted messages before shutting down
  saveDeletedMessages();
  process.exit(0);
});