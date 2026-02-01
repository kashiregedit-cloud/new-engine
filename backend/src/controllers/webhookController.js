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
    console.log(`[Webhook DEBUG] Event for Page: ${pageId} | Sender: ${senderId}`);
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

    // 2. Handle Attachments (Images & Stickers)
    if (event.message?.attachments) {
        // Separate Stickers from Real Images
        const stickers = event.message.attachments.filter(att => 
            att.type === 'image' && (event.message.sticker_id || att.payload.sticker_id)
        );
        
        const realImages = event.message.attachments.filter(att => 
            att.type === 'image' && !event.message.sticker_id && !att.payload.sticker_id
        );

        // Handle Stickers -> Convert to Emoji
        if (stickers.length > 0) {
            console.log(`[Webhook] Detected ${stickers.length} Sticker(s). Converting to Emoji.`);
            // Default to Thumbs Up 👍 for stickers as it's the most common (Blue Thumb)
            // We can append it to text so AI sees it as an emoji
            messageText = (messageText ? messageText + " " : "") + "👍"; 
        }

        const imageUrls = realImages.map(att => att.payload.url);
        
        if (imageUrls.length > 0) {
            console.log(`[Webhook] Image URLs Queued: ${imageUrls.length}`);
            // We just store the URLs now, analysis happens in processBufferedMessages
        }
        
        // 3. Handle Audio (Voice Messages) - DEFERRED PROCESSING
        const audioUrls = event.message.attachments
            .filter(att => att.type === 'audio')
            .map(att => att.payload.url);
            
        if (audioUrls.length > 0) {
            console.log(`[Webhook] Audio URLs Queued: ${audioUrls.length}`);
        }

        // Handle other attachments (file, video) placeholders
        const otherAtts = event.message.attachments.filter(att => att.type !== 'image' && att.type !== 'audio');
        if (otherAtts.length > 0) {
             messageText += `\n[User sent attachments: ${otherAtts.map(a => a.type).join(', ')}]`;
        }
    }

    if (!messageText && !event.message?.attachments) return; // Ignore if empty and no attachments

    // Check Duplicate immediately to avoid processing same message twice
    const isDuplicate = await dbService.checkDuplicate(messageId);
    if (isDuplicate) {
        console.log(`Duplicate message ${messageId} ignored.`);
        return;
    }

    const replyToId = event.message?.reply_to?.mid || null;

    // --- SAVE USER MESSAGE TO fb_chats (Immediate - Raw) ---
    try {
        await dbService.saveFbChat({
            page_id: pageId,
            sender_id: senderId,
            recipient_id: pageId,
            message_id: messageId,
            text: messageText || '[Media Message]', // Placeholder if text is empty
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
    
    // Extract URLs for this specific message (EXCLUDING STICKERS)
    const thisMsgImages = event.message?.attachments?.filter(att => 
        att.type === 'image' && !event.message.sticker_id && !att.payload.sticker_id
    ).map(att => att.payload.url) || [];
    
    const thisMsgAudios = event.message?.attachments?.filter(att => att.type === 'audio').map(att => att.payload.url) || [];

    // Push Object
    sessionData.messages.push({
        text: messageText,
        reply_to: replyToId,
        images: thisMsgImages,
        audios: thisMsgAudios,
        isPostback: !!event.postback
    });

    console.log(`Queued message for ${sessionId}. Buffer size: ${sessionData.messages.length}`);
    
    if (sessionData.timer) {
        clearTimeout(sessionData.timer); // Reset timer on new message
    }

    // Dynamic Debounce from DB
    // We need to fetch the wait time. Since we can't await in top level easily without refactoring,
    // we'll fetch it inside the timeout or pre-fetch?
    // Better: Fetch it now, async.
    // NOTE: This adds a small DB read overhead per message.
    // Optimization: Cache this in memory or just accept the slight delay.
    
    const pagePrompts = await dbService.getPagePrompts(pageId);
    let debounceTime = 8000; // Default 8s
    if (pagePrompts && pagePrompts.wait) {
        debounceTime = Number(pagePrompts.wait) * 1000; // Convert sec to ms
    }
    
    // Safety check
    if (debounceTime < 1000) debounceTime = 1000; // Minimum 1s

    console.log(`[Debounce] Using wait time: ${debounceTime}ms for ${sessionId}`);

    sessionData.timer = setTimeout(() => {
        // Clone messages and clear buffer immediately
        const messagesToProcess = [...sessionData.messages];
        debounceMap.delete(sessionId);
        
        processBufferedMessages(sessionId, pageId, senderId, messagesToProcess);
    }, debounceTime); 
}

// Core Logic Function (Debounced)
async function processBufferedMessages(sessionId, pageId, senderId, messages) {
    // Reconstruct Combined Message & Extract Metadata
    let combinedText = "";
    let replyToId = null;
    let allImages = [];
    let allAudios = [];
    let hasPostback = false;

    for (const msg of messages) {
        if (typeof msg === 'string') {
            combinedText += msg + "\n";
        } else {
            if (msg.text) combinedText += msg.text + "\n";
            if (msg.reply_to) replyToId = msg.reply_to; 
            if (msg.images && msg.images.length > 0) allImages.push(...msg.images);
            if (msg.audios && msg.audios.length > 0) allAudios.push(...msg.audios);
            if (msg.isPostback) hasPostback = true;
        }
    }
    combinedText = combinedText.trim();
    console.log(`Processing buffered messages for ${sessionId}. Text: ${combinedText.substring(0,50)}... Images: ${allImages.length}, Audios: ${allAudios.length}`);

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

        // --- OPTIMIZATION: PARALLEL DATA FETCHING ---
        // We fetch Prompts, User Profile, Chat History, and FB Messages (for handover) in parallel
        // This significantly reduces latency (User Feedback: "1s debounce but late reply")
        
        console.log("Fetching context data in parallel...");
        
        // Reduced history limit to save tokens (User Feedback: "System token besi kasse")
        const historyLimit = 20; 
        
        const [pagePrompts, userProfile, fbMessages, history, typingResult, seenResult] = await Promise.all([
            dbService.getPagePrompts(pageId),
            facebookService.getUserProfile(senderId, pageConfig.page_access_token),
            facebookService.getConversationMessages(pageId, senderId, pageConfig.page_access_token, 10), // For Handover Check
            dbService.getChatHistory(sessionId, historyLimit),
            facebookService.sendTypingAction(senderId, pageConfig.page_access_token, 'typing_on'), // Fire and forget (awaited in parallel)
            facebookService.sendTypingAction(senderId, pageConfig.page_access_token, 'mark_seen') // Mark as Seen
        ]);

        const senderName = userProfile.name || 'Customer';
        
        // --------------------------------------------

        // --- BATCH PROCESSING: IMAGES & AUDIO ---
        // Now we process all media together BEFORE generating the reply.
        
        // A. Process Images (Vision)
        if (allImages.length > 0) {
            // Use the already fetched pagePrompts
            if (pagePrompts && pagePrompts.image_detection) {
                console.log(`[Batch] Analyzing ${allImages.length} images...`);
                // Process in parallel
                const imagePromises = allImages.map(url => aiService.processImageWithVision(url, pageConfig));
                const imageResults = await Promise.all(imagePromises);
                
                // Format clearly for AI
                let combinedImageAnalysis = "";
                imageResults.forEach((result, index) => {
                    combinedImageAnalysis += `\n[Image ${index + 1} Analysis]: ${result}\n`;
                });
                
                combinedText += `\n\n[System: User sent ${allImages.length} images. Analysis follows:]${combinedImageAnalysis}`;
            } else {
                combinedText += `\n[User sent ${allImages.length} images: ${allImages.join(', ')}]`;
            }
        }

        // B. Process Audio (Voice)
        if (allAudios.length > 0) {
            console.log(`[Batch] Transcribing ${allAudios.length} voice messages...`);
            // Process in parallel
            const audioPromises = allAudios.map(url => aiService.transcribeAudio(url, pageConfig));
            const audioResults = await Promise.all(audioPromises);
            
            const combinedAudioTranscript = audioResults.join('\n');
            combinedText += `\n\n[System: User sent ${allAudios.length} voice messages. Transcripts follow:]\n${combinedAudioTranscript}`;
        }
        
        console.log(`[Batch] Final Context for AI:\n${combinedText}`);
        // ----------------------------------------
        

        // 2. HUMAN HANDOVER & RACE CONDITION CHECK
        console.log("Checking human handover...");
        // fbMessages already fetched in parallel
        
        // 3. Send Typing Indicator
        // Already sent in parallel

        // 4. Get Knowledge Base & Chat History
        // pagePrompts already fetched in parallel
        
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
        // senderName already fetched
        // -------------------------
        
        // Dynamic History Limit from DB (check_conversion) or default 10
        // history already fetched with default 50. If check_conversion is different, we might have fetched too much or too little.
        // But 50 is a safe upper bound for context window usually.
        // If we really need strict limit, we can slice the array locally.
        
        let effectiveHistory = history;
        if (pagePrompts?.check_conversion) {
             const limit = Number(pagePrompts.check_conversion);
             if (limit > 0 && limit < 50) {
                 effectiveHistory = history.slice(0, limit);
             }
        }

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
        
        // --- INJECT FORMATTING INSTRUCTION (User Request: "n8n style split" & "Carousel Titles") ---
        if (pagePrompts && pagePrompts.text_prompt) {
             pagePrompts.text_prompt += `\n\n[IMPORTANT OUTPUT RULES]\n1. If explaining multiple items/plans, keep each section SHORT (max 500 chars).\n2. Use clear spacing between sections.\n3. Include the IMAGE LINK for EVERY item/plan described.\n4. **STRICT IMAGE FORMAT**: You MUST output images using this EXACT format:\n   IMAGE: Plan Name | https://your-image-url.com\n   (Example: "IMAGE: 🌟 Basic Plan | https://i.imgur.com/xyz.jpg")\n5. DO NOT use [Image] placeholders. ONLY use the 'IMAGE: Title | URL' format.`;
        }
        // -----------------------------------------------------------------------

        const aiResponse = await aiService.generateReply(finalUserMessage, pageConfig, pagePrompts, effectiveHistory, senderName);
        
        // --- ZERO COST ORDER TRACKING LOGIC ---
        // If AI detects order details, save to DB immediately.
        // This uses the SAME AI call, so ZERO extra cost.
        if (aiResponse.order_details && aiResponse.order_details.product_name) {
             const order = aiResponse.order_details;
             console.log(`[Order] AI detected potential order: ${JSON.stringify(order)}`);
             
             // Normalize Data for DB
             // number: bigint (phone or sender_id)
             // We prioritize phone if AI found it, else use sender_id (must be numeric for bigint, but FB IDs are strings...
             // Wait, user schema says 'number bigint'. FB IDs are huge strings often, might fit in bigint?
             // Safest is to try parsing phone, if null, try senderId if it looks numeric.
             
             let customerNumber = order.phone ? order.phone.replace(/\D/g, '') : null;
             if (!customerNumber && /^\d+$/.test(senderId)) {
                 customerNumber = senderId;
             }
             
             // Only save if we have at least a product name and some user identifier
             if (customerNumber) {
                 await dbService.saveOrderTracking({
                     page_id: pageId, // Passed for duplicate check logic (though table might not have column, logic handles it)
                     sender_id: senderId, // For logging
                     product_name: order.product_name,
                     number: customerNumber, 
                     location: order.address,
                     product_quantity: order.quantity,
                     price: order.price
                 });
             }
        }
        // --------------------------------------

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
        let replyText = aiResponse.reply;

        // User Instruction: If AI fails (reply is null/empty), DO NOT send anything.
        if (!replyText && (!aiResponse.images || aiResponse.images.length === 0)) {
             console.log(`[AI] No response generated. Skipping reply.`);
             return;
        }

        // --- SMART IMAGE EXTRACTION & CLEANING ---
        if (!aiResponse.images) aiResponse.images = [];
        
        // Start with existing images from AI Service (e.g. JSON response)
        const extractedImages = [...aiResponse.images]; 

        // 1. STRICT FORMAT: IMAGE: Title | URL
        // Matches: IMAGE: Basic Plan | https://...
        const strictImageRegex = /IMAGE:\s*(.+?)\s*\|\s*(https?:\/\/[^\s,]+)/gi;
        let strictMatch;
        while ((strictMatch = strictImageRegex.exec(replyText)) !== null) {
            const fullMatch = strictMatch[0];
            const title = strictMatch[1].trim();
            let url = strictMatch[2].trim();
            
            // Remove trailing punctuation (comma, dot) if accidentally matched
            url = url.replace(/[,.]$/, '');

            // Fix Google Drive Links (Convert View to Direct)
            const driveIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
            if (driveIdMatch && driveIdMatch[1]) {
                url = `https://drive.google.com/uc?export=view&id=${driveIdMatch[1]}`;
            }

            if (!extractedImages.some(img => img.url === url)) {
                extractedImages.push({ url: url, title: title });
            }
            replyText = replyText.replace(fullMatch, '').trim();
        }

        // 2. Google Drive Viewer Links (Standalone)
        const driveRegex = /(?:(?:Image|Link|Sobi|Photo|Picture|চিত্র)\s*[:|-]?\s*)?(https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)\/view[^\s,]*)/gi;
        let driveMatch;
        while ((driveMatch = driveRegex.exec(replyText)) !== null) {
            const fullMatch = driveMatch[0];
            const fileId = driveMatch[2];
            const directLink = `https://drive.google.com/uc?export=view&id=${fileId}`;
            
            if (!extractedImages.some(img => img.url === directLink)) {
                extractedImages.push({ url: directLink, title: 'View Image' });
            }
            replyText = replyText.replace(fullMatch, '').trim();
        }

        // 3. Direct Image URLs (Fallback)
        // Improved Regex: Handles comma-separated URLs and ignores trailing punctuation
        const imgRegex = /(?:(?:Image|Link|Sobi|Photo|Picture|চিত্র)\s*[:|-]?\s*)?(https?:\/\/[^\s,]+\.(?:jpg|jpeg|png|gif|webp))/gi;
        let imgMatch;
        while ((imgMatch = imgRegex.exec(replyText)) !== null) {
            const fullMatch = imgMatch[0];
            let url = imgMatch[1];
            
            // Remove trailing punctuation
            url = url.replace(/[,.]$/, '');

            if (!extractedImages.some(img => img.url === url)) {
                extractedImages.push({ url: url, title: 'View Image' });
            }
            replyText = replyText.replace(fullMatch, '').trim();
        }

        // 4. Generic Labeled Links (Fallback)
        const labeledLinkRegex = /(?:(?:Image|Link|Sobi|Photo|Picture|চিত্র)\s*[:|-]?\s*)(https?:\/\/[^\s,]+)/gi;
        let labeledMatch;
        while ((labeledMatch = labeledLinkRegex.exec(replyText)) !== null) {
             const fullMatch = labeledMatch[0];
             let url = labeledMatch[1];
             
             // Remove trailing punctuation
             url = url.replace(/[,.]$/, '');

             if (!extractedImages.some(img => img.url === url)) {
                extractedImages.push({ url: url, title: 'View Link' });
            }
            replyText = replyText.replace(fullMatch, '').trim();
        }
        
        // Cleanup leftover [Image] artifacts (User Issue)
        replyText = replyText.replace(/\[Image.*?\]/gi, '').trim();
        replyText = replyText.replace(/^Image:$/gm, '').trim();

        // Update aiResponse.images with our new object array
        aiResponse.images = extractedImages;

        if (aiResponse.images.length > 0) {
            console.log(`[Smart Extraction] Found ${aiResponse.images.length} images.`);
        }
        // ----------------------------------------

        // Send Text
        let botMessageId = `bot_${Date.now()}`;
        if (replyText && replyText.length > 0) {
            const sendResult = await facebookService.sendMessage(pageId, senderId, replyText, pageConfig.page_access_token);
            botMessageId = sendResult?.message_id || botMessageId;

            // --- SAVE BOT REPLY TO fb_chats ---
            await dbService.saveFbChat({
                page_id: pageId,
                sender_id: pageId, // Bot is sender
                recipient_id: senderId,
                message_id: botMessageId,
                text: replyText,
                timestamp: Date.now(),
                status: 'bot_reply',
                reply_by: 'bot',
                token: aiResponse.token_usage || 0,
                ai_model: aiResponse.model || null
            });
            // ----------------------------------
        }

        // Send Images (if any)
        if (aiResponse.images && Array.isArray(aiResponse.images) && aiResponse.images.length > 0) {
            const images = aiResponse.images; // Array of {url, title}
            console.log(`[AI] Found ${images.length} images to send.`);
            
            // MASTER SWITCH: check if 'image_reply' is FALSE (default TRUE if undefined)
            // User requirement: "jodi image send o false ... tobe full image send system ta kaj korbe na"
            const allowImageSend = pagePrompts?.image_reply !== false; // Strict check against false
            
            if (!allowImageSend) {
                console.log(`[Image Send] Disabled by Config (image_reply=false). Sending links as text.`);
                // Append links back to text since we stripped them
                if (replyText.length > 0) replyText += "\n\n";
                replyText += "Attached Links:\n" + images.map(img => img.url).join("\n");
                
                // If text was already sent (unlikely here as we haven't sent yet, but let's be safe), we just send a new message.
                // But wait, the code above sends text FIRST. 
                // Line 513 sends text. We are at line 532.
                // Uh oh. The text sending happens at line 513 using 'replyText'.
                // 'replyText' was modified by our cleaning logic.
                // So the text sent at 513 DOES NOT contain the links.
                // So here, we must send them as a new text message.
                const linksText = "Attached Links:\n" + images.map(img => img.url).join("\n");
                await facebookService.sendMessage(pageId, senderId, linksText, pageConfig.page_access_token);
                
            } else {
                // Image Send ENABLED
                
                let sentViaCarousel = false;
                
                // Check Config for Template/Carousel
                // Robust check: handles boolean true, string 'true', integer 1, string '1'
                const tVal = pagePrompts?.template_reply;
                const useCarousel = (tVal === true || tVal === 'true' || tVal === 1 || tVal === '1');
                
                console.log(`[Image Group] Template Check: Value=${tVal}, Result=${useCarousel}, ImageCount=${images.length}`);
    
                if (useCarousel && images.length > 1) {
                    console.log(`[Image Group] Template Reply ON. Sending via Carousel...`);
                    try {
                        const elements = images.map((imgObj, index) => ({
                            title: imgObj.title || `View Image ${index + 1}`,
                            subtitle: 'Tap to expand',
                            image_url: imgObj.url,
                            default_action: {
                                type: "web_url",
                                url: imgObj.url,
                                webview_height_ratio: "tall"
                            }
                        }));
                        
                        // Limit to 10 elements (FB limit)
                        const carouselElements = elements.slice(0, 10);
                        
                        await facebookService.sendCarouselMessage(pageId, senderId, carouselElements, pageConfig.page_access_token);
                        sentViaCarousel = true;
                        console.log(`[Image Group] Sent ${images.length} images via Carousel.`);
                    } catch (carouselError) {
                        console.error(`[Image Group] Carousel failed. Falling back to Binary Upload. Error: ${carouselError.message}`);
                        sentViaCarousel = false;
                    }
                }
    
                if (!sentViaCarousel) {
                    // Binary Upload Fallback
                    console.log(`[Image Send] Sending ${images.length} images via Binary Upload (Parallel)...`);
                    
                    const uploadPromises = images.map(async (imgObj) => {
                         try {
                             // Use Smart Downloader & Uploader
                             // This handles downloading the image to a buffer and uploading it as multipart/form-data
                             // This fixes issues where FB rejects direct URLs (like Google Drive or protected links)
                             await facebookService.sendImageUpload(pageId, senderId, imgObj.url, pageConfig.page_access_token);
                             console.log(`[Image Sent] ${imgObj.url}`);
                         } catch (imgError) {
                             console.error(`[Image Fallback] Failed to send image ${imgObj.url}: ${imgError.message}`);
                             
                             // FINAL FALLBACK: If binary upload fails, send as a Link
                             const fallbackText = `Link: ${imgObj.url}`;
                             await facebookService.sendMessage(pageId, senderId, fallbackText, pageConfig.page_access_token);
                         }
                    });
                    
                    await Promise.all(uploadPromises);
                    console.log(`[Image Group] All images sent.`);
                }
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