const dbService = require('../services/dbService');
const aiService = require('../services/aiService');
const whatsappService = require('../services/whatsappService');
const fs = require('fs');
const path = require('path');

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
                    sender_id: sessionName, // Admin is the sender (Session Name)
                    recipient_id: payload.to,
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
            dbStatus = status.toLowerCase();
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
        // If WAHA sends mediaUrl (configured in WAHA to download media)
        if (messagePayload.mediaUrl) {
            if (messagePayload.mimetype && messagePayload.mimetype.startsWith('image/')) {
                imageUrls.push(messagePayload.mediaUrl);
            } else if (messagePayload.mimetype && messagePayload.mimetype.startsWith('audio/')) {
                audioUrls.push(messagePayload.mediaUrl);
            }
        } else {
            messageText += " [User sent media]";
        }
    }

    // Check Duplicate immediately (WhatsApp specific)
    const isDuplicate = await dbService.checkWhatsAppDuplicate(messageId);
    if (isDuplicate) {
        console.log(`[WA] Duplicate message ${messageId} ignored.`);
        return;
    }

    // Additional n8n-style filter: collapse trivial repeats (e.g., "hi" twice fast)
    const normalized = (messageText || '').trim().toLowerCase();
    const lastUser = lastUserMessageMap.get(chatKey);
    if (lastUser && lastUser.text === normalized && (Date.now() - lastUser.ts) < 5000) {
        console.log(`[WA] Ignoring repeated short message from ${chatKey}: "${normalized}"`);
        return;
    }
    lastUserMessageMap.set(chatKey, { text: normalized, ts: Date.now() });

    // --- SAVE USER MESSAGE TO whatsapp_chats (Immediate - Raw) ---
    try {
        await dbService.saveWhatsAppChat({
            session_name: sessionName,
            sender_id: senderId,
            recipient_id: sessionName,
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
        debounceMap.set(sessionId, { messages: [], timer: null });
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
        debounceMap.delete(sessionId);
        processBufferedMessages(sessionId, sessionName, senderId, messagesToProcess);
    }, debounceTime); 
}

// Core Logic Function (Debounced)
async function processBufferedMessages(sessionId, sessionName, senderId, messages) {
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
                text: `[SYSTEM] Conversation Locked (Repeated Failures).`,
                timestamp: Date.now(),
                status: 'system_error',
                reply_by: 'system'
            });
            return;
        }
        // --------------------------

        // --- FETCH CONTEXT ---
        const historyLimit = 20;
        
        // Parallel: Get History + Mark Seen + Typing
        const [rawHistory, _seen, _typing] = await Promise.all([
            dbService.getWhatsAppChatHistory(sessionName, senderId, historyLimit),
            whatsappService.sendSeen(sessionName, senderId),  // Mark as Seen
            whatsappService.sendTyping(sessionName, senderId) // Typing indicator
        ]);

        // Transform History for AI Service
        // rawHistory is array of objects { text, reply_by, ... }
        // AI Service expects: [{ role: 'user'|'assistant', content: '...' }]
        const history = rawHistory.map(msg => ({
            role: (msg.reply_by === 'user') ? 'user' : 'assistant',
            content: msg.text || ''
        }));

        const senderName = 'Customer'; // Could be improved if we stored name in whatsapp_contacts

        // Batch Processing (Images/Audio)
        if (allImages.length > 0) {
            if (pageConfig.image_detection) {
                const imagePromises = allImages.map(url => aiService.processImageWithVision(url, pageConfig));
                const imageResults = await Promise.all(imagePromises);
                let combinedImageAnalysis = "";
                imageResults.forEach((result, index) => {
                    combinedImageAnalysis += `\n[Image ${index + 1} Analysis]: ${result}\n`;
                });
                combinedText += `\n\n[System: User sent ${allImages.length} images. Analysis follows:]${combinedImageAnalysis}`;
            } else {
                combinedText += `\n[User sent ${allImages.length} images]`;
            }
        }

        if (allAudios.length > 0) {
            const audioPromises = allAudios.map(url => aiService.transcribeAudio(url, pageConfig));
            const audioResults = await Promise.all(audioPromises);
            const combinedAudioTranscript = audioResults.join('\n');
            combinedText += `\n\n[System: User sent ${allAudios.length} voice messages. Transcripts follow:]\n${combinedAudioTranscript}`;
        }

        // --- FEATURE FLAGS ---
        if (!pageConfig.reply_message) {
            console.log(`[WA] Reply Message disabled for ${sessionName}.`);
            return;
        }

        // --- STOP EMOJI CHECK (Using Local History) ---
        const blockEmoji = pageConfig.block_emoji;
        const unblockEmoji = pageConfig.unblock_emoji;

        if (blockEmoji) {
            let lastBlockTime = 0;
            let lastUnblockTime = 0;

            // Check current buffered messages first
            if (combinedText.includes(blockEmoji)) {
                lastBlockTime = Date.now();
            }

            // Check history
            for (const msg of rawHistory) {
                const isFromPage = msg.sender_id === sessionName || msg.reply_by === 'bot' || msg.reply_by === 'admin';
                if (isFromPage) { // Check bot messages too? Actually user sends block emoji usually.
                    // Wait, block emoji is usually sent by ADMIN/USER? 
                    // "AI Stop Logic via Emoji: AI checks the last 10 messages for emojis... If found, it halts".
                    // Usually it's the HUMAN (Admin) sending the stop emoji to stop the bot.
                    // So we check messages from 'admin' or 'user' (if user wants to stop it themselves, rare).
                    // Typically 'admin' takeover. 
                    // Let's assume ANY message with block emoji stops it.
                    const content = msg.text || '';
                    const msgTime = Number(msg.timestamp); // stored as BigInt/Number in new table

                    if (content.includes(blockEmoji)) {
                        if (msgTime > lastBlockTime) lastBlockTime = msgTime;
                    }
                    if (unblockEmoji && content.includes(unblockEmoji)) {
                        if (msgTime > lastUnblockTime) lastUnblockTime = msgTime;
                    }
                }
            }

            if (lastBlockTime > 0) {
                if (lastBlockTime > lastUnblockTime) {
                    const logMsg = `[WA Stop Logic] Active Block Emoji (${blockEmoji}) detected. AI Halted.`;
                    console.log(logMsg);
                    return;
                }
            }
        }

        // --- GENERATE AI REPLY ---
        const finalUserMessage = combinedText;
        
        // Inject Formatting
        // Note: pageConfig IS pagePrompts in WhatsApp (merged table)
        if (pageConfig.text_prompt) {
             pageConfig.text_prompt += `\n\n[IMPORTANT OUTPUT RULES]\n1. Use WhatsApp Formatting (*Bold*, _Italic_, ~Strike~).\n2. Keep it concise.\n3. If explaining multiple items/plans, keep each section SHORT.\n4. Include the IMAGE LINK for EVERY item/plan described.\n5. **STRICT IMAGE FORMAT**: You MUST output images using this EXACT format:\n   IMAGE: Plan Name | https://your-image-url.com\n   (Example: "IMAGE: 🌟 Basic Plan | https://i.imgur.com/xyz.jpg")\n   **CRITICAL**: The URL MUST be a direct image link (ending in .jpg, .png, .webp). Do NOT use product page URLs.\n6. DO NOT use [Image] placeholders. ONLY use the 'IMAGE: Title | URL' format.`;
        }

        // pageConfig serves as both config and prompts
        const aiResponse = await aiService.generateReply(finalUserMessage, pageConfig, pageConfig, history, senderName);

        // --- ORDER TRACKING ---
        if (aiResponse.order_details && aiResponse.order_details.product_name) {
             const order = aiResponse.order_details;
             let customerNumber = order.phone ? order.phone.replace(/\D/g, '') : senderId.replace(/\D/g, ''); 
             
             await dbService.saveWhatsAppOrderTracking({
                 session_name: sessionName,
                 sender_id: senderId,
                 product_name: order.product_name,
                 number: customerNumber, 
                 location: order.address,
                 product_quantity: order.quantity,
                 price: order.price
             });
        }

        // --- PRE-SEND CHECK (Race Condition Fix) ---
        // Check again if Admin replied while AI was generating
        const freshHistory = await dbService.getWhatsAppChatHistory(sessionName, senderId, 1);
        if (freshHistory && freshHistory.length > 0) {
            const latest = freshHistory[0];
            // If latest message is from US (sessionName) and NOT bot_reply, it's a human/admin reply
            if (latest.sender_id === sessionName && latest.status !== 'bot_reply') {
                console.log(`[WA] Admin replied while AI was generating. Stopping reply for ${sessionId}.`);
                return;
            }
        }
        // -------------------------------------------

        // --- SEND REPLY ---
        let replyText = aiResponse.reply;

        // Silent Failure Rule
        if (!replyText && (!aiResponse.images || aiResponse.images.length === 0)) {
             console.log(`[WA] No response generated (Silent Failure). Skipping reply.`);
             return;
        }
        
        // --- SMART IMAGE EXTRACTION & CLEANING ---
        if (!aiResponse.images) aiResponse.images = [];
        const extractedImages = [...aiResponse.images]; 

        // 1. STRICT FORMAT: IMAGE: Title | URL
        const strictImageRegex = /IMAGE:\s*(.+?)\s*\|\s*(https?:\/\/[^\s,]+)/gi;
        let strictMatch;
        while ((strictMatch = strictImageRegex.exec(replyText)) !== null) {
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
            replyText = replyText.replace(fullMatch, '').trim();
        }

        // 2. Google Drive Viewer Links (Standalone)
        const driveRegex = /(?:(?:Image|Link|Sobi|Photo|Picture|চিত্র)\s*[:|-]?\s*)?(https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)\/view[^\s,]*)/gi;
        let driveMatch;
        while ((driveMatch = driveRegex.exec(replyText)) !== null) {
             const fullMatch = driveMatch[0];
             const fileId = driveMatch[2];
             const directUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;
             
             if (!extractedImages.some(img => img.url === directUrl)) {
                 extractedImages.push({ url: directUrl, title: 'Image' });
             }
             replyText = replyText.replace(fullMatch, '').trim();
        }
        
        // Update aiResponse with cleaned text and extracted images
        aiResponse.images = extractedImages;

        // Send Text
        let botMessageId = `bot_${Date.now()}`;
        // Duplicate reply guard (10s window)
        const guardKey = `${sessionName}_${senderId}`;
        const normReply = (replyText || '').trim().toLowerCase();
        const lastReply = recentReplyMap.get(guardKey);
        if (lastReply && lastReply.text === normReply && (Date.now() - lastReply.ts) < 10000) {
            console.log(`[WA] Duplicate reply detected for ${guardKey}. Skipping send.`);
        } else {
            if (replyText) {
                const sentMsg = await whatsappService.sendMessage(sessionName, senderId, replyText);
                
                // Track Bot Message ID to prevent self-lock
                if (sentMsg && sentMsg.id) {
                    botMessageIds.add(sentMsg.id);
                    // Clear after 2 minutes
                    setTimeout(() => botMessageIds.delete(sentMsg.id), 2 * 60 * 1000);
                }

                // Log Bot Reply
                await dbService.saveWhatsAppChat({
                    session_name: sessionName,
                    sender_id: sessionName,
                    recipient_id: senderId,
                    message_id: (sentMsg && sentMsg.id) ? sentMsg.id : botMessageId,
                    text: replyText,
                    timestamp: Date.now(),
                    status: 'bot_reply',
                    reply_by: 'bot',
                    token_usage: aiResponse.token_usage || 0,
                    is_group: isGroup
                    // token usage could be saved if schema allows, currently whatsapp_chats doesn't have token col
                });
            }
            recentReplyMap.set(guardKey, { text: normReply, ts: Date.now() });
        }

        // Send Images
        if (aiResponse.images.length > 0) {
            for (const imgObj of aiResponse.images) {
                await whatsappService.sendImage(sessionName, senderId, imgObj.url, imgObj.title);
            }
        }

        await whatsappService.stopTyping(sessionName, senderId);

        // Deduct Credit (WhatsApp Specific)
        // Only deduct if NOT using Own API
        if (!hasOwnKey) {
             await dbService.deductWhatsAppCredit(sessionName, 1);
        }

    } catch (error) {
        console.error("[WA] Error processing event:", error);
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
