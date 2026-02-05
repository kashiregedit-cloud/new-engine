const keyService = require('./keyService');
const commandApiService = require('./commandApiService'); // Command API Table Strategy
const axios = require('axios');
const OpenAI = require('openai');
const FormData = require('form-data');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function logDebug(msg) {
    try {
        const logDir = path.join(__dirname, '../../logs');
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
        
        fs.appendFileSync(path.join(logDir, 'ai.log'), new Date().toISOString() + ' ' + msg + '\n');
    } catch (e) {
        console.error("Failed to write debug log:", e);
    }
}

// --- IN-MEMORY CACHE FOR ZERO COST ---
// Map<hash, { reply: string, timestamp: number }>
const responseCache = new Map();
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 Hour Cache
const CACHE_SIZE_LIMIT = 500; // Prevent memory leaks

function getCacheKey(pageId, message, senderName) {
    // Normalize message: lowercase, remove special chars
    const normalized = message.toLowerCase().replace(/[^\w\s\u0980-\u09FF]/g, '').trim();
    // LEAK FIX: Include senderName in cache key to prevent cross-user data leaks
    return `${pageId}:${senderName}:${normalized}`;
}
// -------------------------------------

// --- HELPER: Fetch OG Image from Link ---
async function fetchOgImage(url) {
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                // Add Security Headers to mimic browser
                'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-User': '?1',
                'Upgrade-Insecure-Requests': '1'
            },
            timeout: 3000 // 3s Timeout to avoid blocking response
        });

        const html = response.data;
        if (typeof html !== 'string') return null;

        // Priority 1: og:image
        let match = html.match(/<meta property=["']og:image["'] content=["']([^"']+)["']/i);
        if (match) return match[1];

        // Priority 2: twitter:image
        match = html.match(/<meta name=["']twitter:image["'] content=["']([^"']+)["']/i);
        if (match) return match[1];
        
        // Priority 3: link rel="image_src"
        match = html.match(/<link rel=["']image_src["'] href=["']([^"']+)["']/i);
        if (match) return match[1];

        return null;
    } catch (error) {
        // Silent fail is fine, we just won't have an image
        return null;
    }
}

// Wrapper for Controller Consistency
async function generateResponse({ pageId, userId, userMessage, history, imageUrls, audioUrls, config, platform, extraTokenUsage = 0 }) {
    // 1. Fetch Prompts if needed
    let pagePrompts = config;
    
    // For Messenger, config might not have prompts if passed from minimal object
    // But for WhatsApp, we usually pass full config.
    // Let's ensure we have prompts.
    if (platform === 'messenger' || !pagePrompts.text_prompt) {
         const dbService = require('./dbService');
         try {
            pagePrompts = await dbService.getPagePrompts(pageId);
         } catch (e) {
            console.warn(`[AI] Failed to fetch prompts for ${pageId}:`, e.message);
         }
    }

    // 2. Resolve Sender Name (WhatsApp Specific)
    let senderName = userId;
    try {
        const dbService = require('./dbService');
        if (platform === 'whatsapp') {
             const { data } = await dbService.supabase
                .from('whatsapp_contacts')
                .select('name')
                .eq('phone_number', userId)
                .eq('session_name', pageId)
                .maybeSingle();
             if (data && data.name) senderName = data.name;
        }
    } catch (e) {
        // Ignore error, fallback to ID
    }

    // 3. Call Core Logic
    return generateReply(
        userMessage,
        config,
        pagePrompts,
        history,
        senderName,
        null, // senderGender (optional)
        imageUrls,
        audioUrls,
        extraTokenUsage // Pass initial usage (e.g. from Vision API in Controller)
    );
}

// Step 2: Business Logic / AI Brain
async function generateReply(userMessage, pageConfig, pagePrompts, history = [], senderName = 'Customer', senderGender = null, imageUrls = [], audioUrls = [], extraTokenUsage = 0) {
    
    // --- MULTI-TENANCY SAFETY CHECK ---
    const pageId = pageConfig.page_id;
    
    // Check Cheap Engine Flag (Default to TRUE if undefined/null, for zero-cost)
    const useCheapEngine = pageConfig.cheap_engine !== false;

    const promptPreview = pagePrompts?.text_prompt ? pagePrompts.text_prompt.substring(0, 30) : "DEFAULT";
    console.log(`[AI Isolation Check] Generating for Page ID: ${pageId} | CheapEngine: ${useCheapEngine} | Sender: ${senderName} | Prompt: "${promptPreview}..."`);
    // ----------------------------------

    let totalTokenUsage = extraTokenUsage || 0;

    // 0. Pre-process Media (Images/Audio) -> Text
    // This ensures the AI "sees" the images/audio as text descriptions
    let mediaContext = "";
    
    if (imageUrls && imageUrls.length > 0) {
        console.log(`[AI] Processing ${imageUrls.length} images...`);
        const imageResults = await Promise.all(imageUrls.map(url => processImageWithVision(url, pageConfig)));
        
        // Extract text and usage
        const imageDescriptions = imageResults.map(res => {
            if (typeof res === 'object') {
                totalTokenUsage += (res.usage || 0);
                return res.text;
            }
            return res; // Fallback string
        });

        mediaContext += "\n[System Note: User sent images. Analysis below:]\n" + imageDescriptions.map((desc, i) => `Image ${i+1}: ${desc}`).join("\n");
    }

    if (audioUrls && audioUrls.length > 0) {
        console.log(`[AI] Processing ${audioUrls.length} audio files...`);
        const audioPromises = audioUrls.map(url => transcribeAudio(url, pageConfig));
        const audioResults = await Promise.all(audioPromises);
        mediaContext += "\n[System Note: User sent audio messages:]\n" + audioResults.join("\n");
    }

    if (mediaContext) {
        userMessage += "\n" + mediaContext;
        console.log(`[AI] Added media context to user message.`);
    }

    // 1. Prepare Configuration
    let dynamicProvider = 'openrouter'; 
    let dynamicModel = 'arcee-ai/trinity-large-preview'; // Verified Free Model
    let fallbackModel = 'google/gemini-2.0-flash-lite-preview-02-05:free';

    if (useCheapEngine) {
        try {
            const commandConfig = await commandApiService.getCommandConfig();
            if (commandConfig) {
                dynamicProvider = commandConfig.provider || dynamicProvider;
                dynamicModel = commandConfig.chatmodel || dynamicModel;
                fallbackModel = commandConfig.fallback_chatmodel || fallbackModel;
            }
        } catch (err) {
            console.warn("[AI] Failed to fetch Command API config, using strong defaults:", err.message);
        }
    }

    // PRIORITIZE PAGE CONFIG (User's specific choice overrides everything)
    const userModel = (pageConfig.chat_model && pageConfig.chat_model !== 'default') ? pageConfig.chat_model.trim() : null;
    const userProvider = pageConfig.ai || pageConfig.operator; 

    let defaultProvider = userProvider || (useCheapEngine ? dynamicProvider : 'gemini');
    let defaultModel = userModel;

    // IF User did NOT specify a model (null), pick a smart default based on the Provider
    if (!defaultModel) {
        if (defaultProvider === 'gemini') {
            defaultModel = 'gemini-1.5-flash'; 
        } else if (defaultProvider === 'openrouter') {
            defaultModel = useCheapEngine ? dynamicModel : 'arcee-ai/trinity-large-preview';
        } else if (defaultProvider === 'groq') {
            defaultModel = 'llama-3.3-70b-versatile';
        } else {
            defaultModel = useCheapEngine ? dynamicModel : 'gemini-1.5-flash'; 
        }
    }

    // Force free model for OpenRouter if using default
    if (!userModel && defaultProvider === 'openrouter' && defaultModel.includes('gemini') && !defaultModel.includes(':free')) {
        defaultModel = 'arcee-ai/trinity-large-preview';
    }

    console.log(`[AI] Final Engine Config: ${defaultProvider} / ${defaultModel}`);

    // --- MODEL NAME NORMALIZATION & ALIASES ---
    const MODEL_ALIASES = {
        'gemini-2.5-flash': 'gemini-2.0-flash', // User Alias
        'gemini-2.5-flash-lite': 'gemini-2.0-flash-lite-preview-02-05', // User Alias
        'gemini-2.0-flash-exp': 'gemini-2.0-flash', 
        'gemini-2.5-pro': 'gemini-2.5-pro-preview', 
        'groq-fast': 'llama-3.3-70b-versatile', 
        'groq-speed': 'llama-3.1-8b-instant', 
        'grok-4.1-fast': 'llama-3.3-70b-versatile',
    };

    if (MODEL_ALIASES[defaultModel]) {
        defaultModel = MODEL_ALIASES[defaultModel];
    }

    // Dynamic Best Model Logic (Cache every 2 hours)
    // User Request: gemini 2.5 flash > 2.5 flash lite > openrouter free
    if (!userModel) {
        // If user didn't specify, we use our smart defaults
        // 1. Try Gemini 2.0 Flash (aka 2.5 Flash alias)
        // 2. Try Gemini 2.0 Flash Lite
        // 3. Fallback to OpenRouter Free
        
        // This is handled in Phase 2 loop below if we set the sequence right.
        // We set 'defaultModel' to the Primary Choice.
        defaultModel = 'gemini-2.5-flash';
        dynamicModel = 'gemini-2.5-flash-lite';
        fallbackModel = 'google/gemini-2.0-flash-lite-preview-02-05:free'; // OpenRouter Free Version
    }
    // -------------------------------------------------
    
    // --- MEDIA HANDLING (Images & Audio) ---
    let cleanUserMessage = userMessage;

    // 1. Process Images
    const imageMatch = userMessage.match(/\[User sent images: (.*?)\]/);
    if (imageMatch && imageMatch[1]) {
         const extracted = imageMatch[1].split(',').map(url => url.trim());
         imageUrls = [...imageUrls, ...extracted];
         cleanUserMessage = userMessage.replace(imageMatch[0], '').trim(); 
    }

    if (imageUrls.length > 0) {
        console.log(`[AI] Processing ${imageUrls.length} images...`);
        const imageDescriptions = await Promise.all(
            imageUrls.map(url => processImageWithVision(url, pageConfig))
        );
        
        const visionText = imageDescriptions.map((desc, i) => `[Image ${i+1} Analysis: ${desc}]`).join('\n');
        cleanUserMessage += `\n\n${visionText}`;
    }

    // 2. Process Audio
    if (audioUrls.length > 0) {
        console.log(`[AI] Processing ${audioUrls.length} audio messages...`);
        const audioTranscriptions = await Promise.all(
            audioUrls.map(url => transcribeAudio(url, pageConfig))
        );
        
        const audioText = audioTranscriptions.join('\n');
        cleanUserMessage += `\n\n${audioText}`;
    }
    // ----------------------------------------

    // --- PROMPT & MESSAGE CONSTRUCTION ---
    let basePrompt = pagePrompts?.text_prompt || "You are a helpful assistant.";
    
    let personaInstruction = "";
    if (useCheapEngine) {
        personaInstruction = `Persona: Gemini 2.5 Flash. Fast, accurate, Bengali expert. Strict JSON. No fluff.`;
    }

    const n8nSystemPrompt = `Role: Bot ${pageConfig.bot_name || 'Assistant'} for ${senderName}.
Ctx: ${basePrompt}
${personaInstruction}
Rules:
1. Reply in BENGALI. Keep answers extremely CONCISE and SHORT.
2. ADDRESSING: Name: '${senderName}'. Gender: '${senderGender || 'Unknown'}'.
   - Male -> 'Sir'/'Bhaiya'. Female -> 'Apu'/'Ma'am'.
   - If unknown/unsure, use neutral 'Prio Grahok'.
3. IMAGE HANDLING: If you see [System Note] "User sent >10 images" or "video", rely on Ad Context or ask user.
4. AD CONTEXT: If '[System Note: User clicked on an AD...]' exists, use it to identify the product.
5. STRICT DOMAIN CONTROL: Answer ONLY about business/products in 'Ctx'. Ignore unrelated topics.
6. PHONE VALIDATION: If user gives phone, ensure it's valid (11-digit BD).
7. SENDING IMAGES: If user asks for pics and you have URL in 'Ctx', send it as "IMAGE: Name | URL".
8. DYNAMIC ACTIONS:
   - If user requests ADMIN/SUPPORT/CALL or specific action defined in 'Ctx', append "[ADD_LABEL: label_name]" to your reply.
   - Example: "I will connect you to admin. [ADD_LABEL: admincall]"
   - Supported Labels: adminhandle, admincall, support, order.
9. Output RAW JSON:
{
  "reply": "Bengali text"|null,
  "sentiment": "pos|neu|neg",
  "dm_message": "msg"|null,
  "bad_words": "words"|null,
  "order_details": { "product_name", "quantity", "address", "phone", "price" }|null
}`;

    const systemMessage = { role: 'system', content: n8nSystemPrompt };
    
    const messages = [
        systemMessage,
        ...history,
        { role: 'user', content: cleanUserMessage }
    ];

    // --- UNIFIED AI REQUEST LOGIC ---

    // PHASE 1: Try User-Provided Keys
    if (!useCheapEngine && pageConfig.api_key && pageConfig.api_key !== 'MANAGED_SECRET_KEY') {
        const userKeys = pageConfig.api_key.split(',').map(k => k.trim()).filter(k => k);
        // Shuffle keys
        for (let i = userKeys.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [userKeys[i], userKeys[j]] = [userKeys[j], userKeys[i]];
        }

        for (const currentKey of userKeys) {
            let currentProvider = defaultProvider;
            if (currentKey.startsWith('sk-or-v1')) currentProvider = 'openrouter';
            else if (currentKey.startsWith('AIzaSy')) currentProvider = 'google';
            else if (currentKey.startsWith('gsk_')) currentProvider = 'groq';
            else if (currentKey.startsWith('xai-')) currentProvider = 'xai';

            let baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
            if (currentProvider.includes('openrouter')) baseURL = 'https://openrouter.ai/api/v1';
            else if (currentProvider.includes('openai')) baseURL = 'https://api.openai.com/v1';
            else if (currentProvider.includes('groq')) baseURL = 'https://api.groq.com/openai/v1';
            else if (currentProvider.includes('xai')) baseURL = 'https://api.x.ai/v1';

            try {
                const openai = new OpenAI({ apiKey: currentKey, baseURL: baseURL });
                console.log(`[AI] Phase 1: Calling User Key (${currentProvider}/${defaultModel})...`);

                const completion = await openai.chat.completions.create({
                    model: defaultModel,
                    messages: messages,
                    response_format: { type: "json_object" }
                });

                if (completion.choices && completion.choices.length > 0) {
                    const rawContent = completion.choices[0].message.content;
                    const tokenUsage = completion.usage ? completion.usage.total_tokens : 0;
                    try {
                        keyService.recordKeyUsage(currentKey, tokenUsage);
                    } catch (e) {}
                    
                    try {
                        const parsed = JSON.parse(rawContent);
                        if (!parsed.reply) parsed.reply = parsed.response || parsed.text;
                        return { ...parsed, token_usage: tokenUsage + totalTokenUsage, model: defaultModel };
                    } catch (e) {
                        return { reply: rawContent, sentiment: 'neutral', model: defaultModel, token_usage: tokenUsage + totalTokenUsage };
                    }
                }
            } catch (error) {
                console.warn(`[AI] Phase 1 Key Failed:`, error.message);
            }
        }
    }

    // PHASE 2: Fallback to Cheap Engine / Dynamic Config
    console.log(`[AI] Phase 2: Using Dynamic/Fallback Engine (${dynamicProvider}/${dynamicModel})...`);
    
    // Retry Logic for Cheap Engine (Max 3 attempts)
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            // Get Rotated Key
            const keyData = await keyService.getSmartKey(dynamicProvider, dynamicModel || 'default');
            if (!keyData || !keyData.key) throw new Error("No keys available for Cheap Engine.");
            const apiKey = keyData.key;

            let baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
            if (dynamicProvider === 'openrouter') baseURL = 'https://openrouter.ai/api/v1';
            if (dynamicProvider === 'groq') baseURL = 'https://api.groq.com/openai/v1';

            const openai = new OpenAI({ apiKey: apiKey, baseURL: baseURL });
            
            // Use fallback model on last attempt
            const modelToUse = (attempt === MAX_RETRIES && fallbackModel) ? fallbackModel : (defaultModel || dynamicModel);
            
            console.log(`[AI] Phase 2 Attempt ${attempt}/${MAX_RETRIES}: ${modelToUse} (Provider: ${dynamicProvider})`);

            const completion = await openai.chat.completions.create({
                model: modelToUse,
                messages: messages,
                response_format: { type: "json_object" }
            });

            if (completion.choices && completion.choices.length > 0) {
                const rawContent = completion.choices[0].message.content;
                const tokenUsage = completion.usage ? completion.usage.total_tokens : 0;
                
                try {
                    const parsed = JSON.parse(rawContent);
                    if (!parsed.reply) parsed.reply = parsed.response || parsed.text;
                    return { ...parsed, model: modelToUse, token_usage: tokenUsage + totalTokenUsage };
                } catch (e) {
                    return { reply: rawContent, sentiment: 'neutral', model: modelToUse, token_usage: tokenUsage + totalTokenUsage };
                }
            }
        } catch (error) {
            console.warn(`[AI] Phase 2 Attempt ${attempt} Failed:`, error.message);
            if (attempt === MAX_RETRIES) {
                console.error("[AI] All attempts failed.");
                return null;
            }
        }
    }

    return null;
}

const WAHA_BASE_URL = process.env.WAHA_BASE_URL || 'https://wahubbd.salesmanchatbot.online';
const WAHA_API_KEY = process.env.WAHA_API_KEY || 'e9457ca133cc4d73854ee0d43cee3bc5';

// --- HELPER: Process Image (Vision) with Smart Fallback ---
async function processImageWithVision(imageUrl, pageConfig = {}, customOptions = null) {
    let base64Image;
    let mimeType;
    let errors = [];

    // 0. Pre-process Image (Download/Decode)
    try {
        if (imageUrl.startsWith('data:')) {
            console.log(`[Vision] Processing Base64 Data URI...`);
            // Safer parsing than strict regex
            const parts = imageUrl.split(',');
            if (parts.length >= 2) {
                // Extract mime type from first part (data:image/jpeg;base64)
                const mimeMatch = parts[0].match(/:(.*?);/);
                mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
                // Join rest as data (in case of extra commas, though unlikely in base64)
                base64Image = parts.slice(1).join(',');
                // Clean whitespace just in case
                base64Image = base64Image.replace(/\s/g, '');
            } else {
                throw new Error("Invalid Data URI format (missing comma)");
            }
        } else {
            console.log(`[Vision] Downloading image from URL: ${imageUrl.substring(0, 50)}...`);
            
            // WAHA Authentication Check
            const headers = { 'User-Agent': 'Mozilla/5.0' };
            if (imageUrl.includes(WAHA_BASE_URL) || imageUrl.includes('wahubbd.salesmanchatbot.online')) {
                console.log('[Vision] Detected WAHA URL. Injecting X-Api-Key.');
                headers['X-Api-Key'] = WAHA_API_KEY;
            } else if (imageUrl.includes('graph.facebook.com') && pageConfig.page_access_token) {
                console.log('[Vision] Detected Facebook Graph URL. Injecting Access Token.');
                headers['Authorization'] = `Bearer ${pageConfig.page_access_token}`;
            }

            const response = await axios.get(imageUrl, { 
                responseType: 'arraybuffer',
                headers: headers,
                timeout: 10000 // 10s timeout
            });
            base64Image = Buffer.from(response.data).toString('base64');
            mimeType = response.headers['content-type'] || 'image/jpeg';
            logDebug(`[Vision] Image Downloaded. Mime: ${mimeType}, Size: ${base64Image.length}`);
        }
    } catch (e) {
        const errorMsg = `[Vision] Pre-processing Failed: ${e.message}`;
        console.error(errorMsg);
        logDebug(errorMsg);
        return `Image found but failed to download/decode. Reason: ${e.message}`;
    }

    // Determine System Prompt
    // UPDATE: Enhanced prompt for Product/Price detection (Messenger specific improvement)
    const systemPrompt = customOptions?.prompt || "Analyze this image in Bengali. Identify the Product Name, Color, Model, and Price (if visible in text). If it's a screenshot, extract product details. If it's a sticker/emoji, ignore it.";

    // --- PRIORITY ATTEMPT (Custom Options) ---
    if (customOptions?.provider === 'openrouter' && customOptions?.model) {
        try {
            const provider = 'openrouter';
            const model = customOptions.model;
            console.log(`[Vision] Priority Attempt: ${model} (${provider})`);

            let keyData = await keyService.getSmartKey(provider, model);
            if (!keyData || !keyData.key) {
                 keyData = await keyService.getSmartKey(provider, 'default');
            }
            
            if (!keyData || !keyData.key) throw new Error("No Key found for OpenRouter");
            const apiKey = keyData.key;
            const url = 'https://openrouter.ai/api/v1/chat/completions';
            
            const payload = {
                model: model,
                messages: [
                    { role: "system", content: systemPrompt },
                    {
                        role: "user",
                        content: [
                            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } }
                        ]
                    }
                ]
            };

            const response = await axios.post(url, payload, {
                headers: { 
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://orderly-conversations.com', 
                    'X-Title': 'Orderly Conversations'
                }
            });

            const result = response.data?.choices?.[0]?.message?.content;
            const usage = response.data?.usage?.total_tokens || 0;

            if (!result) throw new Error("Empty response from OpenRouter");

            logDebug(`[Vision] Success with Priority ${model}: ${result.substring(0, 30)}... Usage: ${usage}`);
            return { text: result, usage: usage };

        } catch (error) {
            const errMsg = error.response?.data?.error?.message || error.message;
            console.warn(`[Vision] Priority Attempt (${customOptions.model}) Failed: ${errMsg}`);
            errors.push(`Priority OpenRouter: ${errMsg}`);
            logDebug(`[Vision] Priority Error: ${errMsg}`);
            // Continue to fallbacks...
        }
    }

    // --- FALLBACK STRATEGY ---
    // Priority 1: Gemini 2.5 Flash
    // Priority 2: Gemini 2.0 Flash Lite (Preview)
    // Priority 3: OpenRouter Best Free Vision (Qwen 2.5 VL)
    
    // ATTEMPT 1: Gemini 2.5 Flash
    try {
        const provider = 'google';
        const model = 'gemini-2.5-flash';
        console.log(`[Vision] Attempt 1: ${model} (${provider})`);
        
        const keyData = await keyService.getSmartKey(provider, model);
        if (!keyData || !keyData.key) throw new Error("No Key found for Gemini 2.5 Flash");

        const apiKey = keyData.key;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        
        // Gemini doesn't strictly separate system prompt in generateContent
        const textPrompt = systemPrompt === "Analyze this image in Bengali. Identify the Product Name, Color, Model, and Price (if visible in text). If it's a screenshot, extract product details. If it's a sticker/emoji, ignore it." 
            ? "Analyze this image in Bengali. Identify the Product Name, Color, Model, and Price (if visible in text). If it's a screenshot, extract product details. If it's a sticker/emoji, ignore it." 
            : systemPrompt;

        const payload = {
            contents: [{
                parts: [
                    { text: textPrompt },
                    { inline_data: { mime_type: mimeType, data: base64Image } }
                ]
            }]
        };

        const visionResponse = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        const result = visionResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        const usage = visionResponse.data?.usageMetadata?.totalTokenCount || 0;

        if (!result) throw new Error("Empty response from Gemini");
        
        logDebug(`[Vision] Success with ${model}: ${result.substring(0, 30)}... Usage: ${usage}`);
        return { text: result, usage: usage };

    } catch (error) {
        const errMsg = error.response?.data?.error?.message || error.message;
        console.warn(`[Vision] Attempt 1 (${'gemini-2.5-flash'}) Failed: ${errMsg}`);
        errors.push(`Gemini 2.5 Flash: ${errMsg}`);
        logDebug(`[Vision] Error 1: ${errMsg}`);
    }

    // ATTEMPT 2: Gemini 2.0 Flash Lite
    try {
        const provider = 'google';
        const model = 'gemini-2.0-flash-lite-preview-02-05'; // Explicit ID
        console.log(`[Vision] Attempt 2: ${model} (${provider})`);
        
        const keyData = await keyService.getSmartKey(provider, model);
        if (!keyData || !keyData.key) throw new Error("No Key found for Gemini 2.0 Flash Lite");

        const apiKey = keyData.key;
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        
        const textPrompt = systemPrompt; // Reuse prompt
        const payload = {
            contents: [{
                parts: [
                    { text: textPrompt },
                    { inline_data: { mime_type: mimeType, data: base64Image } }
                ]
            }]
        };

        const visionResponse = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        const result = visionResponse.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        const usage = visionResponse.data?.usageMetadata?.totalTokenCount || 0;

        if (!result) throw new Error("Empty response from Gemini Lite");

        logDebug(`[Vision] Success with ${model}: ${result.substring(0, 30)}... Usage: ${usage}`);
        return { text: result, usage: usage };

    } catch (error) {
        const errMsg = error.response?.data?.error?.message || error.message;
        console.warn(`[Vision] Attempt 2 (${'gemini-2.0-flash-lite'}) Failed: ${errMsg}`);
        errors.push(`Gemini 2.0 Flash Lite: ${errMsg}`);
        logDebug(`[Vision] Error 2: ${errMsg}`);
    }

    // ATTEMPT 3: OpenRouter (Qwen 2.5 VL - Free)
    try {
        const provider = 'openrouter';
        const model = 'qwen/qwen-2.5-vl-7b-instruct:free';
        console.log(`[Vision] Attempt 3: ${model} (${provider})`);

        let keyData = await keyService.getSmartKey(provider, model);
        if (!keyData || !keyData.key) {
             // Try generic default
             keyData = await keyService.getSmartKey(provider, 'default');
        }
        
        if (!keyData || !keyData.key) throw new Error("No Key found for OpenRouter");

        const apiKey = keyData.key;
        const url = 'https://openrouter.ai/api/v1/chat/completions';
        
        const payload = {
            model: model,
            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: [
                        { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } }
                    ]
                }
            ]
        };

        const response = await axios.post(url, payload, {
            headers: { 
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://orderly-conversations.com', 
                'X-Title': 'Orderly Conversations'
            }
        });

        const result = response.data?.choices?.[0]?.message?.content;
        const usage = response.data?.usage?.total_tokens || 0;

        if (!result) throw new Error("Empty response from OpenRouter");

        logDebug(`[Vision] Success with ${model}: ${result.substring(0, 30)}... Usage: ${usage}`);
        return { text: result, usage: usage };

    } catch (error) {
        const errMsg = error.response?.data?.error?.message || error.message;
        console.warn(`[Vision] Attempt 3 (${'qwen/qwen-2.5-vl-7b-instruct:free'}) Failed: ${errMsg}`);
        errors.push(`OpenRouter Qwen: ${errMsg}`);
        logDebug(`[Vision] Error 3: ${errMsg}`);
    }

    // FINAL FAILURE LOGGING
    const failureReason = `Image Analysis Failed. Reasons: ${errors.join(' | ')}`;
    console.error(`[Vision] All attempts failed. Logs: ${failureReason}`);
    logDebug(`[Vision] FATAL: ${failureReason}`);
    
    return { text: "Image found but analysis unavailable due to technical errors.", usage: 0 };
}

// --- HELPER: Transcribe Audio (Whisper) ---
async function transcribeAudio(audioUrl, config) {
    try {
        console.log(`[Audio] Processing: ${audioUrl.substring(0, 50)}...`);
        logDebug(`[Audio] Starting transcription for URL: ${audioUrl}`);
        
        // 1. Download Audio
        // WAHA Authentication Check
        const headers = { 
            'User-Agent': 'Mozilla/5.0',
            'Accept': '*/*' 
        };
        
        // Check both configured Base URL and the hardcoded domain the user is using
        if (audioUrl.includes(WAHA_BASE_URL) || audioUrl.includes('wahubbd.salesmanchatbot.online')) {
            console.log('[Audio] Detected WAHA URL. Injecting X-Api-Key.');
            logDebug('[Audio] Detected WAHA URL. Injecting X-Api-Key.');
            headers['X-Api-Key'] = WAHA_API_KEY;
        } else if (audioUrl.includes('graph.facebook.com') && config.page_access_token) {
            console.log('[Audio] Detected Facebook Graph URL. Injecting Access Token.');
            headers['Authorization'] = `Bearer ${config.page_access_token}`;
        }

        logDebug(`[Audio] Downloading...`);
        const response = await axios.get(audioUrl, { 
            responseType: 'arraybuffer',
            headers: headers,
            validateStatus: status => status === 200 // Only accept 200 OK
        });
        
        const contentType = response.headers['content-type'] || 'audio/ogg';
        console.log(`[Audio] Downloaded. Size: ${response.data.length}, Type: ${contentType}`);
        logDebug(`[Audio] Downloaded. Size: ${response.data.length}, Type: ${contentType}`);

        // 2. Use Groq Whisper (Fastest)
        const keyData = await keyService.getSmartKey('groq', 'whisper-large-v3');
        if (!keyData || !keyData.key) {
            logDebug(`[Audio] No Groq Key found for transcription.`);
            return "[Audio Message]";
        }
        const apiKey = keyData.key;

        // OpenAI/Groq require FormData for file uploads
        const formData = new FormData();
        
        // Smart Extension Handling: If opus is mentioned, use .opus, otherwise default to .ogg or .mp3
        let filename = 'audio.ogg';
        if (contentType.includes('opus')) filename = 'audio.opus';
        else if (contentType.includes('mp3') || contentType.includes('mpeg')) filename = 'audio.mp3';
        else if (contentType.includes('wav')) filename = 'audio.wav';
        else if (contentType.includes('m4a')) filename = 'audio.m4a';

        formData.append('file', Buffer.from(response.data), { 
            filename: filename, 
            contentType: contentType 
        });
        
        formData.append('model', 'whisper-large-v3');
        formData.append('language', 'bn'); // Force Bengali
        formData.append('prompt', 'This audio is in Bengali language. Transcribe it exactly as spoken in Bengali script.'); // Context Prompt
        formData.append('temperature', '0'); // Deterministic for accuracy

        logDebug(`[Audio] Sending to Groq Whisper...`);
        const transcriptionResponse = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${apiKey}`
            },
            timeout: 10000 // 10s timeout
        });

        const text = transcriptionResponse.data.text;
        if (!text || !text.trim()) {
            logDebug(`[Audio] Transcription empty.`);
            return "[Audio Message (Empty/Silence)]";
        }

        console.log(`[Audio] Transcription: "${text.substring(0, 30)}..."`);
        logDebug(`[Audio] Success: "${text}"`);
        // Return raw text to simulate SMS-like behavior as per user request
        return text;

    } catch (error) {
        const errMsg = error.response?.data?.error?.message || error.message;
        console.error(`[Audio] Transcription Error:`, errMsg);
        logDebug(`[Audio] Failed: ${errMsg}`);
        if (error.response) {
            logDebug(`[Audio] Response Data: ${JSON.stringify(error.response.data)}`);
        }
        return `[Audio Message (Transcription Failed: ${errMsg})]`;
    }
}

module.exports = {
    generateReply,
    generateResponse,
    fetchOgImage,
    processImageWithVision,
    transcribeAudio
};
