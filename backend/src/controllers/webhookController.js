const dbService = require('../services/dbService');
const aiService = require('../services/aiService');
const facebookService = require('../services/facebookService');

// Step 1: Webhook Trigger
// Step 6: Orchestration
const handleWebhook = async (req, res) => {
    const body = req.body;
    console.log('Webhook Body Received:', JSON.stringify(body, null, 2));

    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');

        // Async Processing
        for (const entry of body.entry) {
            const webhookEvent = entry.messaging ? entry.messaging[0] : null;
            
            if (webhookEvent) {
                await processEvent(webhookEvent);
            }
        }
    } else {
        res.sendStatus(404);
    }
};

const verifyWebhook = (req, res) => {
    const VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN || '123456'; // Default from n8n.json

    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            console.error('WEBHOOK_VERIFICATION_FAILED: Token mismatch or wrong mode', { 
                received_token: token, 
                expected_token: VERIFY_TOKEN,
                mode 
            });
            res.sendStatus(403);
        }
    } else {
        console.error('WEBHOOK_VERIFICATION_FAILED: Missing mode or token');
        res.sendStatus(400);
    }
};

// Core Logic Function
async function processEvent(event) {
    const senderId = event.sender.id;
    const pageId = event.recipient.id;
    const messageText = event.message?.text;
    
    if (!messageText) return; // Ignore non-text for now (or handle images later)
    
    // Duplicate Check (Step 5 Enhancement)
    const messageId = event.message.mid;
    const isDuplicate = await dbService.checkDuplicate(messageId);
    if (isDuplicate) {
        console.log(`Duplicate message ${messageId} ignored.`);
        return;
    }

    console.log(`Received message from ${senderId} to page ${pageId}: ${messageText}`);

    try {
        // 1. Fetch Config (Step 7: Multi-Tenant)
        const pageConfig = await dbService.getPageConfig(pageId);
        
        if (!pageConfig) {
            console.log(`Page ${pageId} not configured.`);
            return;
        }

        // Check Subscription / Credits
        if (pageConfig.subscription_status !== 'active' && pageConfig.subscription_status !== 'trial') {
             console.log(`Page ${pageId} subscription inactive.`);
             return;
        }
        
        if (pageConfig.message_credit <= 0) {
            console.log(`Page ${pageId} out of credits.`);
            return;
        }

        // 2. Send Typing Indicator (Human Touch)
        await facebookService.sendTypingAction(senderId, pageConfig.page_access_token, 'typing_on');

        // 3. Get Knowledge Base
        const pagePrompts = await dbService.getPagePrompts(pageId);

        // 4. Generate AI Reply (Step 2 & 3)
        const aiReply = await aiService.generateReply(messageText, pageConfig, pagePrompts);
        
        // 5. Send Reply (Step 4)
        await facebookService.sendMessage(pageId, senderId, aiReply, pageConfig.page_access_token);
        
        // Turn off typing
        await facebookService.sendTypingAction(senderId, pageConfig.page_access_token, 'typing_off');

        // 6. Save Lead / Log (Step 5)
        await dbService.saveLead({
            page_id: pageId,
            sender_id: senderId,
            message: messageText,
            reply: aiReply
        });

        // 7. Deduct Credit
        await dbService.deductCredit(pageId, pageConfig.message_credit);

    } catch (error) {
        console.error("Error processing event:", error);
    }
}

module.exports = {
    handleWebhook,
    verifyWebhook
};
