const { OpenAI } = require('openai'); // Using OpenAI SDK for compatibility with OpenRouter/Gemini
const keyService = require('./keyService');

// Step 2: Business Logic / AI Brain
async function generateReply(userMessage, pageConfig, pagePrompts, history = []) {
    
    // 1. Multi-Key Rotation (Zero Cost / Scalability Strategy)
    let selectedApiKey = process.env.OPENROUTER_API_KEY; // Default Fallback
    let activeProvider = pageConfig.ai || 'openrouter';
    let activeModel = pageConfig.chat_model || 'google/gemini-2.0-flash-lite-preview-02-05';

    // Check if Managed Mode (using global pool)
    if (pageConfig.api_key === 'MANAGED_SECRET_KEY' || !pageConfig.api_key) {
         const managedData = await keyService.getManagedKey(activeProvider === 'openrouter' ? 'openrouter' : 'gemini'); 
         if (managedData) {
             selectedApiKey = managedData.key;
             activeProvider = managedData.provider; // Update provider based on key source
             if (managedData.model) activeModel = managedData.model;
         }
    } else {
        // User provided their own keys (Comma separated)
        const keys = pageConfig.api_key.split(',').map(k => k.trim()).filter(k => k);
        if (keys.length > 0) {
            const randomIndex = Math.floor(Math.random() * keys.length);
            selectedApiKey = keys[randomIndex];
        }
    }

    // 2. Setup Provider (Gemini 2.5 Flash Lite via OpenRouter or Direct)
    let baseURL = 'https://openrouter.ai/api/v1'; // Default
    
    // Switch Base URL based on Provider
    if (activeProvider === 'gemini' || activeProvider === 'google') {
        baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
    } else if (activeProvider === 'openai') {
        baseURL = 'https://api.openai.com/v1';
    }

    const client = new OpenAI({
        baseURL: baseURL,
        apiKey: selectedApiKey
    });

    // 3. Construct System Prompt (The "Human" Persona)
    // Combine base system prompt with Page-Specific Knowledge Base
    const basePrompt = pagePrompts?.text_prompt || "You are a helpful assistant.";
    
    // Add "Human" instructions
    const humanInstructions = `
    IMPORTANT:
    - Act like a human staff member, not an AI.
    - Keep replies concise and natural.
    - If the user asks for price, use the knowledge base.
    - If the user asks for location, use the knowledge base.
    - Reply in the same language as the user (Bengali/English).
    - Do NOT use markdown (no **bold**, no headers).
    - Do NOT start with "Bot:" or "AI:".
    `;

    const systemMessage = {
        role: 'system',
        content: `${basePrompt}\n\n${humanInstructions}`
    };

    // 4. Construct Messages
    const messages = [
        systemMessage,
        ...history,
        { role: 'user', content: userMessage }
    ];

    try {
        const completion = await client.chat.completions.create({
            model: activeModel,
            messages: messages,
            temperature: 0.7, // Slightly creative but focused
            max_tokens: 150 // Keep it short like a chat
        });

        return completion.choices[0].message.content;
    } catch (error) {
        console.error("AI Generation Error Details:", {
            message: error.message,
            response: error.response ? error.response.data : 'No response data',
            provider: activeProvider,
            model: activeModel,
            key: selectedApiKey ? selectedApiKey.substring(0, 10) + '...' : 'Missing Key'
        });
        
        // Return a better fallback or the actual error if in dev
        return "Sorry, I am currently experiencing high traffic. Please try again later or leave your number."; 
    }
}

module.exports = {
    generateReply
};
