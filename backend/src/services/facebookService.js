const axios = require('axios');

// Step 4: HTTP Request to Send Message
async function sendMessage(pageId, recipientId, text, accessToken) {
    try {
        const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${accessToken}`;
        
        // Payload Builder (Step 3)
        const payload = {
            recipient: { id: recipientId },
            message: { text: text }
        };

        console.log(`Sending FB Message to ${recipientId} from ${pageId}`);
        
        const response = await axios.post(url, payload);
        return response.data;
    } catch (error) {
        console.error(`Error sending FB message for page ${pageId}:`, error.response ? error.response.data : error.message);
        throw error;
    }
}

// Human AI Agent Trick: Typing Indicator
async function sendTypingAction(recipientId, accessToken, action = 'typing_on') {
    try {
        const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${accessToken}`;
        await axios.post(url, {
            recipient: { id: recipientId },
            sender_action: action
        });
    } catch (error) {
        // Ignore typing errors, not critical
    }
}

module.exports = {
    sendMessage,
    sendTypingAction
};
