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

// Step 2: Business Logic / AI Brain
async function generateReply(userMessage, pageConfig, pagePrompts, history = [], senderName = 'Customer') {
    
    // --- 0. SMART CACHE CHECK (Zero Cost) ---
    // DISABLED TEMPORARILY TO FIX CROSS-PAGE LEAK
    // const cacheKey = getCacheKey(pageConfig.page_id, userMessage, senderName);
    // const cachedItem = responseCache.get(cacheKey);
    
    // if (cachedItem) {
    //     const isFresh = (Date.now() - cachedItem.timestamp) < CACHE_TTL_MS;
    //     if (isFresh) {
    //         console.log(`[AI CACHE] Hit! Returning cached reply for: "${userMessage}"`);
    //         return cachedItem.reply;
    //     } else {
    //         responseCache.delete(cacheKey); // Expired
    //     }
    // }
    // ----------------------------------------

    // --- MULTI-TENANCY SAFETY CHECK ---
    const pageId = pageConfig.page_id;
    
    // Check Cheap Engine Flag (Default to TRUE if undefined/null, for zero-cost)
    const useCheapEngine = pageConfig.cheap_engine !== false;

    const promptPreview = pagePrompts?.text_prompt ? pagePrompts.text_prompt.substring(0, 30) : "DEFAULT";
    console.log(`[AI Isolation Check] Generating for Page ID: ${pageId} | CheapEngine: ${useCheapEngine} | Sender: ${senderName} | Prompt: "${promptPreview}..."`);
    // ----------------------------------

    // 1. Prepare Configuration
    // Logic: 
    // - If pageConfig.ai is set, use it (Gemini vs OpenRouter).
    // - If pageConfig.chat_model is set, use it (User strict choice).
    // - Cheap Engine flag is ignored if user explicitly sets configuration.
    
    // FETCH DYNAMIC CONFIG from DB (Zero Cost Engine)
    // NOTE: Gemini models on OpenRouter are NOT free. We default to a truly free OpenRouter model.
    let dynamicProvider = 'openrouter'; 
    let dynamicModel = 'arcee-ai/trinity-large-preview'; // Verified Free Model (High Performance) - Display name (clean)
    let fallbackModel = 'google/gemini-2.0-flash-lite-preview-02-05:free'; // Try this as backup

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
    // Treat 'default' or 'auto' as null to trigger fallback
    const userModel = (pageConfig.chat_model && pageConfig.chat_model !== 'default') ? pageConfig.chat_model.trim() : null;
    const userProvider = pageConfig.ai || pageConfig.operator; // 'ai' column in DB usually holds 'gemini', 'openrouter', etc.

    // IF user explicitly wants Gemini (via AIzaSy key), we switch provider to 'google' (Direct API is free)
    // BUT if they rely on OpenRouter (sk-or-v1), we must respect the free model default.
    let defaultProvider = userProvider || (useCheapEngine ? dynamicProvider : 'gemini');
    let defaultModel = userModel;

    // IF User did NOT specify a model (null), pick a smart default based on the Provider
    if (!defaultModel) {
        if (defaultProvider === 'gemini') {
            defaultModel = 'gemini-1.5-flash'; // Safe default for Gemini Provider
        } else if (defaultProvider === 'openrouter') {
            defaultModel = useCheapEngine ? dynamicModel : 'arcee-ai/trinity-large-preview';
        } else if (defaultProvider === 'groq') {
            defaultModel = 'llama-3.3-70b-versatile';
        } else {
            defaultModel = useCheapEngine ? dynamicModel : 'gemini-1.5-flash'; // Catch-all
        }
    }

    // CORRECTION: If provider is OpenRouter but model is Gemini (and not marked free), warn or switch?
    // User says: "Gemini is not free on OpenRouter".
    // So if we are using OpenRouter default, we ensure it's NOT Gemini unless configured.
    // BUT if user explicitly chose it (userModel is set), we respect it.
    if (!userModel && defaultProvider === 'openrouter' && defaultModel.includes('gemini') && !defaultModel.includes(':free')) {
        console.warn(`[AI] Warning: ${defaultModel} on OpenRouter might not be free. Switching to free fallback.`);
        defaultModel = 'arcee-ai/trinity-large-preview';
    }

    console.log(`[AI] Final Engine Config: ${defaultProvider} / ${defaultModel} (Fallback: ${fallbackModel || 'None'})`);

    // --- SMART FALLBACK: If Prompt is Huge, Groq will fail (12k TPM limit). Switch to Gemini. ---
    // Estimate: 1 Token ~= 3-4 chars (English), but 1 Token ~= 1-2 chars (Bengali).
    // Safe Limit for Groq: 6,000 - 8,000 tokens.
    // Let's check the raw length of system prompt + user message.
    
    // ADJUSTMENT FOR ZERO COST: 
    // If using OpenRouter/Arcee, we don't need to fear 15k chars.
    // Only apply this check strictly for GROQ.
    
    const effectivePromptLen = (pagePrompts?.text_prompt?.length || 0);
    const estimatedChars = effectivePromptLen + userMessage.length + 2000; 
    
    // Only Switch if using Groq AND it's too big. OpenRouter can handle it.
    if (defaultProvider === 'groq' && estimatedChars > 15000) {
        console.log(`[AI] Context is huge (~${estimatedChars} chars) for GROQ. Switching to Gemini 1.5 Flash.`);
        defaultProvider = 'gemini';
        defaultModel = 'gemini-1.5-flash';
    }
    // -------------------------------------------------------------------------------------------
 

    // --- MODEL NAME NORMALIZATION & ALIASES ---
    const MODEL_ALIASES = {
        'gemini-2.0-flash-exp': 'gemini-2.0-flash', // Auto-upgrade old "exp" users to latest 2.0
        'gemini-2.5-pro': 'gemini-2.5-pro-preview', // Assuming preview for now
        'gemini-2.5-flash': 'gemini-2.0-flash', // Map 2.5 Flash to stable 2.0 Flash (API doesn't support 2.5 yet)
        'gemini-2.5-flash-lite': 'gemini-2.0-flash-lite-preview-02-05', // Map friendly name to official ID
        // Groq Aliases
        'groq-fast': 'llama-3.3-70b-versatile', // Best balance of speed/quality on Groq
        'groq-speed': 'llama-3.1-8b-instant', // Fastest, lower intelligence
        'grok-4.1-fast': 'llama-3.3-70b-versatile', // Map User's "Grok" request to Groq's Llama 3.3
    };

    if (MODEL_ALIASES[defaultModel]) {
        console.log(`[AI] Mapping alias '${defaultModel}' to official ID '${MODEL_ALIASES[defaultModel]}'`);
        defaultModel = MODEL_ALIASES[defaultModel];
    }
    // -------------------------------------------------
    
    // --- IMAGE DETECTION ---
    let imageUrls = [];
    let cleanUserMessage = userMessage;
    // Regex to extract "[User sent images: url1, url2]" pattern from webhookController
    const imageMatch = userMessage.match(/\[User sent images: (.*?)\]/);
    if (imageMatch && imageMatch[1]) {
        imageUrls = imageMatch[1].split(',').map(url => url.trim());
        cleanUserMessage = userMessage.replace(imageMatch[0], '').trim(); 
        console.log(`[AI] Detected ${imageUrls.length} images. Enabling Vision Mode.`);
    }

    // Updated Vision Models List
    const VISION_MODELS = [
        'gemini-3-pro', 'gemini-3-flash', 
        'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro',
        'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.0-pro-exp',
        'gemini-1.5-flash', 'gemini-1.5-pro', 
        'gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet'
    ];
    // ----------------------------------------

    // --- RAG REMOVED BY USER REQUEST ---
    let contextChunk = "";
    // -----------------------------------

    // --- OPTIMIZATION: Truncate Context for Cheap/Groq Engine ---
    // Groq has strict TPM limits. We must limit context size.
    // REVERTED BY USER REQUEST: "token besi kaileo output amr valo dorakar" - Disable history truncation
    if (false) { // was: if (useCheapEngine || defaultProvider === 'groq')
        // 1. Limit History
        const MAX_HISTORY = 4; // Keep last 4 messages (2 turns) for safety
        if (history.length > MAX_HISTORY) {
            console.log(`[AI] Truncating history from ${history.length} to ${MAX_HISTORY} for Cheap Engine.`);
            history = history.slice(-MAX_HISTORY);
        }
    }

    // --- PROMPT & MESSAGE CONSTRUCTION ---
    // Define base system prompt
    let basePrompt = pagePrompts?.text_prompt || "You are a helpful assistant.";

    // ZERO COST OPTIMIZATION: SAFE TOKEN CONTROL
    // Strategy: 
    // 1. "Behavior" (System Prompt) is capped at ~1000 chars. 
    // 2. We ONLY truncate if we successfully retrieved Data from RAG (KB).
    //    If RAG is empty (User didn't ingest data), we MUST keep the full prompt to ensure Output Quality.
    
    // FORCE OPTIMIZATION if Prompt is HUGE (> 8000 chars ~= 2000 tokens), even if CheapEngine is false.
    // This meets User's requirement: "system prompt jotoi long hok... token kabe 1500-2K".
    const SAFE_TOKEN_CHAR_LIMIT = 8000; 

    // REVERTED BY USER REQUEST: "rag er ager version ta ano"
    // We are RE-ENABLING the Smart/Mini-RAG filtering to fix context leaks/hallucinations caused by huge prompts.
    // if (basePrompt.length > SAFE_TOKEN_CHAR_LIMIT) {
    if (false) { // DISABLED: Always send full prompt for now
        console.log(`[AI DEBUG] Checking Smart Optimization. ContextChunk Length: ${contextChunk ? contextChunk.length : 0}`);
        
        // DYNAMIC PROMPT FILTERING (MINI-RAG)
        // Goal: Reduce Huge System Prompt to < 2000 chars while keeping RELEVANT data.
        // Strategy:
        // 1. Keep the first 1000 chars (Persona/Rules) ALWAYS.
        // 2. Split the rest of the prompt into paragraphs/lines.
        // 3. Filter paragraphs that contain keywords from the User Message.
        // 4. If no keywords match, keep a minimal fallback.

        const BEHAVIOR_LIMIT = 1000;

        if (basePrompt.length > SAFE_TOKEN_CHAR_LIMIT) {
            console.log(`[AI] System Prompt is HUGE (${basePrompt.length} chars). Applying Smart Dynamic Filtering...`);
            
            // 1. Extract Persona (First ~1000 chars)
            const personaSection = basePrompt.substring(0, BEHAVIOR_LIMIT);
            const dataSection = basePrompt.substring(BEHAVIOR_LIMIT);

            // 2. Extract Keywords from User Message (Simple Tokenization)
            // Remove common stop words (Bengali/English) for better matching
            const stopWords = ['ami', 'tumi', 'ki', 'eta', 'koto', 'kobe', 'hello', 'hi', 'price', 'dam', 'is', 'the', 'a', 'an', 'in', 'on', 'please', 'help', 'product', 'products'];
            let searchTerms = cleanUserMessage.toLowerCase()
                .replace(/[^\w\s\u0980-\u09FF]/g, '') // Keep Bengali & English chars
                .split(/\s+/)
                .filter(w => w.length > 2 && !stopWords.includes(w));
            
            // 2b. SYNONYM EXPANSION (Fuzzy Match Support)
            const SYNONYMS = {
                'price': ['dam', 'mullo', 'taka', 'cost', 'rate', 'pricing'],
                'dam': ['price', 'mullo', 'taka', 'cost', 'rate'],
                'delivery': ['shipping', 'pathano', 'charge', 'courier'],
                'size': ['map', 'measurement', 'fitting', 'bor', 'choto'],
                'location': ['thikana', 'address', 'office', 'shop', 'kothay'],
                'thikana': ['location', 'address', 'office', 'shop', 'kothay'],
                'order': ['buy', 'kinbo', 'nib', 'nibo', 'booking'],
                'kinbo': ['order', 'buy', 'nib', 'nibo', 'booking']
            };

            const expandedTerms = new Set(searchTerms);
            searchTerms.forEach(term => {
                if (SYNONYMS[term]) {
                    SYNONYMS[term].forEach(syn => expandedTerms.add(syn));
                }
                // Reverse lookup check (if term is a value in map)
                Object.keys(SYNONYMS).forEach(key => {
                    if (SYNONYMS[key].includes(term)) expandedTerms.add(key);
                });
            });
            searchTerms = Array.from(expandedTerms);

            console.log(`[AI] Filtering Data Section using expanded terms: ${searchTerms.join(', ')}`);

            if (searchTerms.length > 0) {
                // 3. Filter Paragraphs with Context Window
                const paragraphs = dataSection.split(/\n\s*\n/); // Split by double newline (paragraphs)
                const relevantIndices = new Set();

                paragraphs.forEach((para, index) => {
                    const lowerPara = para.toLowerCase();
                    if (searchTerms.some(term => lowerPara.includes(term))) {
                        // Add current, previous, and next paragraph for context
                        relevantIndices.add(index);
                        if (index > 0) relevantIndices.add(index - 1);
                        if (index < paragraphs.length - 1) relevantIndices.add(index + 1);
                    }
                });

                const sortedIndices = Array.from(relevantIndices).sort((a, b) => a - b);
                
                if (sortedIndices.length > 0) {
                    const filteredData = sortedIndices.map(i => paragraphs[i]).join("\n\n");
                    console.log(`[AI] Found ${sortedIndices.length} relevant paragraphs (${filteredData.length} chars).`);
                    
                    // Reassemble: Persona + Relevant Data
                    basePrompt = personaSection + "\n\n[RELEVANT DATA EXTRACTED]:\n" + filteredData;
                } else {
                    console.log(`[AI] No relevant data found in prompt for terms. Keeping only Persona.`);
                    basePrompt = personaSection + "\n\n(No specific data found in prompt for this query. Use general knowledge).";
                }
            } else {
                 // No valid search terms (e.g. "Hi"), just keep Persona
                 console.log(`[AI] No search terms (General Chat). Keeping only Persona.`);
                 basePrompt = personaSection;
            }
            
            console.log(`[AI] Optimized Prompt Length: ${basePrompt.length} chars (Original: ${personaSection.length + dataSection.length})`);
        } else {
             console.log(`[AI] System Prompt is small (${basePrompt.length} chars). No filtering needed.`);
        }
    }
    
    // Inject "Gemini Persona" for Cheap/OpenRouter models
    // User Requirement: "make it work like Gemini 2.5 Flash"
    let personaInstruction = "";
    if (useCheapEngine) {
        // Optimized for Token Efficiency (Zero Cost Mode)
        personaInstruction = `Persona: Gemini 2.5 Flash. Fast, accurate, Bengali expert. Strict JSON. No fluff.`;
    }

    // Construct the System Message (n8n style) - OPTIMIZED FOR TOKENS
    const n8nSystemPrompt = `Role: Bot ${pageConfig.bot_name || 'Assistant'} for ${senderName}.
Ctx: ${basePrompt}
${personaInstruction}
Rules:
1. Reply in BENGALI.
2. Output RAW JSON:
{
  "reply": "Bengali text",
  "sentiment": "pos|neu|neg",
  "dm_message": "msg"|null,
  "bad_words": "words"|null,
  "order_details": { "product_name", "quantity", "address", "phone", "price" }|null
}`;

    const systemMessage = { role: 'system', content: n8nSystemPrompt };
    
    // DEBUG LOGGING FOR TOKEN USAGE
    console.log(`[AI DEBUG] FINAL PAYLOAD STATS:`);
    console.log(`- Base Prompt Length: ${basePrompt.length} chars`);
    console.log(`- Context Chunk Length: ${contextChunk ? contextChunk.length : 0} chars`);
    console.log(`- History Length: ${JSON.stringify(history).length} chars`);
    console.log(`- Total System Message Length: ${systemMessage.content.length} chars`);

    // Construct Messages Array
    const messages = [
        systemMessage,
        ...history,
        { role: 'user', content: cleanUserMessage }
    ];
    // -------------------------------------

    // --- UNIFIED AI REQUEST LOGIC ---

    // PHASE 1: Try User-Provided Keys (if available and NOT using cheap engine)
    if (!useCheapEngine && pageConfig.api_key && pageConfig.api_key !== 'MANAGED_SECRET_KEY') {
        const userKeys = pageConfig.api_key.split(',').map(k => k.trim()).filter(k => k);
        if (userKeys.length > 0) {
            // Shuffle user keys for load balancing
            for (let i = userKeys.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [userKeys[i], userKeys[j]] = [userKeys[j], userKeys[i]];
            }

            for (const currentKey of userKeys) {
                // Auto-Detect Provider
                let currentProvider = defaultProvider;
                if (currentKey.startsWith('sk-or-v1')) currentProvider = 'openrouter';
                else if (currentKey.startsWith('AIzaSy')) currentProvider = 'google';
                else if (currentKey.startsWith('gsk_')) {
                    currentProvider = 'groq';
                    // If user didn't specify a model (or left it as default gemini), force the BEST Groq model
                    if (defaultModel.includes('gemini') || defaultModel === 'default') {
                        defaultModel = 'llama-3.3-70b-versatile';
                    }
                }
                else if (currentKey.startsWith('xai-')) currentProvider = 'xai';

                // Configure Base URL
                let baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
                if (currentProvider.includes('openrouter')) baseURL = 'https://openrouter.ai/api/v1';
                else if (currentProvider.includes('gemini') || currentProvider.includes('google')) baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
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
                        // Attempt to record usage (safe to fail if key not in DB)
                        let tokenUsage = 0;
                        try {
                            tokenUsage = completion.usage ? completion.usage.total_tokens : 0;
                            keyService.recordKeyUsage(currentKey, tokenUsage);
                        } catch (err) { /* ignore */ }
                        
                        try {
                            const parsed = JSON.parse(rawContent);
                            // Normalize keys (Robustness for Missing 'reply')
                            if (!parsed.reply) {
                                parsed.reply = parsed.response || parsed.message || parsed.answer || parsed.text || parsed.content || parsed.bot_reply;
                            }
                            return { ...parsed, token_usage: tokenUsage, model: defaultModel };
                        } catch (e) {
                            return { reply: rawContent, sentiment: 'neutral', dm_message: null, bad_words: null, token_usage: tokenUsage, model: defaultModel };
                        }
                    }
                } catch (error) {
                    console.warn(`[AI] Phase 1 Error: ${error.message}`);
                    // Continue to next user key
                }
            }
            console.warn("[AI] All user-provided keys failed. Aborting (Cheap Engine Disabled).");
            return { reply: "Error: Your API Keys are invalid or exhausted. Please check settings.", sentiment: 'neutral' };
        }
    }

    // PHASE 2: Managed Mode (Dynamic Retry Loop from DB)
    // We enter here ONLY if cheap_engine is TRUE (or null default)
    
    if (!useCheapEngine) {
        // If cheap engine is OFF, we should have returned in Phase 1.
        // If we are here, it means no user keys were provided OR they all failed.
        console.warn("[AI] Cheap Engine is OFF and User Keys failed/missing. Stopping.");
        return { reply: "Configuration Error: Please provide valid API keys or enable Cheap Engine.", sentiment: 'neutral' };
    }

    let attempts = 0;
    const MAX_ATTEMPTS = 5;
    let lastError = null;

    // ROBUST FALLBACK CHAIN: If the primary model fails (404/400), we try these in order.
    // 1. Configured Fallback (from DB)
    // 2. Gemini Chain (2.5 Flash -> 2.5 Flash Lite -> 2.0 Flash)
    // 3. Dynamic Free Models (OpenRouter - Best available)
    
    let fallbackList = [];

    // A. Explicit Gemini Chain (User Preference)
    const GEMINI_CHAIN = [
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.0-flash'
    ];
    
    // Add Gemini chain, excluding the one we just tried (defaultModel)
    GEMINI_CHAIN.forEach(m => {
        if (m !== defaultModel && MODEL_ALIASES[m] !== defaultModel) {
            fallbackList.push(m);
        }
    });

    // B. Inject DB Fallback (if any)
    if (fallbackModel && !fallbackList.includes(fallbackModel)) {
        fallbackList.unshift(fallbackModel); // Prioritize DB config if set
    }

    // C. Dynamic OpenRouter Free Models (The "Safety Net")
    try {
        const freeModels = await commandApiService.getFreeOpenRouterModels();
        // Take top 3 best free models
        if (freeModels && freeModels.length > 0) {
            const topFree = freeModels.slice(0, 3);
            console.log(`[AI] Added Dynamic Free Models to Fallback: ${topFree.join(', ')}`);
            fallbackList.push(...topFree);
        }
    } catch (err) {
        console.warn("[AI] Failed to fetch dynamic free models:", err.message);
        // Fallback to hardcoded list if API fails
        fallbackList.push(
            'liquid/lfm-2.5-1.2b-thinking:free',
            'google/gemini-2.0-flash-lite-preview-02-05:free',
            'mistralai/mistral-7b-instruct:free'
        );
    }

    // Remove duplicates
    fallbackList = [...new Set(fallbackList)];

    let fallbackIndex = 0;

    while (attempts < MAX_ATTEMPTS) {
        attempts++;
        
        // Determine Provider for the current model
        // If it's a Gemini model (no slash), provider is 'gemini'
        // If it's OpenRouter (has slash), provider is 'openrouter'
        let targetModel = defaultModel;
        let targetProvider = defaultProvider;

        // If this is a RETRY (attempts > 1), pick from fallbackList
        if (attempts > 1) {
            if (fallbackIndex < fallbackList.length) {
                targetModel = fallbackList[fallbackIndex];
                fallbackIndex++;
                
                // Smart Provider Detection for Fallback
                if (targetModel.includes('/') || targetModel.endsWith(':free')) {
                    targetProvider = 'openrouter';
                } else if (targetModel.includes('gemini')) {
                    targetProvider = 'gemini';
                } else if (targetModel.includes('llama') || targetModel.includes('grok')) {
                    targetProvider = 'groq'; // Assumption for raw IDs, but usually OR IDs have slashes
                }
                
                console.log(`[AI] Switching to Fallback Strategy: ${targetProvider}/${targetModel}`);
            } else {
                 console.error(`[AI] Exhausted all fallback models. Stopping.`);
                 break;
            }
        }

        // Fetch ONE best candidate from DB
        const keyObj = await keyService.getSmartKey(targetProvider, targetModel);
        
        if (!keyObj) {
            console.error(`[AI] Phase 2: No healthy keys found for ${targetProvider}/${targetModel}. Skipping...`);
            continue; // Try next fallback
        }

        const currentKey = keyObj.key;
        let currentProvider = keyObj.provider || targetProvider;
        let currentModel = keyObj.model || targetModel;

        // Auto-Detect Provider
        if (currentKey.startsWith('sk-or-v1')) currentProvider = 'openrouter';
        else if (currentKey.startsWith('AIzaSy')) currentProvider = 'google';
        else if (currentKey.startsWith('gsk_')) currentProvider = 'groq';
        else if (currentKey.startsWith('xai-')) currentProvider = 'xai';

        let baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
        if (currentProvider.includes('openrouter')) baseURL = 'https://openrouter.ai/api/v1';
        else if (currentProvider.includes('gemini') || currentProvider.includes('google')) baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
        else if (currentProvider.includes('openai')) baseURL = 'https://api.openai.com/v1';
        else if (currentProvider.includes('groq')) baseURL = 'https://api.groq.com/openai/v1';
        else if (currentProvider.includes('xai') || currentProvider.includes('grok')) baseURL = 'https://api.x.ai/v1';
        else if (currentProvider.includes('deepseek')) baseURL = 'https://api.deepseek.com';

        try {
            const openai = new OpenAI({ apiKey: currentKey, baseURL: baseURL });
            console.log(`[AI] Phase 2 (Attempt ${attempts}): Calling ${currentProvider}/${currentModel}...`);
            
            // LOGIC: If using OpenRouter and model is 'arcee-ai/trinity-large-preview', append ':free' for the API call
            // But keep currentModel clean for logging and response.
            let apiModel = currentModel;
            if (currentProvider === 'openrouter' && currentModel === 'arcee-ai/trinity-large-preview') {
                apiModel = 'arcee-ai/trinity-large-preview:free';
            }

            const completion = await openai.chat.completions.create({
                model: apiModel,
                messages: messages,
                temperature: pageConfig.temperature ? Number(pageConfig.temperature) : 0.3, // 0.3 is best for accuracy/JSON
                top_p: pageConfig.top_p ? Number(pageConfig.top_p) : 0.9, // 0.9 is best for natural but focused
                // frequency_penalty: 0, // Default 0
                // presence_penalty: 0, // Default 0
                response_format: { type: "json_object" }
            });

            if (completion.choices && completion.choices.length > 0) {
                const rawContent = completion.choices[0].message.content;
                const usage = completion.usage || {};
                const tokenUsage = usage.total_tokens || usage.totalTokens || 0;
                keyService.recordKeyUsage(currentKey, tokenUsage);
                
                let finalResponse = null;

                try {
                    const parsed = JSON.parse(rawContent);
                    // Normalize keys (Robustness for Missing 'reply')
                    if (!parsed.reply) {
                        parsed.reply = parsed.response || parsed.message || parsed.answer || parsed.text || parsed.content || parsed.bot_reply;
                    }
                    finalResponse = { ...parsed, token_usage: tokenUsage, model: currentModel };
                } catch (e) {
                    // CLEANUP: If model returns "Thinking" tags (DeepSeek R1), strip them
                    let cleanContent = rawContent.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                    
                    try {
                        const parsed = JSON.parse(cleanContent);
                        // Normalize keys (Robustness for Missing 'reply')
                        if (!parsed.reply) {
                            parsed.reply = parsed.response || parsed.message || parsed.answer || parsed.text || parsed.content || parsed.bot_reply;
                        }
                        finalResponse = { ...parsed, token_usage: tokenUsage, model: currentModel };
                    } catch (e2) {
                        console.warn("AI returned invalid JSON, falling back to raw text:", cleanContent.substring(0, 100) + "...");
                        finalResponse = { reply: cleanContent, sentiment: 'neutral', dm_message: null, bad_words: null, token_usage: tokenUsage, model: currentModel };
                    }
                }

                // --- CACHE SUCCESSFUL RESPONSE ---
                // DISABLED TEMPORARILY
                // if (finalResponse && finalResponse.reply) {
                //     if (responseCache.size > CACHE_SIZE_LIMIT) {
                //          const firstKey = responseCache.keys().next().value;
                //          responseCache.delete(firstKey);
                //     }
                //     responseCache.set(cacheKey, { 
                //         reply: finalResponse, 
                //         timestamp: Date.now() 
                //     });
                //     console.log(`[AI CACHE] Saved reply for: "${userMessage.substring(0, 20)}..."`);
                // }
                // ---------------------------------

                return finalResponse;
            }
        } catch (error) {
            console.warn(`[AI] Phase 2 Error with ...${currentKey.slice(-4)}: ${error.message}`);
            lastError = error;
            
            // Analyze Error Type for Smart Blocking
            const status = error.status || (error.response ? error.response.status : null);
            const errorBody = error.response ? JSON.stringify(error.response.data || {}) : error.message;
            const isQuota = errorBody.includes('quota') || errorBody.includes('exhausted') || status === 403;
            const isRateLimit = status === 429 || errorBody.includes('Rate limit') || errorBody.includes('Too Many Requests');

            // CRITICAL FALLBACK: If Model Not Found (404/400) or unavailable, switch to next fallback
            if (status === 404 || errorBody.includes('model_not_found') || errorBody.includes('does not exist')) {
                console.warn(`[AI] Model ${currentModel} failed (404). Checking Command API for live updates...`);

                // 1. Try to fetch FRESH config from DB (User might have just updated it)
                try {
                    const freshConfig = await commandApiService.getCommandConfig(true); // Force Refresh
                    if (freshConfig) {
                        // Check if Primary Model changed
                        if (freshConfig.chatmodel && freshConfig.chatmodel !== currentModel && freshConfig.chatmodel !== defaultModel) {
                            console.log(`[AI] LIVE UPDATE: Found new model ${freshConfig.chatmodel}. Switching...`);
                            defaultModel = freshConfig.chatmodel;
                            continue; // Retry immediately
                        }
                    }
                } catch (err) {
                    console.warn("[AI] Failed to refresh config:", err.message);
                }

                // 2. Proceed with Fallback Chain
                
                // DYNAMIC MERGE: Add live free models from OpenRouter to the chain
                if (fallbackIndex === 0) { // Only fetch once at the start of fallback logic
                    const dynamicFreeModels = await commandApiService.getFreeOpenRouterModels();
                    if (dynamicFreeModels && dynamicFreeModels.length > 0) {
                         // Append unique models to the end of the list
                         const newModels = dynamicFreeModels.filter(m => !fallbackList.includes(m));
                         fallbackList = [...fallbackList, ...newModels];
                         console.log(`[AI] Extended Fallback Chain with ${newModels.length} dynamic free models.`);
                    }
                }

                if (fallbackIndex < fallbackList.length) {
                    const nextModel = fallbackList[fallbackIndex++];
                    console.warn(`[AI] Switching to fallback: ${nextModel}`);
                    defaultModel = nextModel; // Update for next iteration
                    // Don't mark key as dead, just the model is bad
                    continue;
                }
            }

            if (isQuota) {
                console.warn(`[AI] Key ...${currentKey.slice(-4)} QUOTA EXHAUSTED (RPD). Blocking until tomorrow.`);
                keyService.markKeyAsQuotaExceeded(currentKey);

                // --- BILLING/CREDIT FALLBACK (Command API Fallback) ---
                if (errorBody.includes('billing') || errorBody.includes('credit')) {
                    console.warn(`[AI] Detected BILLING/CREDIT issue with ${currentProvider}. Switching Provider...`);
                    
                    // If we have a configured fallback model in Command API, use it
                    if (fallbackModel && fallbackModel !== defaultModel) {
                        console.log(`[AI] Switching to Fallback Model: ${fallbackModel}`);
                        defaultModel = fallbackModel;
                        // Assuming fallback uses same provider or we re-detect?
                        // Usually fallback is 'openrouter' if primary is 'google'.
                        // We should probably re-detect provider based on model name or just try 'openrouter' if it looks like one.
                        // But wait, command_api has 'provider' column for PRIMARY.
                        // Fallback provider is not specified. We assume fallback is OpenRouter usually?
                        // Or we can infer?
                        if (fallbackModel.includes(':free') || fallbackModel.includes('/')) {
                            defaultProvider = 'openrouter';
                        } else if (fallbackModel.includes('gemini')) {
                            defaultProvider = 'google'; // or gemini
                        }
                        continue;
                    }

                    // Default hardcoded fallback if no specific fallback set
                    defaultProvider = 'openrouter';
                    defaultModel = 'arcee-ai/trinity-large-preview';
                    continue; 
                }
                // -------------------------------

                // --- USER STRATEGY: 2.5 Flash -> 2.5 Flash Lite (SAME KEY) ---
                if (defaultModel === 'gemini-2.5-flash' || currentModel === 'gemini-2.5-flash' || currentModel === 'gemini-2.0-flash') {
                     const fallbackModel = 'gemini-2.0-flash-lite-preview-02-05';
                     console.warn(`[AI] 2.5 Flash Quota Hit on key ...${currentKey.slice(-4)}. Trying ${fallbackModel} on SAME KEY...`);
                     
                     try {
                         const liteCompletion = await openai.chat.completions.create({
                             model: fallbackModel,
                             messages: messages,
                             response_format: { type: "json_object" }
                         });
                         
                         if (liteCompletion.choices && liteCompletion.choices.length > 0) {
                             console.log(`[AI] Fallback to Lite SUCCESS on same key!`);
                             const rawContent = liteCompletion.choices[0].message.content;
                             const usage = liteCompletion.usage || {};
                             const tokenUsage = usage.total_tokens || 0;
                             
                             // Record usage (It will count towards the key's stats, which is fine)
                             keyService.recordKeyUsage(currentKey, tokenUsage);
                             
                             try {
                                 const parsed = JSON.parse(rawContent);
                                 return { ...parsed, token_usage: tokenUsage, model: fallbackModel };
                             } catch (e) {
                                 return { reply: rawContent, sentiment: 'neutral', dm_message: null, bad_words: null, token_usage: tokenUsage, model: fallbackModel };
                             }
                         }
                     } catch (liteError) {
                         console.warn(`[AI] Fallback to Lite FAILED on same key: ${liteError.message}`);
                         // If Lite also fails, we proceed to next key in main loop
                     }
                }
                // -------------------------------------------------------------
                
                // --- GLOBAL STRATEGY: Fallback on Quota Hit ---
                // Only switch global defaultModel if we haven't already handled it or if we want to persist the switch
                if (defaultModel === 'gemini-2.5-flash') {
                     // We tried same key above. If we are here, it means we might need to switch globally for NEXT attempt?
                     // Actually, the loop continues. Next key will be picked.
                     // But if ALL keys fail 2.5 Flash, we might want to switch to Lite for future keys?
                     // User said: "next api pick korba". So we just let the loop continue.
                     // We DON'T switch defaultModel here to 'lite' permanently for this loop, 
                     // because we want to try Flash first on the next key too (unless user implies otherwise).
                     // However, if the user wants "Once Flash is over, use Lite", 
                     // usually that means "Flash is over for EVERYONE".
                     // But here we are rotating keys. Maybe next key has Flash quota.
                     // So we do NOT change defaultModel. We just let the loop pick next key.
                }
                // --------------------------------------------

            } else if (isRateLimit) {
                console.warn(`[AI] Key ...${currentKey.slice(-4)} RATE LIMITED (RPM/TPM). Blocking for 1 min.`);
                keyService.markKeyAsDead(currentKey, 60 * 1000, 'rate_limit');
            } else {
                // Generic error (network, server, etc) - Block for 1 min just in case
                keyService.markKeyAsDead(currentKey, 60 * 1000, 'generic_error');
            }
            
            if (error.response && error.response.headers) {
               keyService.updateKeyStatusFromHeaders(currentKey, error.response.headers);
            }
        }
    }
    
    // Final Failure
    console.error("All AI attempts failed (User + Managed).");
    return { 
       reply: null, // User requested NO reply on failure (Silent Fail)
       sentiment: "neutral",
       dm_message: null,
       bad_words: null,
       token_usage: 0
   };
 
}

// Helper: Optimize System Prompt
async function optimizeSystemPrompt(rawText) {
    if (!rawText || rawText.length < 10) return rawText;

    const META_PROMPT = `
You are an expert AI Prompt Engineer.
Your task is to REWRITE and STRUCTURE the following raw information into a highly optimized "System Prompt" for an AI Customer Service Agent.

RULES:
1. **PRESERVE ALL FACTS**: Do NOT delete any prices, phone numbers, addresses, policy details, or specific product info. Keep 100% of the factual content.
2. **REMOVE FLUFF**: Remove repetitive marketing sentences ("We are the best", "Choose us") IF they are redundant, but keep the core brand tone.
3. **STRUCTURE**: Organize the content into these clear Markdown sections:
   - # IDENTITY (Who the AI is, Name, Role)
   - # CORE BEHAVIOR (Tone, Language, Emoji usage)
   - # BUSINESS INFO (About, Mission, Location)
   - # KNOWLEDGE BASE (Products, Services, Pricing, Policies)
   - # FAQ & OBJECTIONS (Common questions and answers)
4. **LANGUAGE**: Keep the *content* in its original language (Bengali/English). Use English HEADERS for structure.
5. **OUTPUT**: Return ONLY the rewritten prompt text. Do not add conversational filler like "Here is your prompt".

RAW INPUT:
${rawText}
    `;

    // Use a fast, smart model (Gemini 2.5 Flash) as requested
    const model = 'gemini-2.5-flash'; 
    
    process.stdout.write(`\n[Optimization] Starting with model: ${model}\n`);

    // Force cache update
    try {
        await keyService.updateKeyCache(false); 
    } catch (e) {
        process.stdout.write(`[Optimization] Cache update error: ${e.message}\n`);
    }

    const keyObj = await keyService.getSmartKey('google', model); 
    const apiKey = keyObj?.key || process.env.GEMINI_API_KEY;

    if (!apiKey) {
        process.stdout.write(`[Optimization] NO API KEY FOUND\n`);
        throw new Error("No System API Key available for optimization");
    }

    // Direct Gemini API Call via Axios (Zero Dependency)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    
    process.stdout.write(`[Optimization] URL: ${url.replace(apiKey, 'HIDDEN')}\n`);
    process.stdout.write(`[Optimization] Key Prefix: ${apiKey.substring(0, 5)}...\n`);

    try {
        const response = await axios.post(url, {
            contents: [{
                parts: [{ text: META_PROMPT }]
            }]
        });

        if (response.data && response.data.candidates && response.data.candidates.length > 0) {
            const candidate = response.data.candidates[0];
            if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                return candidate.content.parts[0].text.trim();
            }
        }
    } catch (error) {
        process.stdout.write(`[Optimization] Error: ${error.message}\n`);
        if (error.response) {
            process.stdout.write(`[Optimization] Response Data: ${JSON.stringify(error.response.data)}\n`);
        }
        console.error("Prompt Optimization Failed:", JSON.stringify(error.response?.data || error.message, null, 2));
        throw error;
    }
    
    return rawText; // Fallback
}

// Helper: Process Image with Vision
async function processImageWithVision(imageUrl, pageConfig) {
  // STRATEGY (Updated as per User Request): 
  // 1. Try Vision API (Gemini/OpenRouter) FIRST.
  // 2. If Vision API fails, Fallback to OCR.space.

  const performOCRSpace = async (url) => {
      try {
          console.log(`[Vision] Fallback: Analyzing image with OCR.space...`);
          const apiKey = 'K88523729188957'; // Hardcoded from user's n8n workflow
          const formData = new URLSearchParams();
          formData.append('url', url);
          formData.append('language', 'eng');
          formData.append('isOverlayRequired', 'false');
          formData.append('apikey', apiKey);

          const response = await axios.post('https://api.ocr.space/parse/image', formData, {
              headers: {
                  'Content-Type': 'application/x-www-form-urlencoded'
              }
          });

          if (response.data && response.data.ParsedResults && response.data.ParsedResults.length > 0) {
              const text = response.data.ParsedResults[0].ParsedText;
              if (text && text.trim().length > 0) {
                  return `Based on the image this is: ${text.trim().replace(/\r\n/g, ', ')}`;
              }
          }
          return null;
      } catch (error) {
          console.error("OCR.space Error:", error.message);
          return null;
      }
  };

  // Determine Model: Use configured chat model or default to gemini-1.5-flash
  let modelToUse = pageConfig.chat_model || 'gemini-1.5-flash';
  // Don't normalize yet - wait until we know the provider (key)
  const providerToUse = pageConfig.ai || 'google';

  const performVisionCall = async (model) => {
    let apiKey = pageConfig.api_key;
    if (!apiKey || apiKey === 'MANAGED_SECRET_KEY') {
      // Fetch key specifically for the requested model
      const keyObj = await keyService.getSmartKey(providerToUse, model);
      apiKey = keyObj?.key;
    } else {
      apiKey = apiKey.split(',')[0].trim();
    }

    if (!apiKey) {
      apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    }

    if (!apiKey) throw new Error("No API Key available");

    // --- AUTO-DETECT PROVIDER BASED ON KEY PREFIX ---
    let effectiveProvider = providerToUse;
    if (apiKey.startsWith('sk-or-v1')) {
        effectiveProvider = 'openrouter';
    } else if (apiKey.startsWith('AIzaSy')) {
        effectiveProvider = 'google';
    } else if (apiKey.startsWith('gsk_')) {
        effectiveProvider = 'groq';
    } else if (apiKey.startsWith('xai-')) {
        effectiveProvider = 'xai';
    }
    // ------------------------------------------------

    // Configure Base URL based on Provider
    let baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
    if (effectiveProvider === 'openrouter') {
      baseURL = 'https://openrouter.ai/api/v1';
    } else if (effectiveProvider === 'groq') {
      baseURL = 'https://api.groq.com/openai/v1';
    } else if (effectiveProvider === 'openai') {
      baseURL = 'https://api.openai.com/v1';
    }

    const openai = new OpenAI({
      apiKey: apiKey,
      baseURL: baseURL
    });

    console.log(`[Vision] Analyzing image with ${effectiveProvider}/${model}...`);

    // --- DOWNLOAD IMAGE TO BASE64 (Fix for Localhost/WAHA) ---
    // Cloud AI (Gemini/OpenAI) cannot access local URLs (e.g. localhost:3000).
    // We must download the image on the backend and send it as Base64.
    let finalImageUrl = imageUrl;
    try {
        console.log(`[Vision] Downloading image for Base64 conversion...`);
        const imgResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const base64 = Buffer.from(imgResponse.data).toString('base64');
        const mimeType = imgResponse.headers['content-type'] || 'image/jpeg';
        finalImageUrl = `data:${mimeType};base64,${base64}`;
        console.log(`[Vision] Converted to Base64 (${base64.length} chars).`);
    } catch (e) {
        console.warn(`[Vision] Failed to download image (using original URL): ${e.message}`);
    }
    // ---------------------------------------------------------

    const response = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "You are a smart image analyzer. Detect product name, color, and read any visible text. Keep it very short (Name, Color, Text). You MUST start your response with exactly: 'Based on the image this is ' followed by the description." },
            { type: "image_url", image_url: { url: finalImageUrl } }
          ]
        }
      ],
      max_tokens: 300
    });

    return response.choices[0].message.content;
  };

  try {
    // 1. Try Vision API First
    const content = await performVisionCall(modelToUse);
    console.log(`[Vision] Result: ${content}`);
    return content || "Image";
  } catch (error) {
    console.error(`Vision API Error (${modelToUse}):`, error.message);
    if (error.response) {
      console.error("Vision API Error Details:", JSON.stringify(error.response.data || error.response));
    }

    // 2. Fallback to OCR.space
    console.log("[Vision] Vision API failed. Falling back to OCR.space...");
    const ocrResult = await performOCRSpace(imageUrl);
    if (ocrResult) {
        console.log(`[Vision] OCR Fallback Result: ${ocrResult}`);
        return ocrResult;
    }

    return "Image (Analysis Failed)";
  }
}

// Helper: Transcribe Audio
async function transcribeAudio(audioUrl, pageConfig) {
    try {
        console.log(`[Audio] Transcribing: ${audioUrl}`);

        // 1. Download Audio File (Stream)
        const response = await axios.get(audioUrl, { responseType: 'stream' });
        
        // 2. Prepare Form Data
        const form = new FormData();
        // Facebook audio is usually mp4/aac. We'll verify extension if possible, but 'audio.mp4' is safe for Whisper.
        form.append('file', response.data, { filename: 'audio.mp4', contentType: 'audio/mp4' }); 
        
        // 3. Select Provider & Key
        // USER INSTRUCTION: "Use the same model as image/chat"
        
        let apiKey = null;
        let baseURL = null;
        let model = 'whisper-large-v3'; 
        let provider = 'groq';

        // --- STRATEGY: Prioritize Page Config (User Selection) ---
        const userModel = pageConfig.chat_model ? pageConfig.chat_model.trim() : 'gemini-1.5-flash';
        const userKeys = pageConfig.api_key ? pageConfig.api_key.split(',') : [];

        // CASE A: User Selected a Gemini Model (Native Multimodal)
        if (userModel.startsWith('gemini')) {
             // Find a Google Key in User's List
             const googleKey = userKeys.find(k => k.trim().startsWith('AIzaSy'));
             if (googleKey) {
                 apiKey = googleKey.trim();
                 provider = 'gemini';
                 model = userModel; // Use exact user model (e.g. gemini-2.0-flash)
                 console.log(`[Audio] Using User Preference: ${provider} / ${model}`);
             }
        }
        
        // CASE B: User Selected Groq (Native Whisper)
        if (!apiKey) {
             const groqKey = userKeys.find(k => k.trim().startsWith('gsk_'));
             if (groqKey) {
                 apiKey = groqKey.trim();
                 provider = 'groq';
                 model = 'whisper-large-v3'; 
                 baseURL = 'https://api.groq.com/openai/v1/audio/transcriptions';
                 console.log(`[Audio] Using User Preference: ${provider} / ${model}`);
             }
        }

        // --- FALLBACKS (If User Config is invalid/missing or not applicable) ---

        // Fallback 1: Groq Smart Key (Fast/Free)
        if (!apiKey) {
            const keyObj = await keyService.getSmartKey('groq', 'whisper-large-v3');
            if (keyObj) {
                apiKey = keyObj.key;
                baseURL = 'https://api.groq.com/openai/v1/audio/transcriptions';
                provider = 'groq';
            }
        }

        // Fallback 2: Gemini Smart Key (Free Tier Fallback)
        if (!apiKey) {
             // Look for Gemini Key (AIzaSy...)
             let geminiKey = null;
             
             // 1. Try Page Config (Best chance to find a valid key if we missed it above)
             if (pageConfig.api_key) {
                 geminiKey = userKeys.find(k => k.trim().startsWith('AIzaSy'));
             }

             // 2. Smart Key Lookup (Try 1.5 Flash)
             if (!geminiKey) {
                 const keyObj = await keyService.getSmartKey('google', 'gemini-1.5-flash');
                 if (keyObj) geminiKey = keyObj.key;
             }
             
             // 3. Smart Key Lookup (Try 2.0 Flash)
             if (!geminiKey) {
                 const keyObj = await keyService.getSmartKey('google', 'gemini-2.0-flash');
                 if (keyObj) geminiKey = keyObj.key;
             }
             
             // Env Fallback
             if (!geminiKey) geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

             if (geminiKey) {
                 apiKey = geminiKey;
                 provider = 'gemini';
                 model = 'gemini-1.5-flash'; // Fallback model if user model wasn't set
             }
        }

        // D. Fallback to OpenRouter / OpenAI
        if (!apiKey) {
             // Check for OpenRouter (sk-or-v1) or OpenAI (sk-)
             let fallbackKey = null;
             
             if (pageConfig.api_key) {
                 const keys = pageConfig.api_key.split(',');
                 // Prefer OpenRouter first as it might have cheap whisper
                 fallbackKey = keys.find(k => k.trim().startsWith('sk-or-v1')) || keys.find(k => k.trim().startsWith('sk-'));
             }
             
             if (!fallbackKey) fallbackKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;

             if (fallbackKey) {
                 apiKey = fallbackKey;
                 if (apiKey.startsWith('sk-or-v1')) {
                     provider = 'openrouter';
                     baseURL = 'https://openrouter.ai/api/v1/audio/transcriptions';
                     model = 'openai/whisper'; // OpenRouter generic whisper
                 } else {
                     provider = 'openai';
                     baseURL = 'https://api.openai.com/v1/audio/transcriptions';
                     model = 'whisper-1';
                 }
             }
        }

        if (!apiKey) {
            console.warn("[Audio] No suitable API key (Groq/Gemini/OpenAI) found for transcription.");
            return "[Audio Message (Transcription Failed - No Key)]";
        }

        // --- EXECUTION ---
        
        // CASE 1: Gemini (Multimodal Audio)
        if (provider === 'gemini') {
            console.log(`[Audio] Using Gemini (Multimodal) with key ...${apiKey.slice(-4)}`);
            
            // 1. Need ArrayBuffer/Base64, not Stream. Re-download as buffer.
            const bufferResponse = await axios.get(audioUrl, { responseType: 'arraybuffer' });
            const base64Audio = Buffer.from(bufferResponse.data).toString('base64');
            
            // Determine MIME type
            let mimeType = bufferResponse.headers['content-type'] || 'audio/mp4';
            // Facebook often sends "video/mp4" for audio clips, but Gemini prefers specific audio mimes or generic "audio/mp4" for audio context
            if (mimeType === 'video/mp4') mimeType = 'audio/mp4';

            // Facebook Specific Fix: Force audio/aac for fbsbx.com URLs if they identify as mp4
            // Gemini often rejects "audio/mp4" from Facebook but accepts "audio/aac"
            if (audioUrl.includes('cdn.fbsbx.com') && (mimeType === 'audio/mp4' || mimeType === 'video/mp4')) {
                 console.log(`[Audio] Force-correcting MIME type to audio/aac for Facebook URL`);
                 mimeType = 'audio/aac'; 
            }

            // If header is missing or generic octet-stream, guess from URL
            if (!mimeType || mimeType === 'application/octet-stream') {
                if (audioUrl.includes('.mp3')) mimeType = 'audio/mp3';
                else if (audioUrl.includes('.wav')) mimeType = 'audio/wav';
                else mimeType = 'audio/mp4';
            }
            console.log(`[Audio] Detected MIME Type: ${mimeType}`);

            // Try multiple models if one fails (404/500)
            // USER INSTRUCTION: Prioritize the selected 'model' first.
            let modelsToTry = [model];
            
            // Add fallbacks only if they are different from the primary model
            const fallbacks = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-latest', 'gemini-2.0-flash-exp', 'gemini-1.5-pro'];
            for (const fb of fallbacks) {
                if (fb !== model) modelsToTry.push(fb);
            }
            
            for (const m of modelsToTry) {
                try {
                    console.log(`[Audio] Trying Gemini Model: ${m}...`);
                    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`;
                    
                    const payload = {
                        contents: [{
                            parts: [
                                { text: "Please transcribe this audio message exactly as spoken. Do not add any commentary." },
                                {
                                    inline_data: {
                                        mime_type: mimeType, 
                                        data: base64Audio
                                    }
                                }
                            ]
                        }]
                    };
                    
                    const geminiRes = await axios.post(geminiUrl, payload);
                    if (geminiRes.data && geminiRes.data.candidates && geminiRes.data.candidates.length > 0) {
                         const text = geminiRes.data.candidates[0].content.parts[0].text;
                         console.log(`[Audio] Gemini Transcription (${m}): "${text.trim()}"`);
                         return `[User sent voice message: "${text.trim()}"]`;
                    }
                } catch (geminiError) {
                    console.warn(`[Audio] Gemini Model ${m} Failed: ${geminiError.message}`);
                    if (geminiError.response) console.warn(`[Audio] Status: ${geminiError.response.status}`);
                    // Continue to next model
                }
            }
            
            console.warn("[Audio] All Gemini models failed. Falling back to Groq/Whisper...");
            // FALLBACK TO GROQ
            // 1. Get Groq Key
            const groqKeyObj = await keyService.getSmartKey('groq', 'whisper-large-v3');
            if (groqKeyObj) {
                apiKey = groqKeyObj.key;
                provider = 'groq';
                model = 'whisper-large-v3';
                baseURL = 'https://api.groq.com/openai/v1/audio/transcriptions';
                console.log(`[Audio] Switching provider to GROQ (Fallback)`);
            } else {
                 throw new Error("All Gemini models failed and no Groq fallback key available.");
            }
        }

        // CASE 2: Groq / OpenAI / OpenRouter (Standard Whisper API)
        form.append('model', model);
        const headers = {
            ...form.getHeaders(),
            'Authorization': `Bearer ${apiKey}`
        };

        // OpenRouter Header Requirement
        if (provider === 'openrouter') {
             headers['HTTP-Referer'] = 'https://orderly-conversations.com'; // Placeholder
             headers['X-Title'] = 'Orderly Conversations';
        }

        console.log(`[Audio] Sending to ${provider.toUpperCase()} (${model})...`);
        const transcriptionResponse = await axios.post(baseURL, form, { headers });
        
        const text = transcriptionResponse.data.text;
        console.log(`[Audio] Transcription: "${text}"`);
        return `[User sent voice message: "${text}"]`;

    } catch (error) {
        console.error("[Audio] Transcription Failed:", error.message);
        if (error.response) console.error(error.response.data);
        return "[Audio Message (Transcription Error)]";
    }
}

module.exports = {
    generateReply,
    processImageWithVision,
    transcribeAudio,
    optimizeSystemPrompt
};
