const keyService = require('./keyService');
const commandApiService = require('./commandApiService'); // Command API Table Strategy
const axios = require('axios');
const OpenAI = require('openai');
const FormData = require('form-data');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// --- DYNAMIC FREE MODEL OPTIMIZER (OpenRouter) ---
// User Request: Dynamically fetch best free models using Gemini (Cheap Engine) to analyze the list.
let bestFreeModels = {
    text: 'google/gemini-2.0-flash-lite-preview-02-05:free', // Default fallback
    vision: 'qwen/qwen-2.5-vl-7b-instruct:free', 
    voice: 'google/gemini-2.0-flash-lite-preview-02-05:free' 
};

async function updateBestFreeModels() {
    try {
        console.log('[AI Optimizer] Fetching latest free models from OpenRouter...');
        const response = await axios.get('https://openrouter.ai/api/v1/models');
        const models = response.data.data;
        
        if (!models || !Array.isArray(models)) throw new Error("Invalid response format");

        // Filter for Strictly Free Models (Prompt & Completion = 0)
        const freeModels = models.filter(m => 
            m.pricing && 
            (m.pricing.prompt === "0" || m.pricing.prompt === 0) && 
            (m.pricing.completion === "0" || m.pricing.completion === 0)
        );

        if (freeModels.length === 0) {
            console.warn('[AI Optimizer] No free models found. Keeping defaults.');
            return;
        }

        // Limit to Top 50 to capture new high-potential models like stepfun/upstage
        freeModels.sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
        // User Update: Analyze ALL free models, not just top 50.
        const candidates = freeModels.map(m => ({
            id: m.id,
            name: m.name,
            context: m.context_length,
            modality: m.architecture?.modality || 'text',
            description: m.description // Help AI understand model capabilities
        }));

        // --- GEMINI SELECTION LOGIC (Cheap Engine) ---
        // We use Gemini 2.0 Flash to pick the best models from the list
        try {
            console.log(`[AI Optimizer] Asking Gemini to select best models from ${candidates.length} candidates...`);
            const keyData = await keyService.getSmartKey('google', 'gemini-2.0-flash');
            
            if (keyData && keyData.key) {
                const prompt = `
You are an expert AI Engineer. Analyze this COMPLETE list of FREE OpenRouter models and pick the ABSOLUTE BEST ones for a production chatbot.

Candidates: ${JSON.stringify(candidates)}

Requirements:
1. TEXT: Select the BEST General Chat Model. 
   - Look for high intelligence, reasoning, and instruction following.
   - Do NOT just pick 'Google' or 'Meta' brands. Look for 'Pro', 'Max', 'Ultra' or 'Reasoning' variants even from lesser known providers like 'Upstage', 'Stepfun', 'Mistral', 'Qwen' etc.
   - High context is good, but smartness is priority.
2. VISION: Best Multimodal Model. Must support images (Gemini, Qwen VL, Llama 3.2 Vision).
3. VOICE: Fastest model for text generation (Flash/Lite/Instant variants).

Return ONLY valid JSON:
{
  "text": "model_id",
  "vision": "model_id",
  "voice": "model_id"
}`;
                const openai = new OpenAI({ 
                    apiKey: keyData.key, 
                    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' 
                });

                const completion = await openai.chat.completions.create({
                    model: 'gemini-2.0-flash',
                    messages: [{ role: 'user', content: prompt }],
                    response_format: { type: "json_object" }
                });

                const result = JSON.parse(completion.choices[0].message.content);
                
                if (result.text && result.vision && result.voice) {
                    bestFreeModels = result;
                    console.log('[AI Optimizer] Gemini Selected Models:', bestFreeModels);
                } else {
                    throw new Error("Invalid JSON structure from Gemini");
                }
            } else {
                throw new Error("No Gemini keys available for optimizer.");
            }
        } catch (geminiError) {
            console.warn('[AI Optimizer] Gemini Selection Failed:', geminiError.message);
            console.log('[AI Optimizer] Falling back to rule-based selection.');
            
            // Fallback: Rule-based (Previous Logic)
             const reliableProviders = /gemini|llama-3|mistral|qwen/i;
             let bestText = freeModels.find(m => reliableProviders.test(m.id) && !m.id.includes('vision')) || freeModels[0];
             let bestVision = freeModels.find(m => m.id.includes('gemini-2.0') || m.id.includes('qwen-2.5')) || freeModels[0];
             let bestVoice = freeModels.find(m => m.id.includes('flash') && m.id.includes('gemini')) || bestText;

             bestFreeModels = { text: bestText.id, vision: bestVision.id, voice: bestVoice.id };
             console.log('[AI Optimizer] Rule-based Selected Models:', bestFreeModels);
        }

    } catch (e) {
        console.warn('[AI Optimizer] Failed to update free models:', e.message);
    }
}

// Schedule: Run every 2 hours
setInterval(updateBestFreeModels, 2 * 60 * 60 * 1000);
// Run immediately on startup
updateBestFreeModels();
// -----------------------------------------------------

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
    let userModel = (pageConfig.chat_model && pageConfig.chat_model !== 'default') ? pageConfig.chat_model.trim() : null;
    
    // AUTO MODEL SELECTION (User Request: "openrouter/auto")
    if (userModel === 'openrouter/auto') {
        console.log(`[AI] Auto-Model Selected. Using best free model: ${bestFreeModels.text}`);
        userModel = bestFreeModels.text;
    }

    const userProvider = pageConfig.ai || pageConfig.operator; 

    let defaultProvider = userProvider || (useCheapEngine ? dynamicProvider : 'gemini');
    let defaultModel = userModel;

    // IF User did NOT specify a model (null), pick a smart default based on the Provider
    if (!defaultModel) {
        if (defaultProvider === 'gemini') {
            defaultModel = 'gemini-2.5-flash'; 
        } else if (defaultProvider === 'openrouter') {
            defaultModel = useCheapEngine ? dynamicModel : 'arcee-ai/trinity-large-preview';
        } else if (defaultProvider === 'groq') {
            defaultModel = 'llama-3.3-70b-versatile';
        } else {
            defaultModel = useCheapEngine ? dynamicModel : 'gemini-2.5-flash'; 
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
        fallbackModel = bestFreeModels.text || 'google/gemini-2.0-flash-lite-preview-02-05:free'; // Dynamic Fallback
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
    // User Request: Strong Prompt Engineering for OpenRouter Stability & Bengali
    if (defaultProvider === 'openrouter' || useCheapEngine) {
        personaInstruction = `
### SYSTEM OVERRIDE: STABILITY & LANGUAGE PROTOCOL ###
You are a sophisticated AI Assistant optimized for BENGALI communication.
Your primary directive is to provide STABLE, ACCURATE, and BENGALI responses.

[MANDATORY RULES]
1. **LANGUAGE ENFORCEMENT (বাংলা)**: 
   - You MUST reply in BENGALI.
   - Translate any English concepts into natural Bengali.
   - Do NOT use broken Bengali. Use formal/polite forms (আপনি/আপনার).
2. **ANSWER STABILITY**:
   - Analyze the 'Ctx' (Context) carefully.
   - If the user asks something outside the 'Ctx', politely decline in Bengali.
   - Do NOT hallucinate or invent features.
   - IGNORE minor typos in user input; infer intent.
3. **FORMATTING**:
   - Keep replies SHORT and TO THE POINT.
   - No preambles like "Here is your response". Just the answer.
`;
    } else {
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
                const openai = new OpenAI({ 
                    apiKey: currentKey, 
                    baseURL: baseURL,
                    timeout: 25000 // 25s Timeout for User Keys
                });
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
                
                // STRICT OWN API LOCK: If User specified a chatmodel, they want THAT model.
                // If it fails, do NOT fallback to System Keys (which use different models).
                if (pageConfig.chatmodel && pageConfig.chatmodel.trim() !== '') {
                     console.error(`[AI] Strict Own API Failed. Not falling back to Phase 2.`);
                     return { 
                        reply: null, // Silent failure or error message? 
                        // User prefers silent fail or system error? usually system error log.
                        // We return null so controller handles it.
                        token_usage: 0,
                        model: defaultModel
                     };
                }
            }
        }
    }

    // Phase 2: Fallback to Cheap Engine / Dynamic Config
    console.log(`[AI] Phase 2: Using Strict Priority Engine Chain...`);

    // Strict Priority Chain (User Request):
    // 1. Gemini 2.5 Flash (ID: gemini-2.5-flash)
    // 2. Gemini 2.5 Flash Lite (ID: gemini-2.5-flash-lite)
    // 3. OpenRouter Best Free Model (Dynamic)

    const priorityChain = [
        { provider: 'google', model: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
        { provider: 'google', model: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
        { provider: 'openrouter', model: bestFreeModels.text, name: `OpenRouter Free (${bestFreeModels.text})` }
    ];

    for (const option of priorityChain) {
        let keyData = null; // Defined outside try for error handling
        try {
            console.log(`[AI] Phase 2 Attempt: ${option.name} (${option.model})...`);
            
            // Get Key
            keyData = await keyService.getSmartKey(option.provider, option.model);
            if (!keyData || !keyData.key) {
                // If specific key not found, try generic for provider
                const genericKey = await keyService.getSmartKey(option.provider, 'default');
                if (!genericKey || !genericKey.key) {
                    console.warn(`[AI] No keys found for ${option.name}. Skipping.`);
                    continue;
                }
                keyData = genericKey; // Use generic key
            }
            
            const apiKey = keyData.key;
            let baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
            if (option.provider === 'openrouter') baseURL = 'https://openrouter.ai/api/v1';

            const openai = new OpenAI({ 
                apiKey: apiKey, 
                baseURL: baseURL,
                timeout: 15000 // 15s Timeout per Attempt (Phase 2)
            });
            
            const completion = await openai.chat.completions.create({
                model: option.model,
                messages: messages,
                response_format: { type: "json_object" }
            });

            if (completion.choices && completion.choices.length > 0) {
                const rawContent = completion.choices[0].message.content;
                const tokenUsage = completion.usage ? completion.usage.total_tokens : 0;
                
                // Success! Record Token Usage (But do NOT increment request count again)
                keyService.recordKeyUsage(apiKey, tokenUsage);

                try {
                    const parsed = JSON.parse(rawContent);
                    if (!parsed.reply) parsed.reply = parsed.response || parsed.text;
                    return { ...parsed, model: option.model, token_usage: tokenUsage + totalTokenUsage };
                } catch (e) {
                    return { reply: rawContent, sentiment: 'neutral', model: option.model, token_usage: tokenUsage + totalTokenUsage };
                }
            }

        } catch (error) {
            console.warn(`[AI] Phase 2 Attempt (${option.name}) Failed:`, error.message);
            
            // CIRCUIT BREAKER / ERROR HANDLING
            if (keyData && keyData.key) {
                const status = error.status || (error.response ? error.response.status : null);
                
                if (status === 429 || error.message.includes('429') || error.message.includes('quota') || error.message.includes('Too Many Requests')) {
                    // Rate Limit / Quota Exceeded -> Ban for rest of day (RPD) or 1 min (RPM)
                    // Since we have optimistic increment, this is likely a HARD limit (RPD) or strict RPM.
                    // Let's be safe and assume RPM first (1 min ban) unless message says "quota"
                    if (error.message.toLowerCase().includes('quota')) {
                         keyService.markKeyAsQuotaExceeded(keyData.key);
                    } else {
                         keyService.markKeyAsDead(keyData.key, 60 * 1000, 'rate_limit_429');
                    }
                } else if (status === 401 || status === 403) {
                    // Auth Error -> Ban permanently (24h)
                    keyService.markKeyAsDead(keyData.key, 24 * 60 * 60 * 1000, 'auth_error');
                } else if (status >= 500) {
                    // Server Error -> Temporary backoff (1 min)
                    keyService.markKeyAsDead(keyData.key, 60 * 1000, 'server_error');
                }
            }
            // Continue to next priority...
        }
    }

    console.error("[AI] All Phase 2 attempts failed.");
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
                },
                timeout: 20000 // 20s Timeout
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
            headers: { 'Content-Type': 'application/json' },
            timeout: 20000 // 20s Timeout
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

    // ATTEMPT 2: Gemini 2.5 Flash Lite
    try {
        const provider = 'google';
        const model = 'gemini-2.5-flash-lite'; // Use Alias for consistency
        console.log(`[Vision] Attempt 2: ${model} (${provider})`);
        
        const keyData = await keyService.getSmartKey(provider, model);
        if (!keyData || !keyData.key) throw new Error("No Key found for Gemini 2.5 Flash Lite");

        const apiKey = keyData.key;
        // Use the ACTUAL model ID for the API call (via alias map or direct if alias works)
        // Since we are calling the API directly, we need the real ID.
        // We can use the MODEL_ALIASES map if available, or just hardcode the real ID here.
        // But wait, the previous code used the real ID directly.
        // Let's check if MODEL_ALIASES is accessible here. It is defined in generateReply scope.
        // We should define it globally or duplicate it.
        // Or better, just use the real ID for the URL but 'gemini-2.5-flash-lite' for the key service.
        
        const realModelId = 'gemini-2.0-flash-lite-preview-02-05'; 
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${realModelId}:generateContent?key=${apiKey}`;
        
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
        console.warn(`[Vision] Attempt 2 (${'gemini-2.5-flash-lite'}) Failed: ${errMsg}`);
        errors.push(`Gemini 2.5 Flash Lite: ${errMsg}`);
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

// --- HELPER: Transcribe Audio (Multi-Engine Priority) ---
async function transcribeAudio(audioUrl, config) {
    console.log(`[Audio] Processing: ${audioUrl.substring(0, 50)}...`);
    let audioBuffer, mimeType;

    // 1. Download Audio
    try {
        const headers = { 'User-Agent': 'Mozilla/5.0' };
        if (audioUrl.includes(WAHA_BASE_URL)) headers['X-Api-Key'] = WAHA_API_KEY;
        else if (audioUrl.includes('graph.facebook.com') && config.page_access_token) headers['Authorization'] = `Bearer ${config.page_access_token}`;

        const response = await axios.get(audioUrl, { responseType: 'arraybuffer', headers, validateStatus: s => s === 200 });
        audioBuffer = Buffer.from(response.data);
        const contentType = response.headers['content-type'] || 'audio/ogg';
        
        // Map to Gemini-supported MIME types
        if (contentType.includes('opus') || contentType.includes('ogg')) mimeType = 'audio/ogg';
        else if (contentType.includes('mp3') || contentType.includes('mpeg')) mimeType = 'audio/mp3';
        else if (contentType.includes('wav')) mimeType = 'audio/wav';
        else if (contentType.includes('aac')) mimeType = 'audio/aac';
        else mimeType = 'audio/ogg'; // Default safe assumption
        
        logDebug(`[Audio] Downloaded. Size: ${audioBuffer.length}, Type: ${mimeType}`);

    } catch (e) {
        console.error(`[Audio] Download Failed:`, e.message);
        return "[Audio Download Failed]";
    }

    // 2. Priority Chain: Gemini 2.5 Flash -> Lite -> OpenRouter -> Groq (Fallback)
    const priorityChain = [
        { provider: 'google', model: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
        { provider: 'google', model: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
        // Only try OpenRouter if it's a known multimodal model that might support audio (Gemini/Qwen usually don't via standard chat API for audio)
        // But we will try if bestFreeModels.voice is set to a Gemini model
        { provider: 'openrouter', model: bestFreeModels.voice, name: `OpenRouter Voice (${bestFreeModels.voice})` }
    ];

    for (const option of priorityChain) {
        try {
            // Skip OpenRouter if it's just a text model (not mapped to Gemini/Multimodal)
            if (option.provider === 'openrouter' && !option.model.includes('gemini') && !option.model.includes('claude')) {
                // Most OpenRouter models don't support audio input via Chat API yet.
                // We skip to avoid errors, unless we are sure.
                continue; 
            }

            console.log(`[Audio] Attempting Transcription with ${option.name}...`);
            const keyData = await keyService.getSmartKey(option.provider, option.model);
            if (!keyData || !keyData.key) continue;
            
            const apiKey = keyData.key;
            
            // GEMINI DIRECT API
            if (option.provider === 'google' || option.model.includes('google/gemini')) {
                const baseUrl = option.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://generativelanguage.googleapis.com/v1beta';
                
                // If OpenRouter, we need to check if they support 'inline_data' or OpenAI 'image_url' (audio?)
                // OpenRouter Gemini support usually follows OpenAI spec or Google spec.
                // Safest is to use Google Direct for Google models. 
                // If OpenRouter, we might skip for now as audio input support is experimental there.
                if (option.provider === 'openrouter') continue; 

                const url = `${baseUrl}/models/${option.model}:generateContent?key=${apiKey}`;
                const payload = {
                    contents: [{
                        parts: [
                            { text: "Transcribe this audio in Bengali exactly as spoken. Output ONLY the transcription." },
                            { inline_data: { mime_type: mimeType, data: audioBuffer.toString('base64') } }
                        ]
                    }]
                };
                
                const res = await axios.post(url, payload);
                const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
                
                if (text) {
                    console.log(`[Audio] Success with ${option.name}: "${text.substring(0, 30)}..."`);
                    return text.trim();
                }
            }
            
        } catch (e) {
             console.warn(`[Audio] ${option.name} Failed:`, e.message);
        }
    }

    // 3. Fallback to Groq Whisper (Existing Reliable Method)
    try {
        console.log(`[Audio] Falling back to Groq Whisper...`);
        const keyData = await keyService.getSmartKey('groq', 'whisper-large-v3');
        if (!keyData || !keyData.key) return "[Audio Message]";
        const apiKey = keyData.key;

        const formData = new FormData();
        formData.append('file', audioBuffer, { filename: `audio.${mimeType.split('/')[1]}`, contentType: mimeType });
        formData.append('model', 'whisper-large-v3');
        formData.append('language', 'bn'); 
        formData.append('prompt', 'Transcribe exactly in Bengali.');
        formData.append('temperature', '0');

        const res = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: { ...formData.getHeaders(), 'Authorization': `Bearer ${apiKey}` },
            timeout: 10000
        });

        if (res.data.text) return res.data.text;

    } catch (e) {
        console.error(`[Audio] Groq Fallback Failed:`, e.message);
    }

    return "[Audio Message (Transcription Failed)]";
}

module.exports = {
    generateReply,
    generateResponse,
    fetchOgImage,
    processImageWithVision,
    transcribeAudio
};
