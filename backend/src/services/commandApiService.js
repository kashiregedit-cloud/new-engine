const dbService = require('./dbService');
const axios = require('axios'); // For fetching OpenRouter models

// Cache for Command API Config
let configCache = null;
let lastCacheUpdate = 0;
const CACHE_TTL = 60 * 1000; // 1 Minute Cache (Frequent updates allowed)

// Cache for Dynamic Free Models
let freeModelCache = [];
let lastFreeModelUpdate = 0;

async function getFreeOpenRouterModels() {
    const now = Date.now();
    // Cache for 1 Hour to avoid spamming OpenRouter API
    if (freeModelCache.length > 0 && now - lastFreeModelUpdate < 60 * 60 * 1000) {
        return freeModelCache;
    }

    try {
        console.log("[CommandAPI] Fetching dynamic free models list from OpenRouter API...");
        const response = await axios.get('https://openrouter.ai/api/v1/models');
        const allModels = response.data.data;
        
        // Filter for truly free models (0 cost for prompt and completion)
        const freeModels = allModels.filter(m => 
            m.pricing &&
            (m.pricing.prompt === '0' || m.pricing.prompt === 0) && 
            (m.pricing.completion === '0' || m.pricing.completion === 0)
        ).map(m => m.id);

        if (freeModels.length > 0) {
            // Sort by context_length if available to prioritize larger context models
            // Or just keep them as is. Let's prioritize 'liquid' and 'google' if present.
            freeModels.sort((a, b) => {
                const prioritize = ['liquid', 'google', 'mistral', 'meta'];
                const aP = prioritize.findIndex(p => a.includes(p));
                const bP = prioritize.findIndex(p => b.includes(p));
                return (bP === -1 ? -99 : bP) - (aP === -1 ? -99 : aP); // Higher priority first
            });

            freeModelCache = freeModels;
            lastFreeModelUpdate = now;
            console.log(`[CommandAPI] Found ${freeModels.length} free models on OpenRouter:`, freeModels.slice(0, 3));
        }
        return freeModelCache;
    } catch (error) {
        console.warn("[CommandAPI] Failed to fetch OpenRouter models:", error.message);
        return freeModelCache; // Return stale cache if available
    }
}

async function getCommandConfig(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && configCache && now - lastCacheUpdate < CACHE_TTL) {
        return configCache;
    }

    console.log(`[CommandAPI] Fetching global AI configuration... (Force: ${forceRefresh})`);
    
    // Fetch the FIRST row (assuming single global config for now)
    // User can add multiple, but we need one active strategy.
    // We order by ID desc to get the LATEST config added.
    const { data, error } = await dbService.supabase
        .from('command_api')
        .select('*')
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error("[CommandAPI] Error fetching config:", error.message);
        return null;
    }

    if (data) {
        configCache = data;
        lastCacheUpdate = now;
        console.log(`[CommandAPI] Active Config: ${data.provider} / ${data.chatmodel} (Fallback: ${data.fallback_chatmodel})`);
    } else {
        console.warn("[CommandAPI] No configuration found in 'command_api' table.");
    }

    return configCache;
}

module.exports = {
    getCommandConfig,
    getFreeOpenRouterModels
};
