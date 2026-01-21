const OpenAI = require('openai');

/**
 * AI Engine to handle multi-provider LLM calls
 * @param {Object} config - { provider, apiKey, model, systemPrompt }
 * @param {Array} history - Array of { role, content } messages
 * @param {Object} userMessage - { text, images: [], audio: [] }
 * @returns {Promise<Object>} - { output: string, admin_handover: boolean }
 */
async function generateAIResponse(config, history, userMessage) {
  try {
    // 1. Determine Base URL
    let baseURL;
    switch (config.provider) {
      case 'openai':
        baseURL = undefined;
        break;
      case 'google': // Gemini
        baseURL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
        break;
      case 'xai': // Grok
        baseURL = 'https://api.x.ai/v1';
        break;
      case 'groq':
        baseURL = 'https://api.groq.com/openai/v1';
        break;
      case 'openrouter':
      default:
        baseURL = 'https://openrouter.ai/api/v1';
        break;
    }

    const openai = new OpenAI({
      baseURL: baseURL,
      apiKey: config.apiKey,
    });

    // 2. Construct Messages Payload
    const messagesPayload = [
      { role: 'system', content: config.systemPrompt },
      ...history // Previous context if any
    ];

    // 3. Construct Current User Message with Multimodal Support
    const userContent = [];
    
    // Add text context
    if (userMessage.text && userMessage.text.trim()) {
      userContent.push({ type: "text", text: userMessage.text.trim() });
    }

    // Add Images
    if (userMessage.images && Array.isArray(userMessage.images)) {
      userMessage.images.forEach(url => {
        if (url) {
          userContent.push({
            type: "image_url",
            image_url: { url: url }
          });
        }
      });
    }

    // Fallback if empty (should be handled by caller, but safety check)
    if (userContent.length === 0) {
      userContent.push({ type: "text", text: "User sent a message but content could not be processed." });
    }

    messagesPayload.push({ role: 'user', content: userContent });

    // 4. Call AI
    const completion = await openai.chat.completions.create({
      model: config.model,
      messages: messagesPayload,
    });

    const aiResponseRaw = completion.choices[0].message.content;
    
    // 5. Parse JSON
    try {
      return JSON.parse(aiResponseRaw);
    } catch (e) {
      console.warn("AI did not return valid JSON, attempting to wrap:", aiResponseRaw);
      return { output: aiResponseRaw, admin_handover: false };
    }

  } catch (error) {
    console.error('AI Engine Error:', error);
    throw error;
  }
}

module.exports = { generateAIResponse };
