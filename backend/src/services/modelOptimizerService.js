const axios = require('axios');
const fs = require('fs');
const path = require('path');

// State to hold the current best model
let bestFreeModel = 'google/gemini-2.0-flash-lite-preview-02-05:free'; // Safe fallback
let modelStats = {};

// Keywords for scoring Bengali capability and General Intelligence
// User Preference: Find best free model (Llama/Qwen/Mistral) since Gemini might not be free.
const SCORE_RULES = [
    { pattern: /arcee-ai\/trinity-large/, score: 110 }, // Prioritize Large (User Request)
    { pattern: /arcee-ai\/trinity/, score: 105 }, // Fallback for other Trinity models
    { pattern: /meta-llama\/llama-3\.3/, score: 95 }, // Llama 3.3 is top-tier open source
    { pattern: /meta-llama\/llama-3\.1-405/, score: 90 }, // 405B is massive but slow?
    { pattern: /meta-llama\/llama-3/, score: 85 },    // Llama 3 family
    { pattern: /qwen\/qwen3/, score: 80 },            // Qwen 3 is very strong
    { pattern: /qwen\/qwen-2\.5/, score: 75 },        // Qwen 2.5
    { pattern: /mistralai/, score: 70 },              // Mistral
    { pattern: /google\/gemini/, score: 100 },        // Keep just in case, but unlikely
    { pattern: /deepseek/, score: -50 },              // DeepSeek raw tags issue
    { pattern: /nvidia/, score: -20 },                // Privacy concerns
    { pattern: /free/, score: 0 }
];

async function fetchAndOptimizeModels() {
    console.log('[ModelOptimizer] Fetching latest free models from OpenRouter...');
    try {
        const response = await axios.get('https://openrouter.ai/api/v1/models');
        const allModels = response.data.data;

        // Filter for TRUE Free models (Input=0, Output=0)
        const freeModels = allModels.filter(m => 
            m.pricing.prompt === '0' && 
            m.pricing.completion === '0'
        );

        console.log(`[ModelOptimizer] Found ${freeModels.length} completely free models.`);

        let bestCandidate = null;
        let highestScore = -Infinity;

        for (const model of freeModels) {
            let score = 0;

            // 1. Base Score by Family (Bengali Capability)
            for (const rule of SCORE_RULES) {
                if (rule.pattern.test(model.id)) {
                    score += rule.score;
                    break; // Apply highest priority rule only
                }
            }

            // 2. Context Length Bonus (More is better, but diminishing returns)
            // Cap bonus at 50 points (for 200k+ context)
            const contextScore = Math.min((model.context_length || 4096) / 4000, 50);
            score += contextScore;

            // 3. Penalize "Reasoning" models if user hates thinking traces
            // (Check if 'thinking' or 'reasoning' is in ID)
            if (model.id.includes('thinking') || model.id.includes('reasoning') || model.id.includes('r1')) {
                score -= 30; 
            }

            // console.log(`Model: ${model.id} | Score: ${score.toFixed(1)}`);

            if (score > highestScore) {
                highestScore = score;
                bestCandidate = model;
            }
        }

        if (bestCandidate) {
            bestFreeModel = bestCandidate.id;
            modelStats = {
                id: bestCandidate.id,
                context: bestCandidate.context_length,
                score: highestScore,
                updatedAt: new Date().toISOString()
            };
            console.log(`[ModelOptimizer] 🏆 NEW BEST ENGINE SELECTED: ${bestFreeModel} (Score: ${highestScore.toFixed(1)})`);
            
            // Optional: Save to a local JSON file for persistence across restarts
            saveConfig();
        }

    } catch (error) {
        console.error('[ModelOptimizer] Failed to fetch models:', error.message);
        // Keep using previous bestFreeModel
    }
}

function getBestFreeModel() {
    return bestFreeModel;
}

function saveConfig() {
    try {
        const configPath = path.join(__dirname, 'optimized_model_config.json');
        fs.writeFileSync(configPath, JSON.stringify({ bestFreeModel, modelStats }, null, 2));
    } catch (e) { /* ignore */ }
}

function loadConfig() {
    try {
        const configPath = path.join(__dirname, 'optimized_model_config.json');
        if (fs.existsSync(configPath)) {
            const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            if (data.bestFreeModel) {
                bestFreeModel = data.bestFreeModel;
                modelStats = data.modelStats || {};
                console.log(`[ModelOptimizer] Loaded persisted model: ${bestFreeModel}`);
            }
        }
    } catch (e) { /* ignore */ }
}

// Initial Load
loadConfig();

// Run immediately then every 6 hours
fetchAndOptimizeModels();
setInterval(fetchAndOptimizeModels, 6 * 60 * 60 * 1000);

module.exports = {
    getBestFreeModel,
    fetchAndOptimizeModels
};
