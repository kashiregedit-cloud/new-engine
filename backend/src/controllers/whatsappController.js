const whatsappService = require('../services/whatsappService');
const aiService = require('../services/aiService');
const dbService = require('../services/dbService');
const fs = require('fs');
const path = require('path');

function logDebug(msg) {
    try {
        const logDir = path.join(__dirname, '../../logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        
        fs.appendFileSync(path.join(logDir, 'whatsapp.log'), new Date().toISOString() + ' [WA] ' + msg + '\n');
    } catch (e) {
        console.error("Failed to write debug log:", e);
    }
}

// Helper to log to file
function logToFile(message) {
    logDebug(message);
}

// Global Debounce Map (In-Memory)
// Key: sessionId (session_chatId)
const debounceMap = new Map();
// Last user message guard (avoid reprocessing identical short texts)
const lastUserMessageMap = new Map();
// Admin handover map (stop AI after admin label or intervention)
const handoverMap = new Map();
// Session Start Time Map (for n8n-style backlog filtering)
const sessionStartTimeMap = new Map();
// In-memory duplicate check (faster than DB)
const recentMessageIds = new Set();
// Bot Message IDs (to distinguish Bot vs Admin replies)
const botMessageIds = new Set();
// Recent Bot Replies (Text-based Echo Guard)
const recentBotReplies = new Map(); // Key: recipientId, Value: { text, timestamp }

// Helper to normalize text for comparison
const normalizeText = (text) => {
    // Remove all whitespace and special characters to ensure robust matching
    return (text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
};

// Step 1: Webhook Trigger
const handleWebhook = async (req, res) => {
    logDebug("Webhook Hit!");
    const body = req.body;
    // console.log('WAHA Webhook:', JSON.stringify(body, null, 2));

    // WAHA sends different events. We care about 'message' or 'message.any'
    const event = body.event;
    const session = body.session; // This acts as 'session_name'
    const payload = body.payload;

    if (!session || !payload) {
        return res.sendStatus(400);
    }

    // NORMALIZE MESSAGE ID (Critical for Upsert & Duplicate Check)
    // WAHA sometimes returns id as object { fromMe: ..., remote: ..., id: ..., _serialized: ... }
    // We ALWAYS want the string version (_serialized)
    let messageIdRaw = payload.id;
    if (typeof messageIdRaw === 'object' && messageIdRaw !== null) {
        messageIdRaw = messageIdRaw._serialized || messageIdRaw.id; // Fallback
    }
    
    // [DEBUG] Log fromMe status
    // console.log(`[WA Debug] Message ${messageIdRaw} - fromMe: ${payload.fromMe}`);
    // Update payload.id to be the string version for downstream consistency
    if (payload.id && typeof payload.id === 'object') {
        payload.id = messageIdRaw;
    }

    // Acknowledge immediately
    res.send('OK');

    if (event === 'message' || event === 'message.any') {
        // --- n8n-style Backlog Filtering ---
        // 1. Establish Baseline (Processing Start Time) for this session
        if (!sessionStartTimeMap.has(session)) {
            // Check for x-webhook-timestamp header (if available from WAHA/Reverse Proxy)
            // Otherwise default to current server time
            const headerTime = req.headers['x-webhook-timestamp'];
            const startTime = headerTime ? Math.floor(Number(headerTime) / 1000) : Math.floor(Date.now() / 1000);
            sessionStartTimeMap.set(session, startTime);
            console.log(`[WA] Session ${session} connected. Baseline Time: ${startTime}`);
        }

        const msgTimestamp = payload.timestamp || Math.floor(Date.now() / 1000);
        const baselineTime = sessionStartTimeMap.get(session);

        // 2. Filter Backlog Messages (Sent BEFORE we started processing)
        // Add small buffer (e.g. 10 seconds) to allow for slight clock skew if using server time
        // If msgTimestamp < baselineTime, it's old.
        if (msgTimestamp < baselineTime) {
            console.log(`[WA] Ignoring BACKLOG message from ${payload.from}. MsgTime: ${msgTimestamp}, Baseline: ${baselineTime}`);
            return;
        }
        // -----------------------------------

    // --- IGNORE @lid (Linked Devices / Internal) ---
    // User Update: Removed per user instruction "eta wpp r number system".
    // Previously blocked 124532744531973@lid, but user says this blocks legitimate replies.
    // if (payload.from && payload.from.includes('@lid')) {
    //    console.log(`[WA] Ignoring @lid message (Internal/Linked Device): ${payload.from}`);
    //    return;
    // }
    // -----------------------------------------------

    // --- HANDLE ADMIN/BOT MESSAGES (fromMe) ---
        if (payload.fromMe) {
            // Check if this is a BOT message we just sent (ID Match)
            // Uses Normalized ID
            // [DEBUG] Log IDs to debug the mismatch issue
            console.log(`[WA Debug] Checking fromMe ID: ${messageIdRaw}. BotIDs count: ${botMessageIds.size}`);

            // 1. Strict ID Match (Fastest)
            if (botMessageIds.has(messageIdRaw)) {
                console.log(`[WA] Ignoring fromMe message (BotID Match): ${messageIdRaw}`);
                botMessageIds.delete(messageIdRaw);
                return;
            }

            // 2. Exception for @lid (Linked Devices)
            // User Request: Allow bot to reply to messages sent from Linked Devices (@lid)
            // These come with fromMe=true, but we must treat them as User Messages.
            if (payload.from && payload.from.includes('@lid')) {
                console.log(`[WA] @lid message detected with fromMe=true. Treating as User Message.`);
                // Proceed to queueMessage (Skip Admin Logic)
            } else {
                // 3. Text-Based Echo Guard (In-Memory)
                const recipient = payload.to;
                const recentReply = recentBotReplies.get(recipient);
                if (recentReply) {
                    const timeDiff = Date.now() - recentReply.timestamp;
                    // 10 Seconds Window for Echo
                    if (timeDiff < 10000) { 
                        // Compare Text (Simple Include or Exact Match)
                        // Update: Use Normalize for Robustness
                        const incomingText = (payload.body || '').trim();
                        const normalizedIncoming = normalizeText(incomingText);
                        const normalizedStored = recentReply.text; // Stored as normalized

                        const isMatch = normalizedIncoming === normalizedStored || normalizedIncoming.includes(normalizedStored) || normalizedStored.includes(normalizedIncoming);
                        
                        if (isMatch) {
                            console.log(`[WA] Ignoring fromMe message (Text Match): "${incomingText.substring(0,30)}..."`);
                            return;
                        }
                    }
                }

                // 4. TERTIARY CHECK: DB-Based Echo Guard (3s Wait + 20 Msg Check)
                // User Instruction: Wait 3s, then check last 20 messages in DB for 100% match from 'bot'
                const targetRecipient = payload.to;
                const targetBody = normalizeText(payload.body);
                
                // Wait 3 seconds to ensure any concurrent bot reply is saved to DB via its own flow
                await new Promise(resolve => setTimeout(resolve, 3000));

                try {
                    // Fetch last 20 messages from DB
                    const lastMessages = await dbService.getLastNWhatsAppMessages(session, targetRecipient, 20);
                    
                    // Check if ANY of them match our current message AND were sent by 'bot'
                    const isEcho = lastMessages.some(msg => {
                        if (msg.reply_by !== 'bot') return false;
                        const dbBody = normalizeText(msg.text);
                        const match = dbBody === targetBody;
                        if (match) {
                            console.log(`[WA Debug] Echo Match Found! DB: "${msg.text}" vs Incoming: "${payload.body}"`);
                        }
                        return match; // 100% Match
                    });

                    if (isEcho) {
                        console.log(`[WA] Ignoring fromMe message (DB Echo Match): "${targetBody.substring(0, 30)}..."`);
                        return;
                    } else {
                        console.log(`[WA Debug] Echo Check Failed. Incoming: "${targetBody}". Last 5 DB: ${lastMessages.slice(0, 5).map(m => m.reply_by + ':' + normalizeText(m.text)).join(' | ')}`);
                    }
                } catch (err) {
                    console.warn(`[WA] DB Echo check failed: ${err.message}`);
                }

                // 5. Fallback: If still not identified as bot, assume Admin
                
                const messageText = payload.body || '';
                const sessionName = session;
                
                // In-memory duplicate check
                if (recentMessageIds.has(messageIdRaw)) return;
                recentMessageIds.add(messageIdRaw);
                setTimeout(() => recentMessageIds.delete(messageIdRaw), 10 * 60 * 1000); // Clear after 10 mins

                const isDuplicate = await dbService.checkWhatsAppDuplicate(messageIdRaw);
                if (!isDuplicate) {
                    // Prevent saving empty messages (avoids blank rows in UI)
                    // Check for Reactions, Protocol messages, etc.
                    const msgType = payload.type || payload.subtype || 'chat';
                    if (['reaction', 'e2e_notification', 'protocol', 'ciphertext', 'revoked'].includes(msgType)) {
                        console.log(`[WA] Ignoring Admin message of type: ${msgType}`);
                        return;
                    }

                    const hasText = messageText && messageText.trim().length > 0;
                    const hasMedia = payload.hasMedia || (payload.media && Object.keys(payload.media).length > 0) || (payload._data && (payload._data.jpegThumbnail || payload._data.thumbnail));

                    if (!hasText && !hasMedia) {
                        console.log('[WA] Ignoring empty Admin message (no text/media).');
                        return;
                    }
                    
                    const textToSave = messageText.trim() || '[Media Sent]';
                    
                    console.log(`[WA] Saving ADMIN message (fromMe): ${textToSave.substring(0,30)}...`);
                    
                    await dbService.saveWhatsAppChat({
                        session_name: sessionName,
                        sender_id: sessionName, // Admin is the sender (Session Name/Page Number)
                        recipient_id: payload.to, // User is the recipient
                        message_id: messageIdRaw,
                        text: textToSave,
                        timestamp: Date.now(),
                        status: 'sent',
                        reply_by: 'admin' // Trigger stop logic
                    });

                    // --- EMOJI HANDOVER LOGIC (Admin) ---
                    // Fetch Config for Dynamic Emojis
                    let LOCK_EMOJIS = ['🛑', '🔒', '⛔'];
                    let UNLOCK_EMOJIS = ['🟢', '🔓', '✅'];
                    
                    try {
                        const config = await dbService.getWhatsAppConfig(sessionName);
                        if (config) {
                            if (config.lock_emojis && config.lock_emojis.trim()) {
                                LOCK_EMOJIS = config.lock_emojis.split(',').map(e => e.trim()).filter(e => e);
                            }
                            if (config.unlock_emojis && config.unlock_emojis.trim()) {
                                UNLOCK_EMOJIS = config.unlock_emojis.split(',').map(e => e.trim()).filter(e => e);
                            }
                        }
                    } catch (e) {
                        console.warn(`[WA] Failed to fetch config for emoji check: ${e.message}`);
                    }
                    
                    let command = null;
                    // Check if textToSave contains any of the emojis
                    for (const e of LOCK_EMOJIS) if (textToSave.includes(e)) command = 'LOCK';
                    for (const e of UNLOCK_EMOJIS) if (textToSave.includes(e)) command = 'UNLOCK';
                    
                    if (command) {
                        const isLocked = command === 'LOCK';
                        console.log(`[WA] Emoji Command Detected (${command}) from Admin. Updating Lock Status...`);
                        
                        // Use payload.to (User's Phone Number) for the lock
                        const targetUser = payload.to; 
                        await dbService.toggleWhatsAppLock(sessionName, targetUser, isLocked);
                        
                        // Update Memory Map
                        const chatKey = `${sessionName}_${targetUser}`;
                        if (isLocked) {
                            handoverMap.set(chatKey, Date.now() + 24 * 60 * 60 * 1000); // 24h Lock
                        } else {
                            handoverMap.delete(chatKey);
                        }
                    } else {
                        // Default Handover (5 mins) if no command
                        const chatKey = `${sessionName}_${payload.to || payload.chatId || 'unknown'}`;
                        handoverMap.set(chatKey, Date.now() + 5 * 60 * 1000);
                    }
                }
                return; // STOP Processing
            }
        }

        // Ignore Status Updates (broadcasts)
        if (payload.from === 'status@broadcast') return;

        // --- TIMESTAMP CHECK (Ignore Old Messages > 2 Mins) ---
        // Keeps the "Realtime" sanity check even if baseline was set long ago
        const nowSeconds = Math.floor(Date.now() / 1000);
        const ageSeconds = nowSeconds - msgTimestamp;
        
        if (ageSeconds > 120) { // 2 Minutes Tolerance
            console.log(`[WA] Ignoring old message from ${payload.from}. Age: ${ageSeconds}s`);
            return;
        }
        // -----------------------------------------------------

        await queueMessage(session, payload);
    } else if (event === 'state.change') {
        // Handle State Changes (WORKING, STOPPED, SCAN_QR_CODE, etc.)
        const status = payload.body || payload.status; // WAHA payload format varies
        console.log(`[WA Webhook] State Change for ${session}: ${status}`);
        
        let dbStatus = 'unknown';
        let isActive = false;

        if (status === 'WORKING') {
            dbStatus = 'working';
            isActive = true;
        } else if (status === 'STOPPED') {
            dbStatus = 'stopped';
            isActive = false;
        } else if (status === 'SCAN_QR_CODE' || status === 'SCAN_QR') {
            dbStatus = 'scan_qr_code';
            isActive = false;
        } else {
            dbStatus = (status || 'unknown').toLowerCase();
        }

        try {
            await dbService.updateWhatsAppEntryByName(session, {
                status: dbStatus,
                active: isActive
            });
            console.log(`[WA Webhook] DB Updated for ${session} -> Status: ${dbStatus}, Active: ${isActive}`);
        } catch (err) {
            console.error(`[WA Webhook] Failed to update DB status for ${session}:`, err.message);
        }
    } else if (event && String(event).toLowerCase().includes('label')) {
        // Admin updated labels in WAHA UI -> treat as human handover
        const sessionName = session;
        const chatKey = `${sessionName}_${payload?.chatId || payload?.to || 'unknown'}`;
        handoverMap.set(chatKey, Date.now() + 5 * 60 * 1000);
        try {
            await dbService.saveWhatsAppChat({
                session_name: sessionName,
                sender_id: sessionName,
                recipient_id: payload?.chatId || payload?.to || 'unknown',
                message_id: `label_${Date.now()}`,
                text: `[SYSTEM] Admin label changed. AI paused for this chat.`,
                timestamp: Date.now(),
                status: 'system_notice',
                reply_by: 'admin'
            });
        } catch (e) {}
    }
};

// Queue Message for Debounce
async function queueMessage(session, messagePayload) {
    let senderId = messagePayload.from; // e.g., 12345678@c.us
    
    // Fix for Linked Devices (@lid)
    // User Update: Do NOT convert @lid to @c.us. Use as is.
    if (senderId && senderId.includes('@lid')) {
        console.log(`[WA] Processing message from Linked Device (@lid): ${senderId}`);
    }

    const sessionName = session; // Using WAHA Session as Session Name
    let messageText = messagePayload.body || '';
    
    // Normalized ID
    let messageId = messagePayload.id;
    if (typeof messageId === 'object' && messageId !== null) {
        messageId = messageId._serialized || messageId.id;
    }

    const isGroup = typeof senderId === 'string' && senderId.includes('@g.us');
    const groupId = messagePayload.chatId || (isGroup ? senderId : null);
    const groupName = messagePayload.chatName || null;

    const logMsg = `[WA Webhook] Received Message. Session: ${sessionName}, Sender: ${senderId}, Text: "${messageText.substring(0, 50)}..."`;
    console.log(logMsg);
    logToFile(logMsg);

    // --- SAVE USER MESSAGE TO whatsapp_chats (Immediate - Raw) ---
    // User Requirement: Save User Messages even if Locked
    try {
        await dbService.saveWhatsAppChat({
            session_name: sessionName,
            sender_id: senderId, // User is the sender (Phone Number)
            recipient_id: messagePayload.to, // Page is the recipient (Page Number)
            message_id: messageId,
            text: messageText,
            timestamp: Date.now(),
            status: 'received',
            reply_by: 'user',
            is_group: isGroup,
            group_id: groupId,
            group_name: groupName
        });
        
        // Save Contact/Lead
        const pushName = messagePayload._data?.notifyName || messagePayload.pushName || 'Unknown';
        await dbService.saveWhatsAppContact({
            session_name: sessionName,
            phone_number: senderId,
            name: pushName
        });

    } catch (err) {
        console.error("Error saving to whatsapp_chats:", err.message);
    }

    // Handover guard: if admin takeover active for this chat, skip
    const chatKey = `${sessionName}_${senderId}`;
    
    // 1. Check Memory (Fast) - for temporary pauses after admin reply
    const handoverUntil = handoverMap.get(chatKey);
    if (handoverUntil && handoverUntil > Date.now()) {
        console.log(`[WA] Handover active (Memory) for ${chatKey}. Skipping AI.`);
        return;
    } else if (handoverUntil && handoverUntil <= Date.now()) {
        handoverMap.delete(chatKey);
    }

    // 2. Check DB (Persistent Lock) - for manual Lock/Unlock
    try {
        const contact = await dbService.getWhatsAppContact(sessionName, senderId);
        if (contact && contact.is_locked) {
            console.log(`[WA] Handover active (DB Lock) for ${chatKey}. Skipping AI.`);
            return;
        }
    } catch (err) {
        console.warn(`[WA] Failed to check lock status: ${err.message}`);
    }

    const sessionId = `${sessionName}_${senderId}`;

    // Initialize buffer if not exists
    if (!debounceMap.has(sessionId)) {
        debounceMap.set(sessionId, { messages: [], timer: null, pageId: messagePayload.to });
    }

    const sessionData = debounceMap.get(sessionId);
    
    // --- EXTRACT MEDIA (Fix for ReferenceError) ---
    const imageUrls = [];
    const audioUrls = [];

    if (messagePayload.mediaUrl) {
        const mime = messagePayload.mimetype || '';
        if (mime.startsWith('image/')) imageUrls.push(messagePayload.mediaUrl);
        else if (mime.startsWith('audio/') || mime.includes('audio') || messagePayload.type === 'ptt') audioUrls.push(messagePayload.mediaUrl);
    } else if (messagePayload.hasMedia && messagePayload.body && messagePayload.body.startsWith('http')) {
        // Fallback: If body contains URL and hasMedia is true
        if (messagePayload.type === 'image') imageUrls.push(messagePayload.body);
        else if (messagePayload.type === 'ptt' || messagePayload.type === 'audio') audioUrls.push(messagePayload.body);
    }
    // ---------------------------------------------
    
    // Push Object
    // Extract Quoted Message Data (Lightweight System - Webhook Data)
    let quotedContent = null;
    try {
        // Search in multiple possible locations
        const q = messagePayload._data?.quotedMsg || messagePayload.quotedMsg || messagePayload._data?.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        
        if (q) {
            if (q.body) quotedContent = q.body; // Standard Text
            else if (q.caption) quotedContent = q.caption; // Image/Video with caption
            else if (q.conversation) quotedContent = q.conversation; // Direct conversation text (some payloads)
            else if (q.type === 'ptt' || q.type === 'audio') quotedContent = '[Voice Message]';
            else if (q.type === 'image') quotedContent = '[Image Message]';
            else if (q.type === 'sticker') quotedContent = '[Sticker]';
            else if (q.type === 'video') quotedContent = '[Video Message]';
            // Deep nested text check
            else if (q.extendedTextMessage && q.extendedTextMessage.text) quotedContent = q.extendedTextMessage.text;
        } 
        
        // Fallback to standard replyTo object
        if (!quotedContent && messagePayload.replyTo && messagePayload.replyTo.body) {
             quotedContent = messagePayload.replyTo.body;
        }
        
        if (quotedContent) {
            logDebug(`[WA] Extracted Quoted Content: "${quotedContent.substring(0,30)}..."`);
        }
    } catch (e) {
        console.error('[WA] Failed to extract quoted content:', e);
    }

    sessionData.messages.push({
        id: messageId,
        text: messageText,
        reply_to: messagePayload.replyTo?.id || null, // WAHA reply info
        quoted_text: quotedContent, // <-- NEW: Store quoted text from webhook
        images: imageUrls,
        audios: audioUrls
    });

    console.log(`[WA] Queued message for ${sessionId}. Buffer size: ${sessionData.messages.length}`);
    
    if (sessionData.timer) {
        clearTimeout(sessionData.timer);
    }

    // Dynamic Debounce from Config
    const config = await dbService.getWhatsAppConfig(sessionName);
    let debounceTime = 8000; // Default 8s
    if (config && config.wait) {
        debounceTime = Number(config.wait) * 1000;
    }
    if (debounceTime < 1000) debounceTime = 1000;

    sessionData.timer = setTimeout(() => {
        const messagesToProcess = [...sessionData.messages];
        const pageId = sessionData.pageId;
        debounceMap.delete(sessionId);
        processBufferedMessages(sessionId, sessionName, senderId, messagesToProcess, pageId);
    }, debounceTime); 
}

// Core Logic Function (Debounced)
async function processBufferedMessages(sessionId, sessionName, senderId, messages, pageId = null) {
    let replyToTextFallback = null;
    let combinedText = "";
    let replyToId = null;
    let allImages = [];
    let allAudios = [];
    const isGroup = typeof senderId === 'string' && senderId.includes('@g.us');

    // Handover guard (Memory) - Late Check (Race Condition Fix)
    // User Scenario: Admin replies during the buffer delay. We must catch it here.
    const chatKey = `${sessionName}_${senderId}`;
    const handoverUntil = handoverMap.get(chatKey);
    if (handoverUntil && handoverUntil > Date.now()) {
        console.log(`[WA] Handover active (Memory - Late Check) for ${chatKey}. Skipping AI.`);
        return;
    }

    for (const msg of messages) {
        if (msg.text) combinedText += msg.text + "\n";
        if (msg.reply_to) {
            replyToId = msg.reply_to; 
            if (msg.quoted_text) replyToTextFallback = msg.quoted_text;
        }
        if (msg.images && msg.images.length > 0) allImages.push(...msg.images);
        if (msg.audios && msg.audios.length > 0) allAudios.push(...msg.audios);
    }
    // Remove duplicate lines (n8n-style filter)
    combinedText = combinedText
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
        .filter((val, idx, arr) => arr.indexOf(val) === idx)
        .join('\n')
        .trim();
    console.log(`[WA] Processing buffered. Text: ${combinedText.substring(0,50)}...`);

    // If this is a swipe-reply, fetch quoted message text by ID for context
    if (replyToId) {
        logDebug(`[Swipe] Detected replyToId: ${replyToId}. Fetching context...`);
        try {
            let quotedText = await dbService.getMessageById(replyToId);
            
            // Fallback to Webhook Data (Lightweight System) - Handles Old Messages / Not in DB
            if ((!quotedText || !quotedText.trim()) && replyToTextFallback) {
                logDebug(`[Swipe] DB miss. Using Webhook quoted text: "${replyToTextFallback.substring(0,30)}..."`);
                quotedText = replyToTextFallback;
            }

            logDebug(`[Swipe] Context fetch result: "${quotedText ? quotedText.substring(0,50) : 'null'}"`);
            
            if (quotedText && quotedText.trim()) {
                // Formatting Context like SMS/Messenger style
                combinedText = `[Replying to: "${quotedText.trim()}"]\n${combinedText}`;
            } else {
                logDebug(`[Swipe] Warning: Context was empty or null for ID ${replyToId}`);
            }
        } catch (e) {
            console.warn(`[WA] Failed to fetch quoted message ${replyToId}: ${e.message}`);
            logDebug(`[Swipe] Error fetching context: ${e.message}`);
        }
    }

    // --- AUDIO TRANSCRIPTION (Per-Message) ---
    // Added to fix Voice Message Reply & Swipe Reply Context
    let audioTranscriptText = null;
    let totalAudioTokens = 0; // Track Audio Tokens

    if (messages.some(m => m.audios && m.audios.length > 0)) {
        logDebug(`[WA] Found audio messages. Starting transcription...`);
        let collectedTranscripts = [];
        
        // Fetch Config for API Keys (needed for Transcription)
        const pageConfig = await dbService.getWhatsAppConfig(sessionName);

        for (const msg of messages) {
            if (msg.audios && msg.audios.length > 0) {
                for (const audioUrl of msg.audios) {
                    try {
                        // Transcribe
                        const transcriptData = await aiService.transcribeAudio(audioUrl, pageConfig || {});
                        
                        let transcript = "";
                        let usage = 0;

                        if (typeof transcriptData === 'object') {
                            transcript = transcriptData.text;
                            usage = transcriptData.usage || 0;
                        } else {
                            transcript = transcriptData; // Fallback for legacy string return
                        }

                        logDebug(`[WA] Transcribed msg ${msg.id}: ${transcript} (Tokens: ${usage})`);
                        
                        if (transcript) {
                            collectedTranscripts.push(transcript);
                            totalAudioTokens += usage;
                            
                            // SAVE Transcription to DB (Critical for Swipe Reply)
                            await dbService.saveWhatsAppChat({
                                session_name: sessionName,
                                sender_id: senderId,
                                recipient_id: pageId || sessionName,
                                message_id: msg.id,
                                text: transcript, // Update text in DB
                                timestamp: Date.now(),
                                status: 'received',
                                reply_by: 'user',
                                is_group: isGroup,
                                group_id: null,
                                group_name: null
                            });
                        }
                    } catch (e) {
                        console.error(`[WA] Transcription failed for ${msg.id}:`, e.message);
                        logDebug(`[WA] Transcription error: ${e.message}`);
                    }
                }
            }
        }
        audioTranscriptText = collectedTranscripts.join("\n").trim();
    }

    // --- IMAGE ANALYSIS (Per-Message) ---
    let imageAnalyzeText = null;
    let totalVisionTokens = 0;
    if (messages.some(m => m.images && m.images.length > 0)) {
        let productAnalysisPrompt = "Analyze this image to identify the Product Name, Color, and any visible text (like Price or Model). Output format: 'Based on the image, this is [Product Name] in [Color] color. Model: [Model], Price: [Price]'. If details are not clear, state 'Not identifiable'. Keep it concise.";
        try {
            const pagePrompts = await dbService.getPagePrompts(sessionName);
            if (pagePrompts && (pagePrompts.image_prompt || pagePrompts.vision_prompt)) {
                productAnalysisPrompt = pagePrompts.image_prompt || pagePrompts.vision_prompt;
            }
        } catch (e) {
            console.warn(`[WA] Failed to fetch vision prompt: ${e.message}`);
        }
        let collectedTexts = [];
        for (const msg of messages) {
            if (msg.images && msg.images.length > 0) {
                try {
                    const perMsgResults = await Promise.all(msg.images.map(img => aiService.processImageWithVision(img, {}, {
                        provider: 'openrouter',
                        model: 'qwen/qwen-2.5-vl-7b-instruct:free',
                        prompt: productAnalysisPrompt
                    })));
                    const perMsgText = perMsgResults.map(res => {
                        if (typeof res === 'object') {
                            totalVisionTokens += (res.usage || 0);
                            return res.text;
                        }
                        return res;
                    }).join("\n").trim();

                    if (perMsgText) {
                        collectedTexts.push(perMsgText);
                        // SAVE analysis as TEXT under ORIGINAL message_id for professional swipe-reply
                        try {
                            await dbService.saveWhatsAppChat({
                                session_name: sessionName,
                                sender_id: senderId,
                                recipient_id: pageId || sessionName,
                                message_id: msg.id,
                                text: `[Image Analysis] ${perMsgText}`,
                                timestamp: Date.now(),
                                status: 'received',
                                reply_by: 'user',
                                is_group: isGroup,
                                group_id: null,
                                group_name: null
                            });
                        } catch (e) {
                            console.error(`[WA] Failed to save per-message analysis:`, e.message);
                        }
                    }
                } catch (err) {
                    console.error(`[WA] Image Analysis Failed (msg ${msg.id}):`, err.message);
                }
            }
        }
        imageAnalyzeText = collectedTexts.join("\n").trim();
        if (imageAnalyzeText) {
            console.log(`[WA] Image Analysis Result (collected): ${imageAnalyzeText.substring(0,50)}... Total Tokens: ${totalVisionTokens}`);
        }
    }

    // --- MERGE LOGIC (n8n Style) ---
    // Priority: Combined Text + Image Analysis + Audio Transcripts
    let finalOutput = "";
    if (combinedText && combinedText.trim() !== "") {
        finalOutput += combinedText.trim();
    }
    if (imageAnalyzeText && imageAnalyzeText.trim() !== "") {
        if (finalOutput) finalOutput += "\n\n";
        finalOutput += imageAnalyzeText;
    }
    if (audioTranscriptText && audioTranscriptText.trim() !== "") {
        if (finalOutput) finalOutput += "\n\n";
        finalOutput += audioTranscriptText;
    }

    // Remove legacy combined analysis save (we now save per message_id)

    // If finalOutput is empty (no text, no valid image analysis), skip AI
    if (!finalOutput) {
        console.log(`[WA] No content to process (Empty text & No Image Analysis). Skipping.`);
        return;
    }

    try {
        // 1. Fetch Config (WhatsApp Specific)
        const pageConfig = await dbService.getWhatsAppConfig(sessionName);
        
        if (!pageConfig) {
            console.log(`[WA] Session ${sessionName} not configured.`);
            // Log System Error
            await dbService.saveWhatsAppChat({
                session_name: sessionName,
                sender_id: sessionName,
                recipient_id: senderId,
                message_id: `sys_${Date.now()}`,
                text: `[SYSTEM ERROR] Session not configured.`,
                timestamp: Date.now(),
                status: 'system_error',
                reply_by: 'system'
            });
            return;
        }

        if (isGroup && pageConfig && pageConfig.group_reply === false) {
            console.log(`[WA] Group reply disabled for ${sessionName}. Skipping group message from ${senderId}.`);
            return;
        }

        // 2. Check Subscription/Credit & Gatekeeper
        const validStatuses = ['active', 'trial', 'active_trial', 'active_paid'];
        if (!validStatuses.includes(pageConfig.subscription_status)) {
             console.log(`[WA] Session ${sessionName} subscription inactive (Status: ${pageConfig.subscription_status}).`);
             // Log System Error
             await dbService.saveWhatsAppChat({
                session_name: sessionName,
                sender_id: sessionName,
                recipient_id: senderId,
                message_id: `sys_${Date.now()}`,
                text: `[SYSTEM ERROR] Inactive Subscription: ${pageConfig.subscription_status}.`,
                timestamp: Date.now(),
                status: 'system_error',
                reply_by: 'system'
            });
             return;
        }

        // Gatekeeper Logic: Allow if Own API is used, otherwise require Credit
        // DEBUG LOGGING
        console.log(`[WA Gatekeeper] Config for ${sessionName}: Credits=${pageConfig.message_credit}, CheapEngine=${pageConfig.cheap_engine}, APIKey=${pageConfig.api_key ? 'YES' : 'NO'}`);

        const hasOwnKey = (pageConfig.api_key && pageConfig.api_key.length > 5 && pageConfig.cheap_engine === false);

        if (hasOwnKey) {
             console.log(`[WA] Session ${sessionName} using Own API. Gatekeeper ALLOW.`);
        } else {
             // Use Centralized User Credit (n8n style shared pool)
             // We pass 'sessionName' as pageId, but we need to ensure the DB service handles it
             if (pageConfig.message_credit <= 0) {
                 console.log(`[WA] Session ${sessionName} blocked by Gatekeeper (No Credit & No Own API). Credits: ${pageConfig.message_credit}`);
                 // Log System Error
                 await dbService.saveWhatsAppChat({
                    session_name: sessionName,
                    sender_id: sessionName,
                    recipient_id: senderId,
                    message_id: `sys_${Date.now()}`,
                    text: `[SYSTEM ERROR] Out of Credits.`,
                    timestamp: Date.now(),
                    status: 'system_error',
                    reply_by: 'system'
                });
                 return;
             }
        }

        // --- FAILURE LOCK CHECK ---
        
        // SAVE USER MESSAGE (Persistence Guarantee)
        // User Requirement: Save message to Supabase even if locked (Handover).
        if (finalOutput && finalOutput.trim() !== "") {
             try {
                 // Use the ID of the first message in the batch for consistency
                 const primaryMsgId = messages.length > 0 ? messages[0].id : `usr_${Date.now()}`;
                 
                 await dbService.saveWhatsAppChat({
                    session_name: sessionName,
                    sender_id: senderId,
                    recipient_id: sessionName, // Page is recipient
                    message_id: primaryMsgId,
                    text: finalOutput, // Save the FULL processed text (including image analysis)
                    timestamp: Date.now(),
                    status: 'received',
                    reply_by: 'user',
                    is_group: isGroup,
                    group_id: isGroup ? senderId : null
                });
             } catch (e) {
                 console.warn(`[WA] Failed to save user message (Persistence): ${e.message}`);
             }
        }

        const isLocked = await dbService.checkWhatsAppLockStatus(sessionName, senderId);
        if (isLocked) {
            console.log(`[WA] Conversation with ${senderId} locked due to repeated failures.`);
            await dbService.saveWhatsAppChat({
                session_name: sessionName,
                sender_id: sessionName,
                recipient_id: senderId,
                message_id: `sys_${Date.now()}`,
                text: `[SYSTEM ERROR] Conversation Locked (Too many failures).`,
                timestamp: Date.now(),
                status: 'system_error',
                reply_by: 'system'
            });
            return;
        }

        // 3. Prepare AI Context (n8n Style)
        // Ensure Page ID is correctly identified (Session Name = Page ID for WhatsApp)
        const pageId = sessionName; 

        // --- CHECK LABELS (Admin Handover & Dynamic Actions) ---
        try {
            const contact = await whatsappService.getContact(sessionName, senderId);
            // WAHA Labels can be strings or objects. Check both.
            if (contact && contact.labels && Array.isArray(contact.labels)) {
                // Fetch Configured Label Actions from DB
                const labelActions = pageConfig.label_actions || [];
                
                // Hardcoded defaults (Legacy Support)
                const hardcodedStops = ['adminhandle', 'admincall'];

                const shouldStop = contact.labels.some(l => {
                    const labelName = (typeof l === 'string' ? l : l.name || '').toLowerCase();
                    
                    // 1. Check Hardcoded
                    if (hardcodedStops.includes(labelName)) return true;

                    // 2. Check Dynamic DB Configuration
                    const actionConfig = labelActions.find(la => la.label_name.toLowerCase() === labelName);
                    if (actionConfig && actionConfig.ai_action === 'stop') return true;

                    return false;
                });
                
                if (shouldStop) {
                    console.log(`[WA] User ${senderId} has Blocking Label. Stopping AI.`);
                    // Ensure handover lock is active
                    const chatKey = `${sessionName}_${senderId}`;
                    handoverMap.set(chatKey, Date.now() + 60 * 60 * 1000); // 1 Hour Lock
                    return;
                } else {
                    // Label removed? Unblock immediately.
                    const chatKey = `${sessionName}_${senderId}`;
                    if (handoverMap.has(chatKey)) {
                        console.log(`[WA] Blocking label removed for ${senderId}. Unblocking AI.`);
                        handoverMap.delete(chatKey);
                    }
                }
            }
        } catch (e) {
            console.warn(`[WA] Label check failed: ${e.message}`);
        }
        // -------------------------------------

        // Fetch History (User + Assistant)
        // n8n workflow uses 'postgres_chat_memory'
        // Dynamic History Limit: Check 'check_conversion' (from Behavior Settings) or default to 20
        let historyLimit = 20;
        if (pageConfig.check_conversion) {
            const limit = Number(pageConfig.check_conversion);
            if (limit > 0 && limit <= 50) historyLimit = limit;
        }
        
        const history = await dbService.getWhatsAppChatHistory(sessionName, senderId, historyLimit);
        
        // 4. Generate Response (AI)
        console.log(`[AI] Generating response for ${senderId} (Session: ${sessionName})...`);
        
        // If we already analyzed images and replaced the text, don't pass images again to avoid double-processing
        const imagesToPass = (imageAnalyzeText && imageAnalyzeText.trim() !== "") ? [] : allImages;

        const aiResponse = await aiService.generateResponse({
            pageId: pageId, 
            userId: senderId,
            userMessage: finalOutput, // Use the resolved output (Analysis, Text, Audio)
            history: history,
            imageUrls: imagesToPass, 
            audioUrls: [], // Handled manually in controller
            config: pageConfig,
            platform: 'whatsapp',
            extraTokenUsage: totalVisionTokens + totalAudioTokens // Pass vision + audio tokens
        });

        if (!aiResponse) {
             console.log(`[WA] AI returned null (Silent Failure).`);
             // Do NOT send error message to user (Silent Fail Rule)
             return;
        }

        const replyText = aiResponse.reply || aiResponse.text;
        
        // 5. Send Reply
        console.log(`[WA] Sending Reply: "${replyText.substring(0, 50)}..."`);
        
        // Mark as Seen (User Experience)
        await whatsappService.sendSeen(sessionName, senderId);

        // --- HANDLE DYNAMIC LABELS ([ADD_LABEL: x]) ---
        // Format: [ADD_LABEL: admincall]
        const labelRegex = /\[ADD_LABEL:\s*([a-zA-Z0-9_]+)\]/gi;
        let labelMatch;
        let finalReplyText = replyText;

        while ((labelMatch = labelRegex.exec(finalReplyText)) !== null) {
            const fullTag = labelMatch[0];
            const labelName = labelMatch[1].toLowerCase();
            
            console.log(`[WA] AI requested to add label: ${labelName}`);
            
            try {
                // Call WAHA to add label
                await whatsappService.addLabel(sessionName, senderId, labelName);
                
                // If label is 'admincall' or 'adminhandle' or has 'stop' action, lock immediately
                // This prevents AI from replying to its own label action in next loop if user replies fast
                const labelActions = pageConfig.label_actions || [];
                const actionConfig = labelActions.find(la => la.label_name.toLowerCase() === labelName);
                const isHardcodedStop = ['adminhandle', 'admincall'].includes(labelName);
                
                if (isHardcodedStop || (actionConfig && actionConfig.ai_action === 'stop')) {
                     console.log(`[WA] Blocking Label applied (${labelName}). Locking conversation.`);
                     const chatKey = `${sessionName}_${senderId}`;
                     handoverMap.set(chatKey, Date.now() + 60 * 60 * 1000);
                }

            } catch (lblErr) {
                console.error(`[WA] Failed to add label ${labelName}:`, lblErr.message);
            }

            // Remove tag from user-facing text
            finalReplyText = finalReplyText.replace(fullTag, '').trim();
        }

        // Handle Strict Image Sending (IMAGE: Title | URL)
        // Extracted images are removed from replyText
        const extractedImages = [];
        
        const strictImageRegex = /IMAGE:\s*(.+?)\s*\|\s*(https?:\/\/[^\s,]+)/gi;
        let strictMatch;
        while ((strictMatch = strictImageRegex.exec(finalReplyText)) !== null) {
            const fullMatch = strictMatch[0];
            const title = strictMatch[1].trim();
            let url = strictMatch[2].trim();
            url = url.replace(/[,.]$/, ''); // Cleanup

            // Fix Google Drive Links
            const driveIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
            if (driveIdMatch && driveIdMatch[1]) {
                url = `https://drive.google.com/uc?export=view&id=${driveIdMatch[1]}`;
            }

            if (!extractedImages.some(img => img.url === url)) {
                extractedImages.push({ url: url, title: title });
            }
            
            // Remove from text
            finalReplyText = finalReplyText.replace(fullMatch, '').trim();
        }

        // --- EMOJI HANDOVER LOGIC (AI Reply) ---
        {
            let LOCK_EMOJIS = ['🛑', '🔒', '⛔'];
            let UNLOCK_EMOJIS = ['🟢', '🔓', '✅'];

            if (pageConfig) {
                if (pageConfig.lock_emojis && pageConfig.lock_emojis.trim()) {
                    LOCK_EMOJIS = pageConfig.lock_emojis.split(',').map(e => e.trim()).filter(e => e);
                }
                if (pageConfig.unlock_emojis && pageConfig.unlock_emojis.trim()) {
                    UNLOCK_EMOJIS = pageConfig.unlock_emojis.split(',').map(e => e.trim()).filter(e => e);
                }
            }

            let aiCommand = null;
            for (const e of LOCK_EMOJIS) if (finalReplyText.includes(e)) aiCommand = 'LOCK';
            for (const e of UNLOCK_EMOJIS) if (finalReplyText.includes(e)) aiCommand = 'UNLOCK';
            
            if (aiCommand) {
                 const isLocked = aiCommand === 'LOCK';
                 console.log(`[WA] Emoji Command Detected (${aiCommand}) from AI. Updating Lock Status...`);
                 await dbService.toggleWhatsAppLock(sessionName, senderId, isLocked);
                 
                 const chatKey = `${sessionName}_${senderId}`;
                 if (isLocked) handoverMap.set(chatKey, Date.now() + 24 * 60 * 60 * 1000);
                 else handoverMap.delete(chatKey);
            }
        }

        // Send Text First
        let sentMessageId = `bot_${Date.now()}`;
        
        if (finalReplyText) {
             const sentData = await whatsappService.sendMessage(sessionName, senderId, finalReplyText);
             if (sentData && sentData.id) {
                 // WAHA returns { id: "...", ... } or { id: { _serialized: "..." } } depending on version
                 // Usually sentData.id is the ID string
                 sentMessageId = (typeof sentData.id === 'object') ? sentData.id._serialized : sentData.id;
                 
                 // Add to Bot Message IDs (Critical for preventing Double Messages in Dashboard)
                 if (sentMessageId) {
                     console.log(`[WA Debug] Adding BotID: ${sentMessageId}`);
                     botMessageIds.add(sentMessageId);
                     
                     // Add to Recent Bot Replies (Text Guard)
                     // Update: Store NORMALIZED text for robust matching
                     recentBotReplies.set(senderId, { text: normalizeText(finalReplyText), timestamp: Date.now() });
                     
                     // Auto-clear after 2 minutes to save memory
                     setTimeout(() => {
                         botMessageIds.delete(sentMessageId);
                         recentBotReplies.delete(senderId);
                         // console.log(`[WA Debug] Cleared BotID: ${sentMessageId}`);
                     }, 2 * 60 * 1000);
                 }
             }
        }

        // Send Images
        for (const img of extractedImages) {
            console.log(`[WA] Sending Extracted Image: ${img.title} -> ${img.url}`);
            await whatsappService.sendImage(sessionName, senderId, img.url, img.title);
        }

        // 6. Deduct Credit (If not Own API)
        // Update: Deduct from User Shared Pool
        if (!hasOwnKey) {
             const deducted = await dbService.deductWhatsAppCredit(sessionName);
             if (!deducted) {
                 console.warn(`[WA] Credit deduction failed for ${sessionName} (User Shared Pool).`);
             }
        }

        // 7. Save Bot Reply to DB
        await dbService.saveWhatsAppChat({
            session_name: sessionName,
            sender_id: pageId || sessionName, // Bot (Page) is sender
            recipient_id: senderId, // User is recipient
            message_id: sentMessageId,
            text: finalReplyText, // Save CLEANED text (what was actually sent) to match Webhook Echo Guard
            timestamp: Date.now(),
            status: 'sent',
            reply_by: 'bot',
            model_used: aiResponse.model, // Save Model Name
            token_usage: aiResponse.token_usage // Save Total Token Usage (Vision + Chat)
        });

    } catch (err) {
        console.error(`[WA] Error processing buffered messages: ${err.message}`);
        // Log System Error
        await dbService.saveWhatsAppChat({
            session_name: sessionName,
            sender_id: sessionName,
            recipient_id: senderId,
            message_id: `err_${Date.now()}`,
            text: `[SYSTEM ERROR] ${err.message}`,
            timestamp: Date.now(),
            status: 'system_error',
            reply_by: 'system'
        });
    }
}

// Cleanup Job
async function checkAndCleanupExpiredSessions() {
    console.log('[WA Cleanup] Checking for expired sessions...');
    try {
        const expiredSessions = await dbService.getExpiredWhatsAppSessions();
        
        if (!expiredSessions || expiredSessions.length === 0) {
            // console.log('[WA Cleanup] No expired sessions found.');
            return;
        }

        console.log(`[WA Cleanup] Found ${expiredSessions.length} expired sessions. Processing...`);

        for (const session of expiredSessions) {
            const { session_name } = session;
            console.log(`[WA Cleanup] Expiring session '${session_name}'...`);

            // 1. Stop/Delete in WAHA
            try {
                // Try logout/stop first
                try { await whatsappService.logoutSession(session_name); } catch(e){}
                await new Promise(r => setTimeout(r, 1000));
                
                try { await whatsappService.stopSession(session_name); } catch(e){}
                await new Promise(r => setTimeout(r, 1000));

                await whatsappService.deleteSession(session_name);
            } catch (err) {
                console.warn(`[WA Cleanup] WAHA cleanup error for '${session_name}':`, err.message);
                // Continue to DB cleanup anyway
            }

            // 2. Mark as Expired in DB
            // We set status to 'expired', active to false.
            await dbService.updateWhatsAppEntryByName(session_name, {
                status: 'expired',
                active: false,
                subscription_status: 'expired'
            });
            
            console.log(`[WA Cleanup] Session '${session_name}' marked as expired.`);
        }

    } catch (err) {
        console.error('[WA Cleanup] Error:', err);
    }
}

module.exports = {
    handleWebhook,
    checkAndCleanupExpiredSessions
};
