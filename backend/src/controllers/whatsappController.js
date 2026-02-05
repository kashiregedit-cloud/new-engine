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
// Recent reply guard (avoid double answers)
const recentReplyMap = new Map();
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
// Sent Message History (Fuzzy Match Guard)
const sentMessageHistory = new Map(); // Key: recipient_body, Value: { ts: number }

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

        // --- HANDLE ADMIN/BOT MESSAGES (fromMe) ---
        if (payload.fromMe) {
            // Check if this is a BOT message we just sent (ID Match)
            if (botMessageIds.has(payload.id)) {
                botMessageIds.delete(payload.id);
                return;
            }
            
            // SECONDARY CHECK: Check if ID._serialized is in Set (WAHA sometimes returns object ID)
            if (payload.id && payload.id._serialized && botMessageIds.has(payload.id._serialized)) {
                botMessageIds.delete(payload.id._serialized);
                return;
            }
            
            // TERTIARY CHECK: Recent History Check (Fuzzy Match)
            // If we recently sent a message with SAME content to SAME user within 5 seconds, ignore it.
            // This catches cases where ID format differs completely (e.g. true_... vs false_...)
            const targetRecipient = payload.to;
            const targetBody = (payload.body || '').trim();
            const now = Date.now();
            
            // Clean up old sent history
            for (const [key, val] of sentMessageHistory.entries()) {
                if (now - val.ts > 10000) sentMessageHistory.delete(key);
            }
            
            // Check
            const historyKey = `${targetRecipient}_${targetBody}`;
            if (sentMessageHistory.has(historyKey)) {
                console.log(`[WA] Ignoring fromMe message (Fuzzy Match): ${historyKey}`);
                sentMessageHistory.delete(historyKey);
                return;
            }

            // If NOT in botMessageIds, it's the ADMIN (via Phone/Web)
            // Save Admin message to DB & Activate Handover
            
            const messageId = payload.id;
            const messageText = payload.body || '';
            const sessionName = session;
            
            // In-memory duplicate check
            if (recentMessageIds.has(messageId)) return;
            recentMessageIds.add(messageId);
            setTimeout(() => recentMessageIds.delete(messageId), 10 * 60 * 1000); // Clear after 10 mins

            const isDuplicate = await dbService.checkWhatsAppDuplicate(messageId);
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
                    message_id: messageId,
                    text: textToSave,
                    timestamp: Date.now(),
                    status: 'sent',
                    reply_by: 'admin' // Trigger stop logic
                });
                // Activate handover lock for this chat for 5 minutes
                const chatKey = `${sessionName}_${payload.to || payload.chatId || 'unknown'}`;
                handoverMap.set(chatKey, Date.now() + 5 * 60 * 1000);
            }
            return; // STOP Processing
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
    const senderId = messagePayload.from; // e.g., 12345678@c.us
    const sessionName = session; // Using WAHA Session as Session Name
    let messageText = messagePayload.body || '';
    const messageId = messagePayload.id;
    const isGroup = typeof senderId === 'string' && senderId.includes('@g.us');
    const groupId = messagePayload.chatId || (isGroup ? senderId : null);
    const groupName = messagePayload.chatName || null;

    const logMsg = `[WA Webhook] Received Message. Session: ${sessionName}, Sender: ${senderId}, Text: "${messageText.substring(0, 50)}..."`;
    console.log(logMsg);
    logToFile(logMsg);

    // Handover guard: if admin takeover active for this chat, skip
    const chatKey = `${sessionName}_${senderId}`;
    const handoverUntil = handoverMap.get(chatKey);
    if (handoverUntil && handoverUntil > Date.now()) {
        console.log(`[WA] Handover active for ${chatKey}. Skipping AI.`);
        return;
    } else if (handoverUntil && handoverUntil <= Date.now()) {
        handoverMap.delete(chatKey);
    }

    // Handle Images/Media (If WAHA exposes URL)
    const imageUrls = [];
    const audioUrls = [];
    
    if (messagePayload.hasMedia) {
        // 0. Try media.url (User request: Prioritize Direct Link if available)
        // User confirmed WAHA URL is fixed.
        if (messagePayload.media && messagePayload.media.url && messagePayload.media.url.startsWith('http')) {
             console.log(`[WA] Found media.url: ${messagePayload.media.url}`);
             if (messagePayload.media.mimetype && messagePayload.media.mimetype.startsWith('image/')) {
                 imageUrls.push(messagePayload.media.url);
             } else if (messagePayload.media.mimetype && messagePayload.media.mimetype.startsWith('audio/')) {
                 audioUrls.push(messagePayload.media.url);
             }
        }
        // 1. Try deep nested jpegThumbnail (Backup if URL fails or is missing)
        else if (messagePayload._data?.message?.imageMessage?.jpegThumbnail) {
             console.log('[WA] Using deep nested jpegThumbnail (imageMessage) as backup source.');
             const thumb = messagePayload._data.message.imageMessage.jpegThumbnail;
             // Clean Base64 string (remove newlines/spaces)
             const cleanThumb = thumb.replace(/\s/g, '');
             const base64 = `data:image/jpeg;base64,${cleanThumb}`;
             imageUrls.push(base64);
        }
        // 2. Try jpegThumbnail (Standard Backup)
        else if (messagePayload._data && (messagePayload._data.jpegThumbnail || messagePayload._data.thumbnail)) {
             console.log('[WA] Using jpegThumbnail/thumbnail as backup source.');
             const thumb = messagePayload._data.jpegThumbnail || messagePayload._data.thumbnail;
             // Clean Base64 string (remove newlines/spaces)
             const cleanThumb = thumb.replace(/\s/g, '');
             const base64 = `data:image/jpeg;base64,${cleanThumb}`;
             imageUrls.push(base64);
        }
        // 3. Try mediaUrl (Legacy/Alternative)
        else if (messagePayload.mediaUrl) {
            if (messagePayload.mimetype && messagePayload.mimetype.startsWith('image/')) {
                imageUrls.push(messagePayload.mediaUrl);
            } else if (messagePayload.mimetype && messagePayload.mimetype.startsWith('audio/')) {
                audioUrls.push(messagePayload.mediaUrl);
            }
        } 
        // 3. Try body (if Base64 Data URI)
        else if (messagePayload.body && messagePayload.body.startsWith('data:')) {
             if (messagePayload.body.startsWith('data:image')) {
                imageUrls.push(messagePayload.body);
             } else if (messagePayload.body.startsWith('data:audio')) {
                audioUrls.push(messagePayload.body);
             }
        }
        // 4. Try _data.body (if Base64 Data URI - raw data often here)
        else if (messagePayload._data && messagePayload._data.body && typeof messagePayload._data.body === 'string' && messagePayload._data.body.startsWith('data:')) {
             if (messagePayload._data.body.startsWith('data:image')) {
                imageUrls.push(messagePayload._data.body);
             } else if (messagePayload._data.body.startsWith('data:audio')) {
                audioUrls.push(messagePayload._data.body);
             }
        }
        // 5. Try raw body as Base64 (Some versions send raw base64 in body without prefix)
        else if (messagePayload.body && messagePayload.body.length > 100 && /^[A-Za-z0-9+/=]+$/.test(messagePayload.body.replace(/\s/g, ''))) {
             console.log('[WA] Body looks like raw Base64. Using as image.');
             const base64 = `data:image/jpeg;base64,${messagePayload.body}`;
             imageUrls.push(base64);
        }
        else {
            messageText += " [User sent media]";
            console.log('[WA] Media detected but no URL or Data found. Payload keys:', Object.keys(messagePayload));
            if (messagePayload._data) console.log('[WA] _data keys:', Object.keys(messagePayload._data));
            console.log('[WA] Full Payload (Debug):', JSON.stringify(messagePayload).substring(0, 500)); // Log first 500 chars
        }
    }

    // Check Duplicate immediately (WhatsApp specific)
    const isDuplicate = await dbService.checkWhatsAppDuplicate(messageId);
    if (isDuplicate) {
        console.log(`[WA] Duplicate message ${messageId} ignored.`);
        return;
    }

    // Additional n8n-style filter: collapse trivial repeats (e.g., "hi" twice fast)
    // EXCEPTION: Do NOT filter if media is present (User might send 5 photos in a row)
    const hasMedia = imageUrls.length > 0 || audioUrls.length > 0;
    const normalized = (messageText || '').trim().toLowerCase();
    const lastUser = lastUserMessageMap.get(chatKey);
    
    if (!hasMedia && lastUser && lastUser.text === normalized && (Date.now() - lastUser.ts) < 5000) {
        console.log(`[WA] Ignoring repeated short message from ${chatKey}: "${normalized}"`);
        return;
    }
    lastUserMessageMap.set(chatKey, { text: normalized, ts: Date.now() });

    // --- SAVE USER MESSAGE TO whatsapp_chats (Immediate - Raw) ---
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

    const sessionId = `${sessionName}_${senderId}`;

    // Initialize buffer if not exists
    if (!debounceMap.has(sessionId)) {
        debounceMap.set(sessionId, { messages: [], timer: null, pageId: messagePayload.to });
    }

    const sessionData = debounceMap.get(sessionId);
    
    // Push Object
    // Extract Quoted Message Data (Lightweight System - Webhook Data)
    let quotedContent = null;
    try {
        if (messagePayload._data && messagePayload._data.quotedMsg) {
            const q = messagePayload._data.quotedMsg;
            if (q.body) quotedContent = q.body; // Text
            else if (q.caption) quotedContent = q.caption; // Image with caption
            else if (q.type === 'ptt' || q.type === 'audio') quotedContent = '[Voice Message]';
            else if (q.type === 'image') quotedContent = '[Image Message]';
            else if (q.type === 'sticker') quotedContent = '[Sticker]';
        } else if (messagePayload.replyTo && messagePayload.replyTo.body) {
             quotedContent = messagePayload.replyTo.body;
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
                        const transcript = await aiService.transcribeAudio(audioUrl, pageConfig || {});
                        logDebug(`[WA] Transcribed msg ${msg.id}: ${transcript}`);
                        
                        if (transcript) {
                            collectedTranscripts.push(transcript);
                            
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
        const productAnalysisPrompt = "Analyze this image to identify the Product Name, Color, and any visible text (like Price or Model). Output format: 'Based on the image, this is [Product Name] in [Color] color. Model: [Model], Price: [Price]'. If details are not clear, state 'Not identifiable'. Keep it concise.";
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
        const hasOwnKey = (pageConfig.api_key && pageConfig.api_key.length > 5 && pageConfig.cheap_engine === false);

        if (hasOwnKey) {
             console.log(`[WA] Session ${sessionName} using Own API. Gatekeeper ALLOW.`);
        } else {
             // Use Centralized User Credit (n8n style shared pool)
             // We pass 'sessionName' as pageId, but we need to ensure the DB service handles it
             if (pageConfig.message_credit <= 0) {
                 console.log(`[WA] Session ${sessionName} blocked by Gatekeeper (No Credit & No Own API).`);
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
            extraTokenUsage: totalVisionTokens // Pass vision tokens to sum up
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

        // Send Text First
        let sentMessageId = `bot_${Date.now()}`;
        
        if (finalReplyText) {
             const sentData = await whatsappService.sendMessage(sessionName, senderId, finalReplyText);
             if (sentData && sentData.id) {
                 // WAHA returns { id: "...", ... } or { id: { _serialized: "..." } } depending on version
                 // Usually sentData.id is the ID string
                 sentMessageId = (typeof sentData.id === 'object') ? sentData.id._serialized : sentData.id;
                 
                 // Add to Fuzzy Match History
                 const historyKey = `${senderId}_${finalReplyText.trim()}`;
                 sentMessageHistory.set(historyKey, { ts: Date.now() });
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
            text: replyText, // Save full original text including image tags for context
            timestamp: Date.now(),
            status: 'sent',
            reply_by: 'assistant',
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
