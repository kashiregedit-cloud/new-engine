const aiService = require('../services/aiService');

async function optimizePrompt(req, res) {
    try {
        const { promptText } = req.body;
        
        if (!promptText) {
            return res.status(400).json({ error: "Prompt text is required" });
        }

        const optimizedText = await aiService.optimizeSystemPrompt(promptText);
        
        return res.json({ 
            success: true, 
            optimizedPrompt: optimizedText 
        });

    } catch (error) {
        console.error("Optimization Controller Error:", error);
        return res.status(500).json({ 
            error: "Failed to optimize prompt",
            details: error.message 
        });
    }
}

module.exports = {
    optimizePrompt
};
