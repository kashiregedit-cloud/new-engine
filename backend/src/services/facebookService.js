const axios = require('axios');

// Step 4: HTTP Request to Send Message (with Splitting)
async function sendMessage(pageId, recipientId, text, accessToken) {
    try {
        const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${accessToken}`;
        
        // Split message if too long (limit is 2000, we use 1990 for safety check)
        const FB_LIMIT = 2000;
        
        if (text.length > FB_LIMIT) {
            console.log(`Message too long (${text.length} chars). Splitting...`);
            const chunks = [];
            let currentText = text;
            
            while (currentText.length > 0) {
                let splitIndex = FB_LIMIT;
                
                if (currentText.length > FB_LIMIT) {
                    // Smart Split Strategy:
                    // 1. Priority: "Section Header" (Emoji + Text + Newline) - Best for user experience
                    // 2. Priority: Double Newline (Paragraph break)
                    // 3. Priority: Single Newline
                    
                    const chunkSafeLimit = 1950; // Leave buffer
                    const minChunkSize = 300;    // Allow smaller chunks if it means a clean section break
                    
                    const subString = currentText.substring(0, chunkSafeLimit);
                    
                    // Regex for Section Headers (e.g., "🌟 Basic Plan", "📦 Pro Plan")
                    // Looks for Newline + Emoji/Bullet + Text
                    // Added [IMAGE: and [Link: to split points too
                    const headerRegex = /\n(?:[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]|IMAGE:|Link:|Sobi:).{1,50}(\n|$)/gu;
                    
                    let bestSplit = -1;
                    let match;
                    
                    // Find the last header that fits in the chunk
                    while ((match = headerRegex.exec(subString)) !== null) {
                         if (match.index > minChunkSize) {
                             bestSplit = match.index; // Split BEFORE the header (at the newline)
                         }
                    }

                    const lastDoubleNewline = subString.lastIndexOf('\n\n');
                    const lastNewline = subString.lastIndexOf('\n');
                    const lastSpace = subString.lastIndexOf(' ');
                    
                    if (bestSplit !== -1) {
                        splitIndex = bestSplit; // Perfect Split: Before a new Section
                    } else if (lastDoubleNewline > minChunkSize) {
                        splitIndex = lastDoubleNewline; // Good Split: Paragraph end
                    } else if (lastNewline > minChunkSize) {
                        splitIndex = lastNewline; // Okay Split: Line end
                    } else if (lastSpace > minChunkSize) {
                        splitIndex = lastSpace; // Fallback: Word end
                    } else {
                        splitIndex = chunkSafeLimit; // Hard Split
                    }
                } else {
                    splitIndex = currentText.length;
                }
                
                chunks.push(currentText.substring(0, splitIndex));
                currentText = currentText.substring(splitIndex).trim();
            }
            
            // Send chunks sequentially
            for (const chunk of chunks) {
                if (!chunk) continue;
                const payload = {
                    recipient: { id: recipientId },
                    message: { text: chunk }
                };
                await axios.post(url, payload);
            }
            return { status: 'split_sent', chunks: chunks.length };
        } else {
            // Normal Send
            const payload = {
                recipient: { id: recipientId },
                message: { text: text }
            };
            console.log(`Sending FB Message to ${recipientId} from ${pageId}`);
            const response = await axios.post(url, payload);
            return response.data;
        }
    } catch (error) {
        console.error(`Error sending FB message for page ${pageId}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw error;
    }
}

// Human AI Agent Trick: Typing Indicator
async function sendTypingAction(recipientId, accessToken, action = 'typing_on') {
    if (accessToken === 'TEST_TOKEN') return;
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
    if (accessToken === 'TEST_TOKEN') return [];
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

const FormData = require('form-data');

// Upload Image Binary (Bypasses URL reachability issues)
async function sendImageUpload(pageId, recipientId, imageUrl, accessToken) {
    try {
        console.log(`Downloading image for upload: ${imageUrl}`);
        
        // 1. Download Image
        const imageResponse = await axios.get(imageUrl, {
            responseType: 'stream'
        });

        // 2. Prepare Form Data
        const form = new FormData();
        form.append('recipient', JSON.stringify({ id: recipientId }));
        form.append('message', JSON.stringify({
            attachment: {
                type: 'image',
                payload: {
                    is_reusable: true
                }
            }
        }));
        form.append('filedata', imageResponse.data, {
            filename: 'image.jpg', // Default filename
            contentType: imageResponse.headers['content-type']
        });

        // 3. Upload to Facebook
        const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${accessToken}`;
        
        console.log(`Uploading image to ${recipientId} from ${pageId}`);
        const response = await axios.post(url, form, {
            headers: {
                ...form.getHeaders()
            }
        });
        
        return response.data;
    } catch (error) {
        console.error(`Error uploading image for page ${pageId}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        // Fallback to URL method if upload fails (e.g. file too big)
        console.log('Falling back to URL send method...');
        return sendImageMessage(pageId, recipientId, imageUrl, accessToken);
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
        console.error(`Error sending image for page ${pageId}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        throw error;
    }
}

// Send Generic Template (Carousel) for multiple images
async function sendCarouselMessage(pageId, recipientId, elements, accessToken) {
    try {
        const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${accessToken}`;
        
        const payload = {
            recipient: { id: recipientId },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "generic",
                        elements: elements
                    }
                }
            }
        };

        console.log(`Sending Carousel to ${recipientId} from ${pageId} with ${elements.length} elements`);
        const response = await axios.post(url, payload);
        return response.data;
    } catch (error) {
        console.error(`Error sending carousel for page ${pageId}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
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
        console.error(`Error replying to comment ${commentId}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
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
        console.error(`Error getting comment replies ${commentId}:`, error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
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

// Fetch Single Message by ID (Fallback for Old Messages)
async function getMessageById(messageId, accessToken) {
    try {
        const url = `https://graph.facebook.com/v19.0/${messageId}?fields=message,from,created_time&access_token=${accessToken}`;
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error(`Error fetching message ${messageId}:`, error.response ? error.response.data : error.message);
        return null;
    }
}

module.exports = {
    sendMessage,
    sendImageMessage,
    sendImageUpload,
    sendCarouselMessage,
    sendTypingAction,
    getConversationMessages,
    replyToComment,
    getCommentReplies,
    getUserProfile,
    getMessageById
};
