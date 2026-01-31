const axios = require('axios');

// WAHA Configuration
const WAHA_BASE_URL = process.env.WAHA_BASE_URL || 'https://wahubbd.salesmanchatbot.online';
const WAHA_API_KEY = process.env.WAHA_API_KEY || 'e9457ca133cc4d73854ee0d43cee3bc5';

const apiClient = axios.create({
    baseURL: WAHA_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': WAHA_API_KEY
    }
});

/**
 * Send Text Message via WAHA
 * @param {string} session - The WhatsApp Session Name (e.g., 'default')
 * @param {string} chatId - The recipient's Chat ID (e.g., '123456789@c.us')
 * @param {string} text - The message text
 * @param {boolean} replyTo - Optional message ID to reply to
 */
async function sendMessage(session, chatId, text, replyTo = null) {
    try {
        const payload = {
            chatId: chatId,
            text: text,
            session: session
        };

        if (replyTo) {
            payload.reply_to = replyTo;
        }

        const response = await apiClient.post('/api/sendText', payload);
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Send Text Error (${session} -> ${chatId}):`, error.message);
        return null;
    }
}

/**
 * Send Image via WAHA
 * @param {string} session 
 * @param {string} chatId 
 * @param {string} imageUrl 
 * @param {string} caption 
 */
async function sendImage(session, chatId, imageUrl, caption) {
    try {
        const payload = {
            chatId: chatId,
            file: {
                mimetype: "image/jpeg", // WAHA often auto-detects, but good to specify if known
                url: imageUrl,
                filename: "image.jpg"
            },
            caption: caption,
            session: session
        };

        const response = await apiClient.post('/api/sendImage', payload);
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Send Image Error:`, error.message);
        return null;
    }
}

/**
 * Send Typing Indicator (Presence)
 * @param {string} session 
 * @param {string} chatId 
 */
async function sendTyping(session, chatId) {
    try {
        // WAHA 'startTyping'
        await apiClient.post('/api/startTyping', {
            session: session,
            chatId: chatId
        });
    } catch (error) {
        // Ignore typing errors (non-critical)
    }
}

/**
 * Stop Typing Indicator
 * @param {string} session 
 * @param {string} chatId 
 */
async function stopTyping(session, chatId) {
    try {
        await apiClient.post('/api/stopTyping', {
            session: session,
            chatId: chatId
        });
    } catch (error) {
        // Ignore
    }
}

/**
 * Get Chat History (if supported by WAHA instance)
 * @param {string} session 
 * @param {string} chatId 
 * @param {number} limit 
 */
async function getMessages(session, chatId, limit = 10) {
    try {
        const response = await apiClient.get('/api/getMessages', {
            params: {
                session: session,
                chatId: chatId,
                limit: limit
            }
        });
        return response.data;
    } catch (error) {
        console.warn(`[WhatsApp] Fetch Messages Error:`, error.message);
        return [];
    }
}

module.exports = {
    sendMessage,
    sendImage,
    sendTyping,
    stopTyping,
    getMessages
};
