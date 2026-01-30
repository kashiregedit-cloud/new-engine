const { OpenAI } = require('openai'); // Using OpenAI SDK for compatibility with OpenRouter/Gemini
const keyService = require('./keyService');
const axios = require('axios');
const FormData = require('form-data');

// Step 2: Business Logic / AI Brain
async function generateReply(userMessage, pageConfig, pagePrompts, history = [], senderName = 'Customer') {
    
    // --- MULTI-TENANCY SAFETY CHECK ---
    const pageId = pageConfig.page_id;
    const promptPreview = pagePrompts?.text_prompt ? pagePrompts.text_prompt.substring(0, 30) : "DEFAULT";
    console.log(`[AI Isolation Check] Generating for Page ID: ${pageId} | Sender: ${senderName} | Prompt: "${promptPreview}..."`);
    // ----------------------------------

    // 1. Prepare Configuration
    let defaultProvider = pageConfig.ai || 'gemini';
    // Ensure model name is trimmed to avoid whitespace issues
    let defaultModel = pageConfig.chat_model ? pageConfig.chat_model.trim() : 'gemini-1.5-flash'; 

    // --- MODEL NAME NORMALIZATION & ALIASES ---
    const MODEL_ALIASES = {
        'gemini-2.0-flash-exp': 'gemini-2.0-flash', // Auto-upgrade old "exp" users to latest 2.0
        'gemini-2.5-pro': 'gemini-2.5-pro-preview', // Assuming preview for now
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

    // --- PROMPT & MESSAGE CONSTRUCTION ---
    // Moved UP before Key Logic to ensure 'messages' is available for all cases
    
    // Define base system prompt
    let basePrompt = pagePrompts?.text_prompt || "You are a helpful assistant.";
    
    // Construct the System Message (n8n style)
    const n8nSystemPrompt = `
You are a helpful AI assistant for a business page.
Your name is ${pageConfig.bot_name || 'Assistant'}.
You are talking to ${senderName}.

CONTEXT:
${basePrompt}

INSTRUCTIONS:
1. You MUST reply in BENGALI (Bangla) unless the user explicitly asks in English.
2. If the user asks for price/order, encourage them politely.
3. You MUST output your response in valid JSON format with these fields:
   - "reply": The text reply to the user (in Bengali).
   - "sentiment": "positive", "neutral", or "negative".
   - "dm_message": (Optional) A private message if needed, otherwise null.
   - "bad_words": (Optional) Any detected bad words, otherwise null.
   - "order_details": (Optional) If the user provides order info (Name, Address, Phone), return an object: { "product_name": "...", "quantity": 1, "address": "...", "phone": "...", "price": "..." }, otherwise null.

IMPORTANT: Do not output markdown code blocks (like \`\`\`json). Just output the raw JSON string.
`;

    const systemMessage = { role: 'system', content: n8nSystemPrompt };
    
    // Construct Messages Array
    const messages = [
        systemMessage,
        ...history,
        { role: 'user', content: cleanUserMessage }
    ];
    // -------------------------------------

    // --- UNIFIED AI REQUEST LOGIC ---

    // PHASE 1: Try User-Provided Keys (if available)
    if (pageConfig.api_key && pageConfig.api_key !== 'MANAGED_SECRET_KEY') {
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
                else if (currentKey.startsWith('gsk_')) currentProvider = 'groq';
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
                        try {
                            const tokenUsage = completion.usage ? completion.usage.total_tokens : 0;
                            keyService.recordKeyUsage(currentKey, tokenUsage);
                        } catch (err) { /* ignore */ }
                        
                        try {
                            return JSON.parse(rawContent);
                        } catch (e) {
                            return { reply: rawContent, sentiment: 'neutral', dm_message: null, bad_words: null };
                        }
                    }
                } catch (error) {
                    console.warn(`[AI] Phase 1 Error: ${error.message}`);
                    // Continue to next user key
                }
            }
            console.warn("[AI] All user-provided keys failed. Falling back to Managed Pool...");
        }
    }

    // PHASE 2: Managed Mode (Dynamic Retry Loop from DB)
    // We enter here if:
    // a) User didn't provide keys (Managed Mode)
    // b) User keys failed (Fallback)
    
    let attempts = 0;
    const MAX_ATTEMPTS = 5;
    let lastError = null;

    while (attempts < MAX_ATTEMPTS) {
        attempts++;
        
        // Fetch ONE best candidate from DB
        // NOTE: keyService is now relaxed to return ANY provider key if model-specific key is missing.
        const keyObj = await keyService.getSmartKey(defaultProvider, defaultModel);
        
        if (!keyObj) {
            console.error(`[AI] Phase 2: No healthy keys found for ${defaultProvider}/${defaultModel}. Stopping.`);
            break; 
        }

        const currentKey = keyObj.key;
        let currentProvider = keyObj.provider || defaultProvider;
        let currentModel = keyObj.model || defaultModel;

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
            
            const completion = await openai.chat.completions.create({
                model: currentModel,
                messages: messages,
                response_format: { type: "json_object" }
            });

            if (completion.choices && completion.choices.length > 0) {
                const rawContent = completion.choices[0].message.content;
                const tokenUsage = completion.usage ? completion.usage.total_tokens : 0;
                keyService.recordKeyUsage(currentKey, tokenUsage);
                
                try {
                    return JSON.parse(rawContent);
                } catch (e) {
                    console.warn("AI returned invalid JSON, falling back to raw text:", rawContent);
                    return { reply: rawContent, sentiment: 'neutral', dm_message: null, bad_words: null };
                }
            }
        } catch (error) {
            console.warn(`[AI] Phase 2 Error with ...${currentKey.slice(-4)}: ${error.message}`);
            lastError = error;
            
            // Mark key as dead
            keyService.markKeyAsDead(currentKey);
            
            if (error.response && error.response.headers) {
               keyService.updateKeyStatusFromHeaders(currentKey, error.response.headers);
            }
        }
    }
    
    // Final Failure
    console.error("All AI attempts failed (User + Managed).");
    return { 
       reply: "Sorry, I am currently experiencing high traffic. Please try again later.",
       sentiment: "neutral",
       dm_message: null,
       bad_words: null
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

    // Use a fast, smart model (Gemini 1.5 Flash or 2.0 Flash Lite)
    const model = 'gemini-1.5-flash'; 
    const keyObj = await keyService.getSmartKey('google', model); // Use system pool for this admin task
    const apiKey = keyObj?.key || process.env.GEMINI_API_KEY;

    if (!apiKey) {
        throw new Error("No System API Key available for optimization");
    }

    const openai = new OpenAI({
        apiKey: apiKey,
        baseURL: "https://generativelanguage.googleapis.com/v1beta/openai"
    });

    try {
        const completion = await openai.chat.completions.create({
            model: model,
            messages: [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: META_PROMPT }
            ],
            temperature: 0.3, // Low temp for precision
        });

        if (completion.choices && completion.choices.length > 0) {
            return completion.choices[0].message.content.trim();
        }
    } catch (error) {
        console.error("Prompt Optimization Failed:", error);
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

    const response = await openai.chat.completions.create({
      model: model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "You are a smart image analyzer. Detect product name, color, and read any visible text. Keep it very short (Name, Color, Text). You MUST start your response with exactly: 'Based on the image this is ' followed by the description." },
            { type: "image_url", image_url: { url: imageUrl } }
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
                                        mime_type: "audio/mp3", // Generic mime, Gemini is usually smart enough
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
            throw new Error("All Gemini models failed to transcribe.");
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
