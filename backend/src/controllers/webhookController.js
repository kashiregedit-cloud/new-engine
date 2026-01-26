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
            const webhookEvent = entry.messaging ? entry.messaging[0] : null;
            
            if (webhookEvent) {
                // await processEvent(webhookEvent); // Old immediate processing
                await queueMessage(webhookEvent);    // New debounced processing
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
    const messageText = event.message?.text;
    const messageId = event.message?.mid;

    if (!messageText) return; // Ignore non-text

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
        const aiReply = await aiService.generateReply(combinedMessage, pageConfig, pagePrompts, history);
        
        // 6. Send Reply
        await facebookService.sendMessage(pageId, senderId, aiReply, pageConfig.page_access_token);
        await facebookService.sendTypingAction(senderId, pageConfig.page_access_token, 'typing_off');

        // 7. Save History & Lead
        // Save User Message (Combined)
        await dbService.saveChatMessage(sessionId, 'user', combinedMessage);
        // Save Assistant Reply
        await dbService.saveChatMessage(sessionId, 'assistant', aiReply);

        await dbService.saveLead({
            page_id: pageId,
            sender_id: senderId,
            message: combinedMessage,
            reply: aiReply
        });

        // 8. Deduct Credit
        await dbService.deductCredit(pageId, pageConfig.message_credit);

    } catch (error) {
        console.error("Error processing event:", error);
    }
}

module.exports = {
    handleWebhook,
    verifyWebhook
};