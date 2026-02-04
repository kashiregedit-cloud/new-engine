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
        // Ignore messages sent BY the bot (fromMe)
        if (payload.fromMe) return;

        // Ignore Status Updates (broadcasts)
        if (payload.from === 'status@broadcast') return;

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
    }
};

// Queue Message for Debounce
async function queueMessage(session, messagePayload) {
    const senderId = messagePayload.from; // e.g., 12345678@c.us
    const sessionName = session; // Using WAHA Session as Session Name
    let messageText = messagePayload.body || '';
    const messageId = messagePayload.id;

    const logMsg = `[WA Webhook] Received Message. Session: ${sessionName}, Sender: ${senderId}, Text: "${messageText.substring(0, 50)}..."`;
    console.log(logMsg);
    logToFile(logMsg);

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
            reply_by: 'user'
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

    for (const msg of messages) {
        if (msg.text) combinedText += msg.text + "\n";
        if (msg.reply_to) replyToId = msg.reply_to; 
        if (msg.images && msg.images.length > 0) allImages.push(...msg.images);
        if (msg.audios && msg.audios.length > 0) allAudios.push(...msg.audios);
    }
    combinedText = combinedText.trim();
    console.log(`[WA] Processing buffered. Text: ${combinedText.substring(0,50)}...`);

    try {
        // 1. Fetch Config (WhatsApp Specific)
        const pageConfig = await dbService.getWhatsAppConfig(sessionName);
        
        if (!pageConfig) {
            console.log(`[WA] Session ${sessionName} not configured.`);
            return;
        }

        // 2. Check Subscription/Credit & Gatekeeper
        const validStatuses = ['active', 'trial', 'active_trial', 'active_paid'];
        if (!validStatuses.includes(pageConfig.subscription_status)) {
             console.log(`[WA] Session ${sessionName} subscription inactive (Status: ${pageConfig.subscription_status}).`);
             return;
        }

        // Gatekeeper Logic: Allow if Own API is used, otherwise require Credit
        const hasOwnKey = (pageConfig.api_key && pageConfig.api_key.length > 5 && pageConfig.cheap_engine === false);

        if (hasOwnKey) {
             console.log(`[WA] Session ${sessionName} using Own API. Gatekeeper ALLOW.`);
        } else {
             if (pageConfig.message_credit <= 0) {
                 console.log(`[WA] Session ${sessionName} blocked by Gatekeeper (No Credit & No Own API).`);
                 return;
             }
        }

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
             pageConfig.text_prompt += `\n\n[IMPORTANT OUTPUT RULES]\n1. Use WhatsApp Formatting (*Bold*, _Italic_, ~Strike~).\n2. Keep it concise.\n3. **STRICT IMAGE FORMAT**: 'IMAGE: Title | URL'`;
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

        // --- SEND REPLY ---
        let replyText = aiResponse.reply;

        // Silent Failure Rule
        if (!replyText && (!aiResponse.images || aiResponse.images.length === 0)) {
             console.log(`[WA] No response generated. Skipping reply.`);
             return;
        }
        
        // Extract Images
        if (!aiResponse.images) aiResponse.images = [];
        
        // Send Text
        let botMessageId = `bot_${Date.now()}`;
        if (replyText) {
            await whatsappService.sendMessage(sessionName, senderId, replyText);
            
            // Log Bot Reply
            await dbService.saveWhatsAppChat({
                session_name: sessionName,
                sender_id: sessionName,
                recipient_id: senderId,
                message_id: botMessageId,
                text: replyText,
                timestamp: Date.now(),
                status: 'bot_reply',
                reply_by: 'bot'
                // token usage could be saved if schema allows, currently whatsapp_chats doesn't have token col
            });
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
