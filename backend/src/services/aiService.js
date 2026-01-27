const { OpenAI } = require('openai'); // Using OpenAI SDK for compatibility with OpenRouter/Gemini
const keyService = require('./keyService');

// Step 2: Business Logic / AI Brain
async function generateReply(userMessage, pageConfig, pagePrompts, history = []) {
    
    // 1. Prepare Key Pool (Multi-Key Rotation & Retry Strategy)
    let keyPool = [];
    let defaultProvider = pageConfig.ai || 'gemini';
    let defaultModel = pageConfig.chat_model || 'gemini-1.5-flash'; 

    // Case A: Managed Mode (Fetch from DB)
    if (pageConfig.api_key === 'MANAGED_SECRET_KEY' || !pageConfig.api_key) {
         const managedKeys = await keyService.getAllManagedKeys(defaultProvider); 
         if (managedKeys && managedKeys.length > 0) {
             keyPool = managedKeys;
         }
         
         // Always add Fallback Key from Env to the end of the pool if available
         const fallbackKey = process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
         if (fallbackKey) {
             // Avoid duplicates if possible, but for now just push it as a safety net
             const isDuplicate = keyPool.some(k => k.key === fallbackKey);
             if (!isDuplicate) {
                console.log("Adding Fallback API Key from Environment Variables to Key Pool.");
                keyPool.push({ key: fallbackKey, provider: 'google', model: 'gemini-1.5-flash' });
             }
         }

         if (keyPool.length === 0) {
             console.error("CRITICAL: No Managed Keys in DB and no Fallback Key in ENV.");
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
            timeout: 6000 // 6 Seconds Timeout for Fast Failover
        });

        try {
            console.log(`[Attempt ${keyPool.indexOf(keyObj) + 1}] Sending to ${currentProvider.toUpperCase()} (${currentModel})...`);
            
            const completion = await client.chat.completions.create({
                model: currentModel,
                messages: messages,
                temperature: 0.7, 
                max_tokens: 800,
                response_format: { type: "json_object" } 
            });

            if (completion.choices && completion.choices[0] && completion.choices[0].message) {
                const rawContent = completion.choices[0].message.content;
                // Parse JSON to ensure it's valid, otherwise return raw text as fallback
                try {
                    const parsed = JSON.parse(rawContent.replace(/```json|```/g, "").trim());
                    return parsed; // Return Object
                } catch (e) {
                    console.warn("AI returned invalid JSON, falling back to raw text:", rawContent);
                    return { reply: rawContent, sentiment: 'neutral', dm_message: null, bad_words: null };
                }
            }
        } catch (error) {
            console.warn(`AI Generation failed with key ...${currentKey.slice(-4)}. Provider: ${currentProvider}. Error: ${error.message}`);
            if (error.response) {
                 console.warn(`Error Response:`, error.response.data);
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
