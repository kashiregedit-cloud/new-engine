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
        // Auto-detect mimetype from URL extension
        let mimetype = "image/jpeg";
        if (imageUrl.endsWith(".png")) mimetype = "image/png";
        else if (imageUrl.endsWith(".webp")) mimetype = "image/webp";
        else if (imageUrl.endsWith(".gif")) mimetype = "image/gif";
        
        const payload = {
            chatId: chatId,
            file: {
                mimetype: mimetype,
                url: imageUrl,
                filename: "image" + (imageUrl.split('.').pop() || ".jpg")
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
 * Send Seen Status (Mark as Read)
 * @param {string} session 
 * @param {string} chatId 
 */
async function sendSeen(session, chatId) {
    try {
        await apiClient.post('/api/sendSeen', {
            session: session,
            chatId: chatId
        });
    } catch (error) {
        // Ignore errors
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

/**
 * Get All Sessions (WAHA)
 */
async function getSessions(all = false) {
    try {
        const response = await apiClient.get(`/api/sessions?all=${all}`);
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Get Sessions Error:`, error.message);
        return [];
    }
}

/**
 * Get Single Session Info (WAHA)
 */
async function getSession(sessionName) {
    try {
        const response = await apiClient.get(`/api/sessions/${sessionName}`);
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Get Session Error:`, error.message);
        return null;
    }
}

/**
 * Create New Session (WAHA)
 */
async function createSession(payload) {
    try {
        const response = await apiClient.post('/api/sessions', payload);
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Create Session Error:`, error.message);
        throw error;
    }
}

/**
 * Delete Session (WAHA)
 */
async function deleteSession(sessionName) {
    try {
        const response = await apiClient.delete(`/api/sessions/${sessionName}`);
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Delete Session Error:`, error.message);
        throw error;
    }
}

/**
 * Start Session (WAHA)
 */
async function startSession(sessionName) {
    try {
        const response = await apiClient.post(`/api/sessions/${sessionName}/start`);
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Start Session Error:`, error.message);
        throw error;
    }
}

/**
 * Stop Session (WAHA)
 */
async function stopSession(sessionName) {
    try {
        const response = await apiClient.post(`/api/sessions/${sessionName}/stop`);
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Stop Session Error:`, error.message);
        throw error;
    }
}

/**
 * Logout Session (WAHA)
 */
async function logoutSession(sessionName) {
    try {
        const response = await apiClient.post(`/api/sessions/${sessionName}/logout`);
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Logout Session Error:`, error.message);
        throw error;
    }
}

/**
 * Get Session Screenshot (QR)
 */
async function getScreenshot(sessionName) {
    try {
        const response = await apiClient.get(`/api/screenshot?session=${sessionName}`, {
            responseType: 'arraybuffer' 
        });
        // Convert to base64 data URL
        const base64 = Buffer.from(response.data, 'binary').toString('base64');
        return `data:image/png;base64,${base64}`;
    } catch (error) {
        console.error(`[WhatsApp] Get Screenshot Error:`, error.message);
        return null;
    }
}

/**
 * Get Pairing Code (Link with Phone Number)
 * @param {string} sessionName 
 * @param {string} phoneNumber 
 */
async function getPairingCode(sessionName, phoneNumber) {
    // Poll for SCAN_QR status before requesting code (Max 30s)
    let retries = 20;
    while (retries > 0) {
        try {
            const sessionInfo = await getSession(sessionName);
            if (sessionInfo && sessionInfo.status === 'SCAN_QR') {
                break; // Ready!
            }
        } catch (e) {
            // Ignore error during polling
        }
        await new Promise(r => setTimeout(r, 1500));
        retries--;
    }

    try {
        // Correct endpoint for NOWEB engine based on documentation
        // POST /api/{session}/auth/request-code
        const response = await apiClient.post(`/api/${sessionName}/auth/request-code`, {
            phoneNumber: phoneNumber,
            method: "" // Empty method as per instruction
        });
        return response.data.code;
    } catch (error) {
        console.error(`[WhatsApp] Get Pairing Code Error:`, error.message);
        
        // If 404, maybe try the previous method as fallback (optional, but sticking to new instruction first)
        if (error.response && error.response.status === 404) {
             console.error(`[WhatsApp] 404 Error: Endpoint not found. Ensure session is running and engine supports this.`);
        }
        
        throw error;
    }
}

/**
 * Get Contact Info (Labels, etc.)
 * @param {string} session 
 * @param {string} chatId 
 */
async function getContact(session, chatId) {
    try {
        const response = await apiClient.get('/api/contacts', {
            params: {
                session: session,
                contactId: chatId
            }
        });
        // WAHA returns array for /api/contacts usually, or single object if contactId is unique?
        // Let's assume it returns a list and we find the one.
        // Or check if there's a specific endpoint. 
        // Based on WAHA Swagger: GET /api/contacts returns list.
        // There might be /api/contacts/{contactId} in some versions.
        // Let's try the list filter first.
        if (Array.isArray(response.data)) {
            return response.data.find(c => c.id === chatId || c.id._serialized === chatId);
        }
        return response.data;
    } catch (error) {
        console.error(`[WhatsApp] Get Contact Error:`, error.message);
        return null;
    }
}

module.exports = {
    sendMessage,
    sendImage,
    sendTyping,
    stopTyping,
    sendSeen,
    getMessages,
    getSessions,
    getSession,
    createSession,
    deleteSession,
    startSession,
    stopSession,
    logoutSession,
    getScreenshot,
    getPairingCode,
    getContact
};
