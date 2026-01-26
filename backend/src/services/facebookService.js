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

// Check Last Message for Human Handover
async function getConversationMessages(pageId, userId, accessToken, limit = 5) {
    try {
        // Correct endpoint to get messages between Page and User
        // Need to find the conversation ID first or use the user_id scope if allowed
        // Easier way: /me/conversations?user_id={user_id}
        
        const url = `https://graph.facebook.com/v19.0/me/conversations?user_id=${userId}&fields=messages.limit(${limit}){message,from,created_time}&access_token=${accessToken}`;
        
        const response = await axios.get(url);
        
        // Structure: data: [{ messages: { data: [...] } }]
        if (response.data && response.data.data && response.data.data.length > 0) {
             return response.data.data[0].messages.data;
        }
        return [];
    } catch (error) {
        console.error(`Error fetching conversation for ${pageId}:`, error.response ? error.response.data : error.message);
        return [];
    }
}

module.exports = {
    sendMessage,
    sendTypingAction,
    getConversationMessages
};
