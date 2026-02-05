const whatsappService = require('../services/whatsappService');
const aiService = require('../services/aiService');
const dbService = require('../services/dbService');
const fs = require('fs');
const path = require('path');

function logDebug(msg) {
    try {
        fs.appendFileSync(path.join(__dirname, '../../ai_debug.log'), new Date().toISOString() + ' [WA] ' + msg + '\n');
    } catch (e) {
        console.error("Failed to write debug log:", e);
    }
}

// Helper to log to file
function logToFile(message) {
    const logPath = path.join(__dirname, '../../debug.log');
    const timestamp = new Date().toISOString();
    try {
        fs.appendFileSync(logPath, `[${timestamp}] [WA] ${message}\n`);
    } catch (e) {
        console.error('Log Error:', e);
    }
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
            // Check if this is a BOT message we just sent
            if (botMessageIds.has(payload.id)) {
                // It's the Bot. Remove from set and Ignore.
                botMessageIds.delete(payload.id);
                // console.log(`[WA] Ignoring Bot's own echo message: ${payload.id}`);
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
                 console.log(`[WA] Saving ADMIN message (fromMe): ${messageText.substring(0,30)}...`);
                 await dbService.saveWhatsAppChat({
                    session_name: sessionName,
                    sender_id: sessionName, // Admin is the sender (Session Name/Page Number)
                    recipient_id: payload.to, // User is the recipient
                    message_id: messageId,
                    text: messageText,
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
        // 1. Try mediaUrl (Preferred - Requires WAHA downloadMedia: true)
        if (messagePayload.mediaUrl) {
            if (messagePayload.mimetype && messagePayload.mimetype.startsWith('image/')) {
                imageUrls.push(messagePayload.mediaUrl);
            } else if (messagePayload.mimetype && messagePayload.mimetype.startsWith('audio/')) {
                audioUrls.push(messagePayload.mediaUrl);
            }
        } 
        // 2. Try body (if Base64 Data URI)
        else if (messagePayload.body && messagePayload.body.startsWith('data:')) {
             if (messagePayload.body.startsWith('data:image')) {
                imageUrls.push(messagePayload.body);
             } else if (messagePayload.body.startsWith('data:audio')) {
                audioUrls.push(messagePayload.body);
             }
        }
        // 3. Try _data.body (if Base64 Data URI - raw data often here)
        else if (messagePayload._data && messagePayload._data.body && typeof messagePayload._data.body === 'string' && messagePayload._data.body.startsWith('data:')) {
             if (messagePayload._data.body.startsWith('data:image')) {
                imageUrls.push(messagePayload._data.body);
             } else if (messagePayload._data.body.startsWith('data:audio')) {
                audioUrls.push(messagePayload._data.body);
             }
        }
        // 4. Try jpegThumbnail (Last Resort for Images - User request)
        else if (messagePayload._data && messagePayload._data.jpegThumbnail) {
             console.log('[WA] Using jpegThumbnail as fallback for image.');
             // jpegThumbnail is usually just the base64 string without prefix
             const base64 = `data:image/jpeg;base64,${messagePayload._data.jpegThumbnail}`;
             imageUrls.push(base64);
        }
        else {
            messageText += " [User sent media]";
            console.log('[WA] Media detected but no URL or Data found. WAHA config "downloadMedia: true" might be missing.');
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
    sessionData.messages.push({
        text: messageText,
        reply_to: messagePayload.replyTo?.id || null, // WAHA reply info
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
    let combinedText = "";
    let replyToId = null;
    let allImages = [];
    let allAudios = [];
    const isGroup = typeof senderId === 'string' && senderId.includes('@g.us');

    for (const msg of messages) {
        if (msg.text) combinedText += msg.text + "\n";
        if (msg.reply_to) replyToId = msg.reply_to; 
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

        // --- CHECK LABELS (Admin Handover) ---
        try {
            const contact = await whatsappService.getContact(sessionName, senderId);
            // WAHA Labels can be strings or objects. Check both.
            // Example: ["adminhandle", "new_customer"] or [{id: "...", name: "adminhandle"}]
            if (contact && contact.labels && Array.isArray(contact.labels)) {
                const hasAdminLabel = contact.labels.some(l => 
                    (typeof l === 'string' && l.toLowerCase() === 'adminhandle') ||
                    (l.name && l.name.toLowerCase() === 'adminhandle')
                );
                
                if (hasAdminLabel) {
                    console.log(`[WA] User ${senderId} has 'adminhandle' label. Blocking AI.`);
                    // Ensure handover lock is active
                    const chatKey = `${sessionName}_${senderId}`;
                    handoverMap.set(chatKey, Date.now() + 60 * 60 * 1000); // 1 Hour Lock
                    return;
                } else {
                    // Label removed? Unblock immediately.
                    const chatKey = `${sessionName}_${senderId}`;
                    if (handoverMap.has(chatKey)) {
                        console.log(`[WA] 'adminhandle' label removed for ${senderId}. Unblocking AI.`);
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
        const aiResponse = await aiService.generateResponse({
            pageId: pageId, 
            userId: senderId,
            userMessage: combinedText,
            history: history,
            imageUrls: allImages, // Pass accumulated images
            audioUrls: allAudios, // Pass accumulated audios
            config: pageConfig,
            platform: 'whatsapp'
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

        // Handle Strict Image Sending (IMAGE: Title | URL)
        // Extracted images are removed from replyText
        const extractedImages = [];
        let finalReplyText = replyText;
        
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
        if (finalReplyText) {
             await whatsappService.sendMessage(sessionName, senderId, finalReplyText);
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
            message_id: `bot_${Date.now()}`,
            text: replyText, // Save full original text including image tags for context
            timestamp: Date.now(),
            status: 'sent',
            reply_by: 'assistant',
            model_used: aiResponse.model // Save Model Name
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
