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
    const session = body.session; // This acts as 'page_id'
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
    }
};

// Queue Message for Debounce
async function queueMessage(session, messagePayload) {
    const senderId = messagePayload.from; // e.g., 12345678@c.us
    const pageId = session; // Using WAHA Session as Page ID
    let messageText = messagePayload.body || '';
    const messageId = messagePayload.id;

    const logMsg = `[WA Webhook] Received Message. Session: ${pageId}, Sender: ${senderId}, Text: "${messageText.substring(0, 50)}..."`;
    console.log(logMsg);
    logToFile(logMsg);

    // Handle Images/Media (If WAHA exposes URL)
    // Note: WAHA might return 'mediaUrl' or we might need to fetch it.
    // For now, we look for payload.mediaUrl or similar if provided by WAHA's 'download media' option.
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

    // Check Duplicate immediately
    const isDuplicate = await dbService.checkDuplicate(messageId);
    if (isDuplicate) {
        console.log(`[WA] Duplicate message ${messageId} ignored.`);
        return;
    }

    // --- SAVE USER MESSAGE TO fb_chats (Immediate - Raw) ---
    // We reuse fb_chats table. page_id = session.
    try {
        await dbService.saveFbChat({
            page_id: pageId,
            sender_id: senderId,
            recipient_id: pageId,
            message_id: messageId,
            text: messageText,
            timestamp: Date.now(),
            status: 'received',
            reply_by: 'user'
        });
    } catch (err) {
        console.error("Error saving to fb_chats (WA):", err.message);
    }

    const sessionId = `${pageId}_${senderId}`;

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

    // Dynamic Debounce
    const pagePrompts = await dbService.getPagePrompts(pageId);
    let debounceTime = 8000; // Default 8s
    if (pagePrompts && pagePrompts.wait) {
        debounceTime = Number(pagePrompts.wait) * 1000;
    }
    if (debounceTime < 1000) debounceTime = 1000;

    sessionData.timer = setTimeout(() => {
        const messagesToProcess = [...sessionData.messages];
        debounceMap.delete(sessionId);
        processBufferedMessages(sessionId, pageId, senderId, messagesToProcess);
    }, debounceTime); 
}

// Core Logic Function (Debounced)
async function processBufferedMessages(sessionId, pageId, senderId, messages) {
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
        // 1. Fetch Config
        const pageConfig = await dbService.getPageConfig(pageId);
        
        if (!pageConfig) {
            console.log(`[WA] Session/Page ${pageId} not configured.`);
            return;
        }

        if (pageConfig.subscription_status !== 'active' && pageConfig.subscription_status !== 'trial') {
             console.log(`[WA] Page ${pageId} subscription inactive.`);
             return;
        }
        
        if (pageConfig.message_credit <= 0) {
            console.log(`[WA] Page ${pageId} out of credits.`);
            return;
        }

        // --- FETCH CONTEXT ---
        const historyLimit = 20;
        const [pagePrompts, history] = await Promise.all([
            dbService.getPagePrompts(pageId),
            dbService.getChatHistory(sessionId, historyLimit),
            whatsappService.sendTyping(pageId, senderId) // Typing indicator
        ]);

        const senderName = 'Customer'; // WAHA payload usually has pushName, but we simplified. Could fetch from payload if stored.

        // Batch Processing (Images/Audio) - Logic same as webhookController
        if (allImages.length > 0) {
            if (pagePrompts && pagePrompts.image_detection) {
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
        if (pagePrompts) {
            if (!pagePrompts.reply_message) {
                console.log(`[WA] Reply Message disabled for ${pageId}.`);
                return;
            }
        }

        // --- STOP EMOJI CHECK ---
        const blockEmoji = pagePrompts?.block_emoji;
        const unblockEmoji = pagePrompts?.unblock_emoji;

        if (blockEmoji) {
            // Fetch recent chat history from DB to check for block/unblock emojis
            // We use fb_chats because it stores all messages (user + bot + admin if logged)
            const chatHistory = await dbService.getFbChatHistory(pageId, senderId, 20);
            
            let lastBlockTime = 0;
            let lastUnblockTime = 0;

            // Check current buffered messages first (most recent)
            if (combinedText.includes(blockEmoji)) {
                lastBlockTime = Date.now();
            }

            // Check history
            for (const msg of chatHistory) {
                const isFromPage = msg.sender_id === pageId || msg.reply_by === 'bot' || msg.reply_by === 'admin';
                if (isFromPage) {
                    const content = msg.text || '';
                    const msgTime = new Date(msg.timestamp).getTime();

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
        const finalUserMessage = combinedText; // Add replyContext logic if needed
        
        // Inject Formatting
        if (pagePrompts && pagePrompts.text_prompt) {
             pagePrompts.text_prompt += `\n\n[IMPORTANT OUTPUT RULES]\n1. Use WhatsApp Formatting (*Bold*, _Italic_, ~Strike~).\n2. Keep it concise.\n3. **STRICT IMAGE FORMAT**: 'IMAGE: Title | URL'`;
        }

        const aiResponse = await aiService.generateReply(finalUserMessage, pageConfig, pagePrompts, history, senderName);

        // --- ORDER TRACKING ---
        if (aiResponse.order_details && aiResponse.order_details.product_name) {
             const order = aiResponse.order_details;
             let customerNumber = order.phone ? order.phone.replace(/\D/g, '') : senderId.replace(/\D/g, ''); // WA ID is phone
             
             await dbService.saveOrderTracking({
                 page_id: pageId,
                 sender_id: senderId,
                 product_name: order.product_name,
                 number: customerNumber, 
                 location: order.address,
                 product_quantity: order.quantity,
                 price: order.price
             });
        }

        // --- SEND REPLY ---
        let replyText = aiResponse.reply || "Sorry, I couldn't generate a response.";
        
        // Extract Images
        if (!aiResponse.images) aiResponse.images = [];
        
        // Send Text
        let botMessageId = `bot_${Date.now()}`;
        if (replyText) {
            await whatsappService.sendMessage(pageId, senderId, replyText);
            
            // Log Bot Reply
            await dbService.saveFbChat({
                page_id: pageId,
                sender_id: pageId,
                recipient_id: senderId,
                message_id: botMessageId,
                text: replyText,
                timestamp: Date.now(),
                status: 'bot_reply',
                reply_by: 'bot',
                token: aiResponse.token_usage || 0,
                ai_model: aiResponse.model || null
            });
        }

        // Send Images
        if (aiResponse.images.length > 0) {
            for (const imgObj of aiResponse.images) {
                await whatsappService.sendImage(pageId, senderId, imgObj.url, imgObj.title);
            }
        }

        await whatsappService.stopTyping(pageId, senderId);

        // Save History
        await dbService.saveChatMessage(sessionId, 'user', finalUserMessage);
        await dbService.saveChatMessage(sessionId, 'assistant', replyText);
        await dbService.saveLead({
            page_id: pageId,
            sender_id: senderId,
            message: finalUserMessage,
            reply: replyText
        });

        // Deduct Credit
        await dbService.deductCredit(pageId, pageConfig.message_credit);

    } catch (error) {
        console.error("[WA] Error processing event:", error);
    }
}

module.exports = {
    handleWebhook
};
