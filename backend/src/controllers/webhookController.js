const dbService = require('../services/dbService');
const aiService = require('../services/aiService');
const facebookService = require('../services/facebookService');

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
        messageText = event.postback.payload || event.postback.title;
        console.log(`Received Postback: ${messageText}`);
    }

    // 2. Handle Attachments (Images)
    if (event.message?.attachments) {
        const imageUrls = event.message.attachments
            .filter(att => att.type === 'image')
            .map(att => att.payload.url);
        
        if (imageUrls.length > 0) {
            // Append Image URLs to text for AI context
            // In a more advanced version, we would pass these as actual image objects to the AI
            messageText += `\n[User sent images: ${imageUrls.join(', ')}]`;
        }
        // Handle other attachments (audio, file) placeholders
        const otherAtts = event.message.attachments.filter(att => att.type !== 'image');
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

    const sessionId = `${pageId}_${senderId}`;

    // Initialize buffer if not exists
    if (!debounceMap.has(sessionId)) {
        debounceMap.set(sessionId, { messages: [], timer: null });
    }

    const sessionData = debounceMap.get(sessionId);
    sessionData.messages.push(messageText);

    console.log(`Queued message for ${sessionId}: ${messageText}`);

    // Clear existing timer
    if (sessionData.timer) clearTimeout(sessionData.timer);

    // Set new timer (5 seconds debounce)
    sessionData.timer = setTimeout(() => {
        // Clone messages and clear buffer immediately to allow new messages
        const messagesToProcess = [...sessionData.messages];
        debounceMap.delete(sessionId);
        
        processBufferedMessages(sessionId, pageId, senderId, messagesToProcess);
    }, 5000); 
}

// Core Logic Function (Debounced)
async function processBufferedMessages(sessionId, pageId, senderId, messages) {
    const combinedMessage = messages.join('\n'); // Join fragments
    console.log(`Processing buffered messages for ${sessionId}: ${combinedMessage}`);

    try {
        // 1. Fetch Config
        const pageConfig = await dbService.getPageConfig(pageId);
        
        if (!pageConfig) {
            console.log(`Page ${pageId} not configured.`);
            return;
        }

        if (pageConfig.subscription_status !== 'active' && pageConfig.subscription_status !== 'trial') {
             console.log(`Page ${pageId} subscription inactive.`);
             return;
        }
        
        if (pageConfig.message_credit <= 0) {
            console.log(`Page ${pageId} out of credits.`);
            return;
        }

        // 2. HUMAN HANDOVER & RACE CONDITION CHECK
        // Fetch last 10 messages from real Facebook Thread
        const fbMessages = await facebookService.getConversationMessages(pageId, senderId, pageConfig.page_access_token, 10);
        
        // RULE 1: If the LATEST message in the thread is from the Page, STOP.
        // This handles the race condition where Admin replied during the debounce period.
        if (fbMessages.length > 0) {
            const latestMessage = fbMessages[0]; // Messages are usually sorted newest first
            if (latestMessage.from && latestMessage.from.id === pageId) {
                console.log(`Latest message in thread is from Page (Admin or Bot). Stopping AI for ${sessionId}.`);
                return;
            }
        }
        
        // RULE 2: Check if Admin Replied Recently (Human Handover) - DISABLED FOR NOW to fix "Not Replying" bug
        // We will rely on Rule 1 to prevent double replies.
        /*
        const lastPageMessage = fbMessages.find(m => m.from && m.from.id === pageId);
        if (lastPageMessage) {
             // ... logic ...
        }
        */

        // 3. Send Typing Indicator
        await facebookService.sendTypingAction(senderId, pageConfig.page_access_token, 'typing_on');

        // 4. Get Knowledge Base & Chat History
        const pagePrompts = await dbService.getPagePrompts(pageId);
        const history = await dbService.getChatHistory(sessionId, 10); 

        // 5. Generate AI Reply
        const aiResponse = await aiService.generateReply(combinedMessage, pageConfig, pagePrompts, history);
        
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
        await facebookService.sendMessage(pageId, senderId, replyText, pageConfig.page_access_token);

        // Send Images (if any)
        if (aiResponse.images && Array.isArray(aiResponse.images) && aiResponse.images.length > 0) {
            for (const imageUrl of aiResponse.images) {
                await facebookService.sendImageMessage(pageId, senderId, imageUrl, pageConfig.page_access_token);
            }
        }

        await facebookService.sendTypingAction(senderId, pageConfig.page_access_token, 'typing_off');

        // 7. Save History & Lead
        // Save User Message (Combined)
        await dbService.saveChatMessage(sessionId, 'user', combinedMessage);
        // Save Assistant Reply (Text only)
        await dbService.saveChatMessage(sessionId, 'assistant', replyText);

        await dbService.saveLead({
            page_id: pageId,
            sender_id: senderId,
            message: combinedMessage,
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