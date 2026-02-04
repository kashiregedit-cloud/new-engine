const keyService = require('./keyService');
const commandApiService = require('./commandApiService'); // Command API Table Strategy
const axios = require('axios');
const OpenAI = require('openai');
const FormData = require('form-data');
const crypto = require('crypto');

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
async function generateResponse({ pageId, userId, userMessage, history, imageUrls, audioUrls, config, platform }) {
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
        audioUrls
    );
}

// Step 2: Business Logic / AI Brain
async function generateReply(userMessage, pageConfig, pagePrompts, history = [], senderName = 'Customer', senderGender = null, imageUrls = [], audioUrls = []) {
    
    // --- MULTI-TENANCY SAFETY CHECK ---
    const pageId = pageConfig.page_id;
    
    // Check Cheap Engine Flag (Default to TRUE if undefined/null, for zero-cost)
    const useCheapEngine = pageConfig.cheap_engine !== false;

    const promptPreview = pagePrompts?.text_prompt ? pagePrompts.text_prompt.substring(0, 30) : "DEFAULT";
    console.log(`[AI Isolation Check] Generating for Page ID: ${pageId} | CheapEngine: ${useCheapEngine} | Sender: ${senderName} | Prompt: "${promptPreview}..."`);
    // ----------------------------------

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
        'gemini-2.0-flash-exp': 'gemini-2.0-flash', 
        'gemini-2.5-pro': 'gemini-2.5-pro-preview', 
        'gemini-2.5-flash-lite': 'gemini-2.0-flash-lite-preview-02-05',
        'groq-fast': 'llama-3.3-70b-versatile', 
        'groq-speed': 'llama-3.1-8b-instant', 
        'grok-4.1-fast': 'llama-3.3-70b-versatile',
    };

    if (MODEL_ALIASES[defaultModel]) {
        defaultModel = MODEL_ALIASES[defaultModel];
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
8. Output RAW JSON:
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
                        return { ...parsed, token_usage: tokenUsage, model: defaultModel };
                    } catch (e) {
                        return { reply: rawContent, sentiment: 'neutral', model: defaultModel };
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
                try {
                    const parsed = JSON.parse(rawContent);
                    if (!parsed.reply) parsed.reply = parsed.response || parsed.text;
                    return { ...parsed, model: modelToUse };
                } catch (e) {
                    return { reply: rawContent, sentiment: 'neutral', model: modelToUse };
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

// --- HELPER: Process Image (Vision) ---
async function processImageWithVision(imageUrl, config) {
    try {
        console.log(`[Vision] Processing: ${imageUrl.substring(0, 50)}...`);
        // 1. Download Image to Base64
        const response = await axios.get(imageUrl, { 
            responseType: 'arraybuffer',
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const base64Image = Buffer.from(response.data).toString('base64');
        const mimeType = response.headers['content-type'] || 'image/jpeg';

        // 2. Use Gemini Flash (Multimodal) - It's fast and free/cheap
        const keyData = await keyService.getSmartKey('google', 'gemini-1.5-flash');
        if (!keyData || !keyData.key) return "Image found but analysis unavailable.";
        const apiKey = keyData.key;

        const openai = new OpenAI({ 
            apiKey: apiKey, 
            baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' 
        });

        const completion = await openai.chat.completions.create({
            model: "gemini-1.5-flash",
            messages: [
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Describe this image in Bengali. Keep it short (1-2 sentences). Focus on product details if any." },
                        { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } }
                    ]
                }
            ],
            max_tokens: 100
        });

        return completion.choices[0].message.content || "Image content unclear.";

    } catch (error) {
        console.error(`[Vision] Error:`, error.message);
        return "Image processing failed.";
    }
}

// --- HELPER: Transcribe Audio (Whisper) ---
async function transcribeAudio(audioUrl, config) {
    try {
        console.log(`[Audio] Processing: ${audioUrl.substring(0, 50)}...`);
        
        // 1. Download Audio
        const response = await axios.get(audioUrl, { 
            responseType: 'arraybuffer',
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        // 2. Use Groq Whisper (Fastest)
        const keyData = await keyService.getSmartKey('groq', 'whisper-large-v3');
        if (!keyData || !keyData.key) return "[Audio Message]";
        const apiKey = keyData.key;

        // OpenAI/Groq require FormData for file uploads
        const formData = new FormData();
        formData.append('file', Buffer.from(response.data), { filename: 'audio.ogg', contentType: response.headers['content-type'] || 'audio/ogg' });
        formData.append('model', 'whisper-large-v3');
        formData.append('language', 'bn'); // Bengali Hint

        const transcriptionResponse = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': `Bearer ${apiKey}`
            }
        });

        return `[User Audio Message: "${transcriptionResponse.data.text}"]`;

    } catch (error) {
        console.error(`[Audio] Error:`, error.message);
        return "[Audio Message (Transcription Failed)]";
    }
}

module.exports = {
    generateReply,
    generateResponse,
    fetchOgImage,
    processImageWithVision,
    transcribeAudio
};
