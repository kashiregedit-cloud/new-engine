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

async function sendImageMessage(pageId, recipientId, imageUrl, accessToken) {
    try {
        const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${accessToken}`;
        
        const payload = {
            recipient: { id: recipientId },
            message: {
                attachment: {
                    type: "image",
                    payload: { 
                        url: imageUrl, 
                        is_reusable: true 
                    }
                }
            }
        };

        console.log(`Sending Image to ${recipientId} from ${pageId}`);
        const response = await axios.post(url, payload);
        return response.data;
    } catch (error) {
        console.error(`Error sending image for page ${pageId}:`, error.response ? error.response.data : error.message);
        throw error;
    }
}

// Reply to a Comment (Private or Public)
async function replyToComment(commentId, message, accessToken) {
    try {
        // Public Reply (reply to the comment thread)
        const url = `https://graph.facebook.com/v19.0/${commentId}/comments?access_token=${accessToken}`;
        
        console.log(`Replying to comment ${commentId}`);
        const response = await axios.post(url, { message: message });
        return response.data;
    } catch (error) {
        console.error(`Error replying to comment ${commentId}:`, error.response ? error.response.data : error.message);
        throw error;
    }
}

// Get Comment Replies (to check if already replied)
async function getCommentReplies(commentId, accessToken) {
    try {
        const url = `https://graph.facebook.com/v19.0/${commentId}/comments?access_token=${accessToken}`;
        const response = await axios.get(url);
        return response.data.data || [];
    } catch (error) {
        console.error(`Error getting comment replies ${commentId}:`, error.response ? error.response.data : error.message);
        return [];
    }
}

// Get User Profile (Name)
async function getUserProfile(userId, accessToken) {
    try {
        const url = `https://graph.facebook.com/v19.0/${userId}?fields=first_name,last_name,name&access_token=${accessToken}`;
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        // console.error(`Error fetching user profile ${userId}:`, error.message);
        // Fail silently, return default
        return { name: 'Customer' };
    }
}

module.exports = {
    sendMessage,
    sendImageMessage,
    sendTypingAction,
    getConversationMessages,
    replyToComment,
    getCommentReplies,
    getUserProfile
};
