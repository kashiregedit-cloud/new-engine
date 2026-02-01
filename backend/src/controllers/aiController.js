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

async function ingestKnowledge(req, res) {
    try {
        const { pageId, promptText } = req.body;
        
        if (!pageId || !promptText) {
            return res.status(400).json({ error: "Page ID and Text required" });
        }

        // Run ingestion in background (don't block response)
        // RAG REMOVED BY USER REQUEST
        
        return res.json({ success: true, message: "Ingestion skipped (RAG Disabled)" });

    } catch (error) {
        console.error("Ingestion Controller Error:", error);
        return res.status(500).json({ error: "Failed to start ingestion" });
    }
}

module.exports = {
    optimizePrompt,
    ingestKnowledge
};
