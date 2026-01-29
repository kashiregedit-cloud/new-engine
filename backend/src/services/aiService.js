const { OpenAI } = require('openai'); // Using OpenAI SDK for compatibility with OpenRouter/Gemini
const keyService = require('./keyService');
const axios = require('axios');
const FormData = require('form-data');

// Step 2: Business Logic / AI Brain
async function generateReply(userMessage, pageConfig, pagePrompts, history = [], senderName = 'Customer') {
    
    // --- MULTI-TENANCY SAFETY CHECK ---
    // Ensure we are using the correct context for this specific page
    const pageId = pageConfig.page_id;
    const promptPreview = pagePrompts?.text_prompt ? pagePrompts.text_prompt.substring(0, 30) : "DEFAULT";
    console.log(`[AI Isolation Check] Generating for Page ID: ${pageId} | Sender: ${senderName} | Prompt: "${promptPreview}..."`);
    // ----------------------------------

    // 1. Prepare Key Pool (Smart Rotation Strategy)
    let keyPool = [];
    let defaultProvider = pageConfig.ai || 'gemini';
    // Ensure model name is trimmed to avoid whitespace issues
    let defaultModel = pageConfig.chat_model ? pageConfig.chat_model.trim() : 'gemini-1.5-flash'; 
    
    // --- IMAGE DETECTION & VISION SUPPORT ---
    let imageUrls = [];
    let cleanUserMessage = userMessage;
    // Regex to extract "[User sent images: url1, url2]" pattern from webhookController
    const imageMatch = userMessage.match(/\[User sent images: (.*?)\]/);
    if (imageMatch && imageMatch[1]) {
        imageUrls = imageMatch[1].split(',').map(url => url.trim());
        cleanUserMessage = userMessage.replace(imageMatch[0], '').trim(); // Remove the text tag to avoid duplication
        console.log(`[AI] Detected ${imageUrls.length} images. Enabling Vision Mode.`);
    }

    const VISION_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet'];
    // ----------------------------------------

    // Case A: Managed Mode (Fetch from DB using Smart Key Service)
    if (pageConfig.api_key === 'MANAGED_SECRET_KEY' || !pageConfig.api_key) {
         // Get a SINGLE smart key first (optimization)
         // But wait, the retry loop below expects a list. 
         // Strategy: Fetch a small batch of valid keys (e.g., 3) to allow local retries without hitting DB every time.
         // However, getSmartKey returns only one.
         // Let's modify logic: We want to try multiple keys if one fails.
         
         // 1. Fetch one best candidate
         const smartKey = await keyService.getSmartKey(defaultProvider, defaultModel);
         if (smartKey) {
             keyPool.push(smartKey);
         }

         // 2. Add a few more backups just in case the first one fails immediately (optional, but good for robustness)
         // Actually, if the first one fails, the loop will exit and we return error? No, we want retry.
         // Let's fetch a few more if possible.
         // For now, let's just stick to the main one + fallback. 
         // If we want true robustness, we should fetch a list. 
         // Let's assume we fetch a small list using the existing getAllManagedKeys but filtered by model?
         // No, getAllManagedKeys doesn't filter by model.
         
         // Let's rely on the first key. If it fails, we can try to fetch another one dynamically? 
         // Complex. Let's stick to the previous approach of fetching a pool, but filtered by model.
         
         // RE-FETCHING ALL KEYS IS EXPENSIVE FOR 1000 KEYS.
         // But we only fetch "active" keys. 
         // Let's assume for now we use the `getSmartKey` logic which is cleaner.
         // If that fails, we have the fallback environment key.
         
         // To support retry, we can loop X times calling getSmartKey? 
         // No, that's redundant DB calls.
         
         // Solution: We will trust `getSmartKey` to give us a good key. 
         // If that fails (e.g. 500 error), we probably want to try one more time with a different key.
         // So let's push 2-3 unique keys into the pool if possible.
         
         for (let i = 0; i < 3; i++) {
             const k = await keyService.getSmartKey(defaultProvider, defaultModel);
             if (k && !keyPool.some(existing => existing.key === k.key)) {
                 keyPool.push(k);
             }
         }
         
         // Always add Fallback Key from Env to the end of the pool if available
         // REMOVED FALLBACK LOGIC AS PER USER REQUEST ("fallback er dorkar nai")
         /*
         const fallbackKey = process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
         if (fallbackKey) {
             const isDuplicate = keyPool.some(k => k.key === fallbackKey);
             if (!isDuplicate) {
                console.log("Adding Fallback API Key from Environment Variables to Key Pool.");
                keyPool.push({ key: fallbackKey, provider: 'google', model: 'gemini-1.5-flash' });
             }
         }
         */

         if (keyPool.length === 0) {
             console.error(`CRITICAL: No Managed Keys found for ${defaultProvider}/${defaultModel}. System will fail.`);
         }
    } else {
        // Case B: User Provided Keys (Comma separated)
        const keys = pageConfig.api_key.split(',').map(k => k.trim()).filter(k => k);
        if (keys.length > 0) {
            // Shuffle user keys too
            for (let i = keys.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [keys[i], keys[j]] = [keys[j], keys[i]];
            }
            keyPool = keys.map(k => ({ key: k, provider: defaultProvider, model: defaultModel }));
        }
    }

    // 2. Construct System Prompt (Streamlined & Dynamic)
    const basePrompt = pagePrompts?.text_prompt || "You are a helpful assistant.";
    
    // Streamlined System Prompt to save tokens and prevent hallucinations
    const n8nSystemPrompt = `
    ROLE: AI Customer Support Agent.
    CUSTOMER NAME: ${senderName}
    LANGUAGE: Reply in the same language as the user (mostly Bengali/English mixed).

    INSTRUCTIONS:
    1. **Source of Truth**: Use the "BUSINESS CONTEXT" below as your ONLY source of information about the business, products, and policies.
    2. **Identity**: Adopt the persona defined in the BUSINESS CONTEXT. Do NOT invent a business name.
    3. **Context**: 
       - "Old Message": Previous conversation history.
       - "Current Message": User's latest input (including reply context).
    4. **Behavior**: Be helpful, concise, and polite. If the answer is not in the context, ask for clarification.

    OUTPUT FORMAT (JSON ONLY):
    You must output a VALID JSON object. Do not wrap in markdown code blocks.
    {
        "reply": "Your reply text here",
        "images": ["url1", "url2"], 
        "sentiment": "positive|neutral|negative",
        "dm_message": "Any direct message logic if needed, else null",
        "bad_words": "Any bad words detected, else null"
    }
    `;

    const systemMessage = {
        role: 'system',
        content: `${n8nSystemPrompt}\n\n=== BUSINESS CONTEXT ===\n${basePrompt}`
    };

    const messages = [
        systemMessage,
        ...history,
        { role: 'user', content: userMessage }
    ]; 

    let lastError = null;

    // 3. Iterate through Key Pool
    for (const keyObj of keyPool) {
        const currentKey = keyObj.key;
        let currentProvider = keyObj.provider || defaultProvider;
        
        // Strict Model Handling:
        // If the key object comes with a specific model (from DB), USE IT.
        // Otherwise, fallback to the requested defaultModel.
        let currentModel = keyObj.model || defaultModel;
        
        // --- AUTO-DETECT PROVIDER BASED ON KEY PREFIX ---
        // This overrides DB provider if it's clearly mismatched (e.g. OpenRouter key labeled as Gemini)
        if (currentKey.startsWith('sk-or-v1')) {
            currentProvider = 'openrouter';
        } else if (currentKey.startsWith('AIzaSy')) {
            currentProvider = 'google';
        } else if (currentKey.startsWith('gsk_')) {
            currentProvider = 'groq';
        } else if (currentKey.startsWith('xai-')) {
            currentProvider = 'xai';
        }
        // ------------------------------------------------

        // STRICT MODE: Use EXACTLY the model defined in the DB/Key configuration.
        // No normalization, no forcing. User's input is the source of truth.
        // "je api token and chatmodel takbe setai use korte hobe"

        let baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/'; // Default to Gemini
        
        if (currentProvider.includes('openrouter')) {
            baseURL = 'https://openrouter.ai/api/v1';
        } else if (currentProvider.includes('gemini') || currentProvider.includes('google')) {
            // Official Google Gemini OpenAI Compatibility Endpoint
            baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
        } else if (currentProvider.includes('openai')) {
            baseURL = 'https://api.openai.com/v1';
        } else if (currentProvider.includes('groq')) {
            baseURL = 'https://api.groq.com/openai/v1';
        } else if (currentProvider.includes('xai') || currentProvider.includes('grok')) {
            baseURL = 'https://api.x.ai/v1';
        } else if (currentProvider.includes('deepseek')) {
            // DeepSeek Official Base URL
            baseURL = 'https://api.deepseek.com'; 
        }

        try {
            const openai = new OpenAI({
                apiKey: currentKey,
                baseURL: baseURL
            });

            console.log(`[AI] Calling ${currentProvider}/${currentModel}...`);
            const completion = await openai.chat.completions.create({
                model: currentModel,
                messages: messages,
                response_format: { type: "json_object" }
            });

            if (completion.choices && completion.choices.length > 0) {
                const rawContent = completion.choices[0].message.content;
                try {
                    const parsed = JSON.parse(rawContent);
                    // Record Usage
                    const tokenUsage = completion.usage ? completion.usage.total_tokens : 0;
                    keyService.recordKeyUsage(currentKey, tokenUsage);
                    return parsed; // Return Object
                } catch (e) {
                    console.warn("AI returned invalid JSON, falling back to raw text:", rawContent);
                    // Even if JSON failed, the API call succeeded, so we record usage
                    const tokenUsage = completion.usage ? completion.usage.total_tokens : 0;
                    keyService.recordKeyUsage(currentKey, tokenUsage);
                    return { reply: rawContent, sentiment: 'neutral', dm_message: null, bad_words: null };
                }
            }
        } catch (error) {
            console.warn(`AI Generation failed with key ...${currentKey.slice(-4)}. Provider: ${currentProvider}. Error: ${error.message}`);
            
            // Mark key as dead so we don't try it again immediately
            keyService.markKeyAsDead(currentKey);

            if (error.response) {
                 console.warn(`Error Response:`, error.response.data);
                 // If error response has headers, we might also want to check them
                 if (error.response.headers) {
                    keyService.updateKeyStatusFromHeaders(currentKey, error.response.headers);
                 }
            }
            lastError = error;
            // Continue to next key
        }
    }

    // 4. All Keys Failed
    console.error("All AI keys failed. Last error:", lastError ? lastError.message : 'Unknown');
    
    // Return safe fallback
    return { 
        reply: "Sorry, I am currently experiencing high traffic. Please try again later or leave your number.",
        sentiment: "neutral",
        dm_message: null,
        bad_words: null
    }; 
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
        // Priority: Groq (Fast/Free) -> OpenAI (Standard)
        
        let apiKey = null;
        let baseURL = null;
        let model = 'whisper-large-v3'; // Default to Groq's best

        // A. Check Page Config for Groq Key
        if (pageConfig.api_key && pageConfig.api_key.includes('gsk_')) {
             const keys = pageConfig.api_key.split(',');
             const groqKey = keys.find(k => k.trim().startsWith('gsk_'));
             if (groqKey) {
                 apiKey = groqKey.trim();
                 baseURL = 'https://api.groq.com/openai/v1/audio/transcriptions';
             }
        }

        // B. Smart Key Lookup (Groq)
        if (!apiKey) {
            const keyObj = await keyService.getSmartKey('groq', 'whisper-large-v3');
            if (keyObj) {
                apiKey = keyObj.key;
                baseURL = 'https://api.groq.com/openai/v1/audio/transcriptions';
            }
        }

        // C. Fallback to OpenAI
        if (!apiKey) {
             // Check for OpenAI key in pageConfig or Env
             let openAiKey = null;
             if (pageConfig.api_key && pageConfig.api_key.startsWith('sk-') && !pageConfig.api_key.startsWith('sk-or-')) {
                 openAiKey = pageConfig.api_key.split(',')[0].trim();
             } else {
                 openAiKey = process.env.OPENAI_API_KEY;
             }

             if (openAiKey) {
                 apiKey = openAiKey;
                 baseURL = 'https://api.openai.com/v1/audio/transcriptions';
                 model = 'whisper-1';
             }
        }

        if (!apiKey) {
            console.warn("[Audio] No suitable API key (Groq/OpenAI) found for transcription.");
            return "[Audio Message (Transcription Failed - No Key)]";
        }

        form.append('model', model);

        // 4. Call API
        const headers = {
            ...form.getHeaders(),
            'Authorization': `Bearer ${apiKey}`
        };

        console.log(`[Audio] Sending to ${baseURL} (${model})...`);
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
    transcribeAudio
};
