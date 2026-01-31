const dbService = require('./dbService');

// Cache for Command API Config
let configCache = null;
let lastCacheUpdate = 0;
const CACHE_TTL = 60 * 1000; // 1 Minute Cache (Frequent updates allowed)

async function getCommandConfig() {
    const now = Date.now();
    if (configCache && now - lastCacheUpdate < CACHE_TTL) {
        return configCache;
    }

    console.log("[CommandAPI] Fetching global AI configuration...");
    
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
    getCommandConfig
};
