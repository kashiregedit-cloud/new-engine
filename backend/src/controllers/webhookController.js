const dbService = require('../services/dbService');
const aiService = require('../services/aiService');
const facebookService = require('../services/facebookService');
const fs = require('fs');
const path = require('path');

// Helper to log to file
function logToFile(message) {
    const logPath = path.join(__dirname, '../../debug.log');
    const timestamp = new Date().toISOString();
    try {
        fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
    } catch (e) {
        console.error('Log Error:', e);
    }
}

// Global Debounce Map (In-Memory)
// Key: sessionId (pageId_senderId)
// Value: { timer: NodeJS.Timeout, messages: string[] }
const debounceMap = new Map();

// Step 1: Webhook Trigger
const handleWebhook = async (req, res) => {
    const body = req.body;
    // console.log('Webhook Body Received:', JSON.stringify(body, null, 2)); // Too verbose for production

    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');

        // Async Processing
        for (const entry of body.entry) {
            // 1. Handle Messaging Events (Direct Messages)
            if (entry.messaging) {
                const webhookEvent = entry.messaging[0];
                if (webhookEvent) {
                    await queueMessage(webhookEvent);
                }
            }
            
            // 2. Handle Changes Events (Comments / Feed)
            if (entry.changes) {
                for (const change of entry.changes) {
                    if (change.field === 'feed') {
                        await processCommentEvent(change.value);
                    }
                }
            }
        }
    } else {
        res.sendStatus(404);
    }
};

const verifyWebhook = (req, res) => {
    const VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN || '123456'; 

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            console.error('WEBHOOK_VERIFICATION_FAILED');
            res.sendStatus(403);
        }
    } else {
        res.sendStatus(400);
    }
};

// Queue Message for Debounce
async function queueMessage(event) {
    const senderId = event.sender.id;
    const pageId = event.recipient.id;
    let messageText = event.message?.text || '';
    const messageId = event.message?.mid || `evt_${Date.now()}`;

    // 1. Handle Postback (Button Clicks)
    if (event.postback) {
        // PRIORITIZE PAYLOAD, THEN TITLE. Ensure it's a string.
        messageText = event.postback.payload || event.postback.title || '';
        if (typeof messageText !== 'string') {
            messageText = JSON.stringify(messageText);
        }
        const logMsg = `[Webhook] Received Postback. Page: ${pageId}, Sender: ${senderId}, Payload: ${messageText}`;
        console.log(logMsg);
        logToFile(logMsg);
    } else {
        const logMsg = `[Webhook] Received Message. Page: ${pageId}, Sender: ${senderId}, Text: ${messageText}`;
        console.log(logMsg);
        logToFile(logMsg);
    }

    // 2. Handle Attachments (Images)
    if (event.message?.attachments) {
        const imageUrls = event.message.attachments
            .filter(att => att.type === 'image')
            .map(att => att.payload.url);
        
        if (imageUrls.length > 0) {
            // Process Images with Vision AI if enabled
            try {
                const pageConfig = await dbService.getPageConfig(pageId);
                const pagePrompts = await dbService.getPagePrompts(pageId); // Fetch from fb_message_database
                
                console.log(`[Webhook] Image received. Page: ${pageId}. Image Analysis Enabled (DB): ${pagePrompts?.image_detection}`);

                // Check if image analysis is enabled in page prompts (fb_message_database)
                if (pagePrompts && pagePrompts.image_detection) {
                    const descriptions = [];
                    console.log(`[Webhook] Starting analysis for ${imageUrls.length} images...`);
                    
                    for (const url of imageUrls) {
                        // Loop through images and analyze using chat model
                        console.log(`[Webhook] Analyzing image: ${url}`);
                        const desc = await aiService.processImageWithVision(url, pageConfig);
                        console.log(`[Webhook] Analysis result: ${desc}`);
                        descriptions.push(desc);
                    }
                    
                    // Append analysis result to message text
                    // The prompt ensures it starts with "Based on the image this is..."
                    if (descriptions.length > 0) {
                        const analysisText = descriptions.join('\n');
                        // Store the analysis result in messageText so it flows into the AI context
                        // The user wants this to be the "total summary content"
                        if (messageText) {
                            messageText += `\n${analysisText}`;
                        } else {
                            messageText = analysisText;
                        }
                        console.log(`[Webhook] Final Message Text with Analysis: ${messageText}`);
                    }
                } else {
                     // Fallback: Just append URLs if analysis is disabled or config missing
                     console.log('[Webhook] Image analysis disabled or config missing. Appending URLs.');
                     messageText += `\n[User sent images: ${imageUrls.join(', ')}]`;
                }
            } catch (err) {
                console.error("Image Processing Error:", err);
                messageText += `\n[User sent images: ${imageUrls.join(', ')}]`;
            }
        }
        
        // 3. Handle Audio (Voice Messages)
        const audioUrls = event.message.attachments
            .filter(att => att.type === 'audio')
            .map(att => att.payload.url);
            
        if (audioUrls.length > 0) {
            console.log(`[Webhook] Audio received. Count: ${audioUrls.length}`);
            try {
                // Fetch Page Config for API Keys
                const pageConfig = await dbService.getPageConfig(pageId);
                
                for (const url of audioUrls) {
                     // Transcribe
                     const transcription = await aiService.transcribeAudio(url, pageConfig);
                     if (messageText) {
                         messageText += `\n${transcription}`;
                     } else {
                         messageText = transcription;
                     }
                }
                console.log(`[Webhook] Final Message Text with Audio: ${messageText}`);
            } catch (err) {
                console.error("Audio Processing Error:", err);
                messageText += `\n[User sent voice message (Processing Failed)]`;
            }
        }

        // Handle other attachments (file, video) placeholders
        const otherAtts = event.message.attachments.filter(att => att.type !== 'image' && att.type !== 'audio');
        if (otherAtts.length > 0) {
             messageText += `\n[User sent attachments: ${otherAtts.map(a => a.type).join(', ')}]`;
        }
    }

    if (!messageText) return; // Ignore if still empty

    // Check Duplicate immediately to avoid processing same message twice
    const isDuplicate = await dbService.checkDuplicate(messageId);
    if (isDuplicate) {
        console.log(`Duplicate message ${messageId} ignored.`);
        return;
    }

    const replyToId = event.message?.reply_to?.mid || null;

    // --- SAVE USER MESSAGE TO fb_chats (Immediate) ---
    // This ensures every incoming message (including Swipe/Postback) is logged.
    try {
        await dbService.saveFbChat({
            page_id: pageId,
            sender_id: senderId,
            recipient_id: pageId,
            message_id: messageId,
            text: messageText,
            // reply_to: replyToId, // Removed because fb_chats table doesn't have this column
            timestamp: Date.now(),
            status: 'received',
            reply_by: 'user'
        });
    } catch (err) {
        console.error("Error saving to fb_chats (non-blocking):", err.message);
    }
    // -------------------------------------------------

    const sessionId = `${pageId}_${senderId}`;

    // Initialize buffer if not exists
    if (!debounceMap.has(sessionId)) {
        debounceMap.set(sessionId, { messages: [], timer: null });
    }

    const sessionData = debounceMap.get(sessionId);
    // Push Object instead of String to preserve metadata
    sessionData.messages.push({
        text: messageText,
        reply_to: replyToId,
        images: event.message?.attachments?.filter(att => att.type === 'image').map(att => att.payload.url) || [],
        isPostback: !!event.postback
    });

    console.log(`Queued message for ${sessionId}: ${messageText}`);
    if (!sessionData.timer) {
        sessionData.timer = setTimeout(() => {
            // Clone messages and clear buffer immediately to allow new messages
            const messagesToProcess = [...sessionData.messages];
            debounceMap.delete(sessionId);
            
            processBufferedMessages(sessionId, pageId, senderId, messagesToProcess);
        }, 3000); // 3 seconds
    }
}

// Core Logic Function (Debounced)
async function processBufferedMessages(sessionId, pageId, senderId, messages) {
    // Reconstruct Combined Message & Extract Metadata
    let combinedText = "";
    let replyToId = null;
    let allImages = [];
    let hasPostback = false;

    for (const msg of messages) {
        if (typeof msg === 'string') {
            // Handle legacy string format (just in case)
            combinedText += msg + "\n";
        } else {
            combinedText += msg.text + "\n";
            if (msg.reply_to) replyToId = msg.reply_to; // Capture the last reply_to ID
            if (msg.images && msg.images.length > 0) allImages.push(...msg.images);
            if (msg.isPostback) hasPostback = true;
        }
    }
    combinedText = combinedText.trim();
    console.log(`Processing buffered messages for ${sessionId}: ${combinedText}`);

    try {
        // 1. Fetch Config
        const pageConfig = await dbService.getPageConfig(pageId);
        
        console.log("Config fetched:", pageConfig ? "Found" : "Null");
        
        if (!pageConfig) {
            const logMsg = `Page ${pageId} not configured.`;
            console.log(logMsg);
            logToFile(logMsg);
            return;
        }

        if (pageConfig.subscription_status !== 'active' && pageConfig.subscription_status !== 'trial') {
             const logMsg = `Page ${pageId} subscription inactive.`;
             console.log(logMsg);
             logToFile(logMsg);
             return;
        }
        
        if (pageConfig.message_credit <= 0) {
            const logMsg = `Page ${pageId} out of credits.`;
            console.log(logMsg);
            logToFile(logMsg);
            return;
        }

        // 2. HUMAN HANDOVER & RACE CONDITION CHECK
        console.log("Checking human handover...");
        // Fetch last 10 messages from real Facebook Thread
        const fbMessages = await facebookService.getConversationMessages(pageId, senderId, pageConfig.page_access_token, 10);
        
        // 3. Send Typing Indicator
        console.log("Sending typing...");
        await facebookService.sendTypingAction(senderId, pageConfig.page_access_token, 'typing_on');

        // 4. Get Knowledge Base & Chat History
        console.log("Fetching prompts...");
        const pagePrompts = await dbService.getPagePrompts(pageId);
        
        // --- FEATURE FLAGS CHECK ---
        if (pagePrompts) {
            // Check based on message type
            if (hasPostback) {
                // It's a Swipe/Postback
                if (!pagePrompts.swipe_reply) {
                    const logMsg = `[AI] Swipe Reply disabled (swipe_reply=false) for page ${pageId}. Ignoring.`;
                    console.log(logMsg);
                    logToFile(logMsg);
                    return;
                }
            } else {
                // It's a Text Message
                if (!pagePrompts.reply_message) {
                    const logMsg = `[AI] Reply Message disabled (reply_message=false) for page ${pageId}. Ignoring.`;
                    console.log(logMsg);
                    logToFile(logMsg);
                    return;
                }
            }
        }

        // Debugging: Log Prompt Info
        if (pagePrompts) {
             const logMsg = `[AI] Loaded Prompts for ${pageId}. Text Prompt: "${pagePrompts.text_prompt?.substring(0, 50)}..."`;
             console.log(logMsg);
             logToFile(logMsg);
        } else {
             const logMsg = `[AI] No Prompts found for ${pageId}. Using Default.`;
             console.log(logMsg);
             logToFile(logMsg);
        }

        // --- FETCH SENDER NAME ---
        const userProfile = await facebookService.getUserProfile(senderId, pageConfig.page_access_token);
        const senderName = userProfile.name || 'Customer';
        // -------------------------
        
        // Dynamic History Limit from DB (check_conversion) or default 10
        let historyLimit = 10;
        if (pagePrompts?.check_conversion) {
            historyLimit = Number(pagePrompts.check_conversion);
        }
        
        const history = await dbService.getChatHistory(sessionId, historyLimit); 

        // --- STOP EMOJI CHECK (Dynamic Logic via Graph API) ---
        const blockEmoji = pagePrompts?.block_emoji;
        const unblockEmoji = pagePrompts?.unblock_emoji;

        if (blockEmoji) {
            let lastBlockTime = 0;
            let lastUnblockTime = 0;
            
            for (const msg of fbMessages) {
                // Check if message is from PAGE (Admin or Bot)
                if (msg.from && msg.from.id === pageId) {
                     const content = msg.message || '';
                     const msgTime = new Date(msg.created_time).getTime();
                     
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
                      const logMsg = `[Stop Logic] Active Block Emoji (${blockEmoji}) detected from Page. AI Halted.`;
                      console.log(logMsg);
                      logToFile(logMsg);
                      return;
                 }
            }
        }
        // ---------------------------------------

        // --- REPLY TO LOGIC ---
        // User Instruction: Try to find old message by message_id from fb_chats first.
        // If not found, keep it null (no fallback to FB API).
        let replyContext = "";
        if (replyToId) {
            const originalText = await dbService.getMessageById(replyToId);
            if (originalText) {
                // DETECT IMAGE ANALYSIS CONTEXT
                // If the user is replying to a message that contains "Based on the image",
                // we must explicitly tell the AI that this text IS the image content.
                if (originalText.includes("Based on the image") || originalText.includes("[User sent images:")) {
                    replyContext = `\n[System Note: The user is replying to an image. The AI cannot see the image again, but here is the analysis/description of that image: "${originalText}". Answer the user's question assuming this text is what they are looking at.]\n`;
                } else {
                    replyContext = `\n[User Replying To: "${originalText}"]`;
                }
            }
        }
        
        // Construct Final Message for AI
        const finalUserMessage = `${replyContext}${combinedText}`;
        // ------------------------------------

        // 5. Generate AI Reply
        // Use finalUserMessage which includes reply context
        const aiResponse = await aiService.generateReply(finalUserMessage, pageConfig, pagePrompts, history, senderName);
        
        // --- PRE-SEND CHECK (n8n "IfPageReplyExists" Logic) ---
        // Check again if Admin replied while AI was generating (Race Condition Fix)
        const freshFbMessages = await facebookService.getConversationMessages(pageId, senderId, pageConfig.page_access_token, 1);
        if (freshFbMessages.length > 0) {
            const latestFresh = freshFbMessages[0];
            if (latestFresh.from && latestFresh.from.id === pageId) {
                console.log(`Admin replied while AI was generating. Stopping reply for ${sessionId}.`);
                return;
            }
        }
        // -------------------------------------------------------

        // 6. Send Reply (Text + Images)
        const replyText = aiResponse.reply || "Sorry, I couldn't generate a response.";
        
        // Send Text
        const sendResult = await facebookService.sendMessage(pageId, senderId, replyText, pageConfig.page_access_token);
        const botMessageId = sendResult?.message_id || `bot_${Date.now()}`;

        // --- SAVE BOT REPLY TO fb_chats ---
        await dbService.saveFbChat({
            page_id: pageId,
            sender_id: pageId, // Bot is sender
            recipient_id: senderId,
            message_id: botMessageId,
            text: replyText,
            timestamp: Date.now(),
            status: 'bot_reply',
            reply_by: 'bot'
        });
        // ----------------------------------

        // Send Images (if any)
        if (aiResponse.images && Array.isArray(aiResponse.images) && aiResponse.images.length > 0) {
            for (const imageUrl of aiResponse.images) {
                await facebookService.sendImageMessage(pageId, senderId, imageUrl, pageConfig.page_access_token);
            }
        }

        await facebookService.sendTypingAction(senderId, pageConfig.page_access_token, 'typing_off');

        // 7. Save History & Lead
        // Save User Message (Combined with Context)
        await dbService.saveChatMessage(sessionId, 'user', finalUserMessage);
        // Save Assistant Reply (Text only)
        await dbService.saveChatMessage(sessionId, 'assistant', replyText);

        await dbService.saveLead({
            page_id: pageId,
            sender_id: senderId,
            message: finalUserMessage,
            reply: replyText
        });

        // 8. Deduct Credit
        await dbService.deductCredit(pageId, pageConfig.message_credit);

    } catch (error) {
        console.error("Error processing event:", error);
    }
}

// Handle Comments (n8n "OnComment" Logic)
async function processCommentEvent(changeValue) {
    try {
        if (changeValue.item !== 'comment' || changeValue.verb !== 'add') return;

        const commentId = changeValue.comment_id;
        const message = changeValue.message;
        const senderId = changeValue.from?.id;
        const senderName = changeValue.from?.name || 'Unknown';
        const postId = changeValue.post_id;
        const pageId = postId.split('_')[0]; // Extract Page ID from Post ID

        // Ignore if sender is the page itself
        if (senderId === pageId) return;

        console.log(`Processing comment ${commentId} from ${senderName}: ${message}`);

        // 1. Save to DB (Avoid Duplicates)
        await dbService.saveFbComment({
            comment_id: commentId,
            page_id: pageId,
            sender_id: senderId,
            post_id: postId,
            message: message,
            status: 'received'
        });

        // 2. Fetch Config
        const pageConfig = await dbService.getPageConfig(pageId);
        if (!pageConfig || (pageConfig.subscription_status !== 'active' && pageConfig.subscription_status !== 'trial')) {
             console.log(`Page ${pageId} inactive or not found.`);
             return;
        }

        if (pageConfig.message_credit <= 0) {
            console.log(`Page ${pageId} out of credits for comments.`);
            return;
        }

        // 3. Generate AI Reply
        // Use a simplified prompt for comments (or same as chat)
        const pagePrompts = await dbService.getPagePrompts(pageId);
        
        // Pass "COMMENT_CONTEXT" to help AI understand
        const aiResponse = await aiService.generateReply(
            `[User Commented on Post]: ${message}`, 
            pageConfig, 
            pagePrompts, 
            [] // No history for comments usually, just single turn
        );

        const replyText = aiResponse.reply;

        if (!replyText) return;

        // 4. Reply to Comment
        await facebookService.replyToComment(commentId, replyText, pageConfig.page_access_token);
        
        // 5. Update DB Status
        await dbService.saveFbComment({
            comment_id: commentId,
            reply_text: replyText,
            status: 'replied'
        });

        // 6. Deduct Credit
        await dbService.deductCredit(pageId, pageConfig.message_credit);
        
        console.log(`Replied to comment ${commentId}`);

    } catch (error) {
        console.error("Error processing comment:", error);
    }
}

module.exports = {
    handleWebhook,
    verifyWebhook
};