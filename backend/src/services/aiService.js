const { OpenAI } = require('openai'); // Using OpenAI SDK for compatibility with OpenRouter/Gemini
const keyService = require('./keyService');

// Step 2: Business Logic / AI Brain
async function generateReply(userMessage, pageConfig, pagePrompts, history = []) {
    
    // 1. Multi-Key Rotation (Zero Cost / Scalability Strategy)
    let selectedApiKey = process.env.OPENROUTER_API_KEY; // Default Fallback

    // Check if Managed Mode (using global pool)
    if (pageConfig.api_key === 'MANAGED_SECRET_KEY' || !pageConfig.api_key) {
         const managedKey = await keyService.getManagedKey('gemini'); // Default to gemini for zero cost
         if (managedKey) selectedApiKey = managedKey;
    } else {
        // User provided their own keys (Comma separated)
        const keys = pageConfig.api_key.split(',').map(k => k.trim()).filter(k => k);
        if (keys.length > 0) {
            const randomIndex = Math.floor(Math.random() * keys.length);
            selectedApiKey = keys[randomIndex];
        }
    }

    // 2. Setup Provider (Gemini 2.5 Flash Lite via OpenRouter or Direct)
    // Assuming we use OpenRouter for unified interface, or direct Google if provider is 'google'
    // For this specific request ("Zero Cost"), we assume the user might use Google AI Studio keys directly with OpenAI SDK (compatible base URL)
    
    // Default to OpenRouter for ease, but allow override
    const baseURL = 'https://openrouter.ai/api/v1'; // Default
    // If using Google directly: 'https://generativelanguage.googleapis.com/v1beta/openai/'
    
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
            model: pageConfig.chat_model || 'google/gemini-2.5-flash-lite-preview-02-05', // Updated model
            messages: messages,
            temperature: 0.7, // Slightly creative but focused
            max_tokens: 150 // Keep it short like a chat
        });

        return completion.choices[0].message.content;
    } catch (error) {
        console.error("AI Generation Error:", error);
        return "Sorry, I am a bit busy right now. Please leave your number."; // Fallback
    }
}

module.exports = {
    generateReply
};
