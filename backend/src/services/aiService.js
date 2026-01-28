const { OpenAI } = require('openai'); // Using OpenAI SDK for compatibility with OpenRouter/Gemini
const keyService = require('./keyService');

// Step 2: Business Logic / AI Brain
async function generateReply(userMessage, pageConfig, pagePrompts, history = [], senderName = 'Customer') {
    
    // 1. Prepare Key Pool (Smart Rotation Strategy)
    let keyPool = [];
    let defaultProvider = pageConfig.ai || 'gemini';
    let defaultModel = pageConfig.chat_model || 'gemini-1.5-flash'; 

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
         const fallbackKey = process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
         if (fallbackKey) {
             const isDuplicate = keyPool.some(k => k.key === fallbackKey);
             if (!isDuplicate) {
                console.log("Adding Fallback API Key from Environment Variables to Key Pool.");
                keyPool.push({ key: fallbackKey, provider: 'google', model: 'gemini-1.5-flash' });
             }
         }

         if (keyPool.length === 0) {
             console.error(`CRITICAL: No Managed Keys found for ${defaultProvider}/${defaultModel} and no Fallback Key in ENV.`);
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

    // 2. Construct System Prompt (The "Human" Persona) - EXACTLY MATCHING N8N
    const basePrompt = pagePrompts?.text_prompt || "You are a helpful assistant.";
    
    // N8N System Prompt Translation/Copy
    const n8nSystemPrompt = `
    তুমি একজন স্মার্ট AI, যিনি বিভিন্ন ফেসবুক পেইজে sales, service, delivery, payment ইত্যাদি বিষয় নিয়ে গ্রাহকদের সাহায্য করো। 
    তোমার নাম জানা থাকলে গ্রাহককে নাম ধরে সম্বোধন করতে পারো। গ্রাহকের নাম: ${senderName}।

    নিয়মাবলী: 
    1. "Old Message": এইটি হলো গ্রাহক আগে যা পাঠিয়েছে বা আগের SMS/Message।  
    2. "New Reply_To Message": গ্রাহক এই নতুন বার্তার মাধ্যমে আগের বার্তার সাথে সম্পর্কিত কিছু জানতে বা কথা বলতে চায়।  

    তোমার কাজ:  
    - আগের বার্তা এবং নতুন বার্তার context ভালোভাবে বোঝা।  
    - শুধুমাত্র প্রয়োজনীয় এবং সঠিক তথ্য দিয়ে গ্রাহককে উত্তর দেওয়া।  
    - Old Message যদি না থাকে (null/empty), তবে শুধুমাত্র New Reply_To Message অনুযায়ী উত্তর তৈরি করো।  
    - উত্তর অবশ্যই পরিষ্কার, সংক্ষিপ্ত, এবং ব্যবহারযোগ্য হোক।  
        - কোনো অপ্রাসঙ্গিক তথ্য, website URL, বা emoji অন্তর্ভুক্ত করবে না।  
    
        OUTPUT FORMAT (JSON ONLY):
        You must output a VALID JSON object. Do not wrap in markdown code blocks.
        {
            "reply": "Your reply text here",
            "images": ["url1", "url2"], 
            "sentiment": "positive|neutral|negative",
            "dm_message": "Any direct message logic if needed, else null",
            "bad_words": "Any bad words detected, else null"
        }
        "images" field description: If the reply involves sending an image (e.g. product photo), include the direct URL strings in this array. If no image, use empty array [].
        `;

    const systemMessage = {
        role: 'system',
        content: `${basePrompt}\n\n${n8nSystemPrompt}`
    };

    const messages = [
        systemMessage,
        ...history,
        { role: 'user', content: userMessage }
    ];

    // 3. Try Loop (Retry Logic)
    let lastError = null;

    for (const keyObj of keyPool) {
        const currentKey = keyObj.key;
        const currentProvider = (keyObj.provider || defaultProvider).toLowerCase();
        
        // Smart Default Model based on Provider (if not specified in DB)
        let currentModel = keyObj.model;
        if (!currentModel) {
            if (currentProvider.includes('gemini') || currentProvider.includes('google')) currentModel = 'gemini-1.5-flash';
            else if (currentProvider.includes('openai')) currentModel = 'gpt-4o-mini';
            else if (currentProvider.includes('groq')) currentModel = 'llama3-70b-8192';
            else if (currentProvider.includes('xai') || currentProvider.includes('grok')) currentModel = 'grok-beta';
            else if (currentProvider.includes('deepseek')) currentModel = 'deepseek-chat';
            else currentModel = defaultModel;
        }

        // Setup Base URL (Verified Official Documentation)
        let baseURL = 'https://openrouter.ai/api/v1'; 
        
        if (currentProvider.includes('gemini') || currentProvider.includes('google')) {
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

        const client = new OpenAI({
            baseURL: baseURL,
            apiKey: currentKey,
            timeout: 60000 // 60 Seconds Timeout (Increased from 6s to allow complex reasoning)
        });

        try {
            console.log(`[Attempt ${keyPool.indexOf(keyObj) + 1}] Sending to ${currentProvider.toUpperCase()} (${currentModel})...`);
            
            // Use withResponse() to get access to headers
            const { data: completion, response } = await client.chat.completions.create({
                model: currentModel,
                messages: messages,
                temperature: 0.7, 
                max_tokens: 800,
                response_format: { type: "json_object" } 
            }).withResponse();

            // Extract Rate Limit Headers and Update Key Status
            if (response && response.headers) {
                keyService.updateKeyStatusFromHeaders(currentKey, response.headers);
            }

            if (completion.choices && completion.choices[0] && completion.choices[0].message) {
                const rawContent = completion.choices[0].message.content;
                // Parse JSON to ensure it's valid, otherwise return raw text as fallback
                try {
                    const parsed = JSON.parse(rawContent.replace(/```json|```/g, "").trim());
                    // Success! Record usage for Rate Limiting
                    // Extract token usage if available
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

module.exports = {
    generateReply
};
