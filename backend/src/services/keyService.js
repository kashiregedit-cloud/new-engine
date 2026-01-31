const dbService = require('./dbService');

// In-Memory Key Cache (Refresh every 5 minutes or manually)
let keyCache = [];
let lastCacheUpdate = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 Minutes

// In-Memory "Dead Key" Tracker
// Stores invalid keys with an expiry timestamp
// Value format: { expiry: number, reason: string }
const deadKeys = new Map();
const DEFAULT_COOLDOWN = 60 * 1000; // 1 Minute default for RPM/TPM

// In-Memory Usage Tracker for RPM (Rate Per Minute)
const keyUsageMap = new Map(); 

// In-Memory Pointer for Serial/Round-Robin Selection
// Key: "provider:model", Value: Next Index (Integer)
const modelIndexMap = new Map();

// In-Memory Pending Updates (Buffered for Bulk Write)
const pendingUpdates = new Set();
// Flush Interval (Every 5 Seconds for better visibility)
setInterval(flushUsageStats, 5 * 1000);

// --- Background Cache Refresh (Every 5 Minutes) ---
// Proactively fetches new keys/limits from DB to keep memory fresh
setInterval(() => {
    console.log("[KeyService] Background cache refresh triggered.");
    updateKeyCache(true); // force = true
}, 5 * 60 * 1000);
// --------------------------------------------------

// --- Default Limits Map (Fallback if DB values are null) ---
// Based on typical Free Tier limits as of early 2025
const DEFAULT_LIMITS = {
    'gemini-3-pro': { rpm: 2, rpd: 50 },
    'gemini-3-flash': { rpm: 10, rpd: 1500 },
    'gemini-2.5-flash': { rpm: 5, rpd: 20 }, // Strict limit (User reported)
    'gemini-2.5-flash-lite': { rpm: 5, rpd: 40 }, // User estimate: 25 keys for 1k msgs = 40 RPD
    'gemini-2.5-pro': { rpm: 2, rpd: 50 },
    'gemini-2.0-flash': { rpm: 10, rpd: 1500 },
    'gemini-1.5-flash': { rpm: 15, rpd: 1500 },
    'gemini-1.5-flash-8b': { rpm: 15, rpd: 1500 },
    'gemini-1.5-pro': { rpm: 2, rpd: 50 },
    'gemini-1.0-pro': { rpm: 15, rpd: 1500 },
    'gpt-4o-mini': { rpm: 3, rpd: 200 },
    'default': { rpm: 10, rpd: 1000 }
};

// --- Helper: Update Cache ---
async function updateKeyCache(force = false) {
    const now = Date.now();
    if (!force && now - lastCacheUpdate < CACHE_TTL && keyCache.length > 0) {
        return; // Cache is fresh
    }

    console.log("[KeyService] Refreshing API Key Cache from DB...");
    // Fetch all active keys, sorted by ID for consistent serial order
    const { data: keys, error } = await dbService.supabase
        .from('api_list')
        .select('*')
        // .eq('status', 'active') // Column 'status' does not exist yet
        .order('id', { ascending: true }); 

    if (error) {
        console.error("[KeyService] Failed to refresh key cache:", error.message);
        return;
    }

    if (keys) {
        keyCache = keys;
        lastCacheUpdate = now;
        console.log(`[KeyService] Cache updated. Total Keys: ${keys.length}`);
        
        // Optional: Clean up deadKeys map if a key is no longer in the DB
        for (const [key] of deadKeys) {
            if (!keys.find(k => k.api === key)) {
                deadKeys.delete(key);
            }
        }
    }
}

function markKeyAsDead(key, duration = DEFAULT_COOLDOWN, reason = 'unknown') {
    if (!key) return;
    const expiry = Date.now() + duration;
    console.warn(`[KeyService] Blocking key ${key.substring(0, 8)}... for ${(duration/1000).toFixed(1)}s. Reason: ${reason}`);
    deadKeys.set(key, { expiry, reason });
}

function markKeyAsQuotaExceeded(key) {
    if (!key) return;
    // Calculate time until next midnight (UTC)
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCHours(24, 0, 0, 0); // Next UTC Midnight
    const duration = tomorrow.getTime() - now.getTime();
    
    // Add 1 hour buffer to be safe
    const safeDuration = duration + (60 * 60 * 1000);
    
    markKeyAsDead(key, safeDuration, 'quota_exceeded');
}

function isKeyAlive(key) {
    if (!deadKeys.has(key)) return true;
    const entry = deadKeys.get(key);
    
    // Check if expired
    if (Date.now() > entry.expiry) {
        deadKeys.delete(key); // Cooldown over
        return true;
    }
    return false;
}

// Check if Key is within Limits (RPM, RPD)
function isKeyWithinLimits(keyDbObject) {
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];
    
    // 1. Check RPD (Requests Per Day)
    const dbDate = keyDbObject.last_date_checked;
    // If DB date is not today, usage is 0.
    const usageToday = (dbDate === today) ? (keyDbObject.usage_today || 0) : 0;
    
    // Determine Limits (DB > Default Map > Safe Fallback)
    let rpdLimit = keyDbObject.rpd_limit;
    let rpmLimit = keyDbObject.rpm_limit;

    if (!rpdLimit || !rpmLimit) {
        const modelDefaults = DEFAULT_LIMITS[keyDbObject.model] || DEFAULT_LIMITS['default'];
        if (!rpdLimit) rpdLimit = modelDefaults.rpd;
        if (!rpmLimit) rpmLimit = modelDefaults.rpm;
    }

    if (usageToday >= rpdLimit) {
        // console.log(`Key ${keyDbObject.api.substring(0,6)}... hit RPD limit (${usageToday}/${rpdLimit})`);
        return false;
    }

    // 2. Check RPM (Requests Per Minute) via Sliding Window / Interval
    const minIntervalMs = 60000 / rpmLimit; // e.g., 6000ms for 10 RPM
    
    const lastUsed = keyUsageMap.get(keyDbObject.api) || 0;
    if (now - lastUsed < minIntervalMs) {
        // console.log(`Key ${keyDbObject.api.substring(0,6)}... hit RPM limit (Wait ${minIntervalMs - (now - lastUsed)}ms)`);
        return false;
    }

    // 3. Check TPM (Tokens Per Minute)
    const tpmLimit = keyDbObject.tpm_limit || 0; // 0 means unchecked/unlimited by default for now
    if (tpmLimit > 0) {
        // Simple approximate check: If usageToday * avg_tokens > tpm? 
        // No, TPM requires a sliding window of actual token counts.
        // For now, we will skip complex TPM sliding window in memory to save RAM.
        // We will implement RPD (Requests) and TPD (Tokens Per Day) first.
    }

    // 4. Check TPD (Tokens Per Day)
    const tpdLimit = keyDbObject.tpd_limit || 0;
    const tokensToday = (dbDate === today) ? (keyDbObject.usage_tokens_today || 0) : 0;
    
    if (tpdLimit > 0 && tokensToday >= tpdLimit) {
        // console.log(`Key ${keyDbObject.api.substring(0,6)}... hit TPD limit (${tokensToday}/${tpdLimit})`);
        return false;
    }

    return true;
}

// Record Usage (Call this AFTER successful AI response)
async function recordKeyUsage(apiKey, tokenUsage = 0) {
    if (!apiKey) return;

    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];

    // 1. Update In-Memory RPM Map
    keyUsageMap.set(apiKey, now);

    // 2. Update In-Memory Cache Object (Immediate Reflection for RPD/TPD)
    const cachedKey = keyCache.find(k => k.api === apiKey);
    let newUsage = 1;
    let newTokens = tokenUsage;

    if (cachedKey) {
        if (cachedKey.last_date_checked === today) {
            cachedKey.usage_today = (cachedKey.usage_today || 0) + 1;
            cachedKey.usage_tokens_today = (cachedKey.usage_tokens_today || 0) + tokenUsage;
            newUsage = cachedKey.usage_today;
            newTokens = cachedKey.usage_tokens_today;
        } else {
            cachedKey.last_date_checked = today;
            cachedKey.usage_today = 1;
            cachedKey.usage_tokens_today = tokenUsage;
            newUsage = 1;
            newTokens = tokenUsage;
        }
        cachedKey.last_used_at = new Date().toISOString();
        
        // Mark for batch update
        pendingUpdates.add(apiKey);
    }

    // 3. Update Database (Buffered/Batched)
    // Removed immediate DB call to prevent Supabase overload
}

// Flush Usage Stats to Database (Called periodically)
async function flushUsageStats() {
    if (pendingUpdates.size === 0) return;

    // console.log(`[KeyService] Flushing usage stats for ${pendingUpdates.size} keys...`);
    const keysToUpdate = Array.from(pendingUpdates);
    pendingUpdates.clear();

    // OPTIMIZATION: Bulk Upsert to prevent Server Overload with 2400+ keys
    const updates = keysToUpdate.map(apiKey => {
        const cachedKey = keyCache.find(k => k.api === apiKey);
        if (!cachedKey) return null;
        
        // We need to include 'api' for the upsert conflict target
        // And other required fields if they are missing (but we are updating, so it's fine)
        // Note: For upsert to work on 'api', it must be a unique constraint.
        // The schema usually has 'id' as PK, but we can try to use 'api' as match.
        // If 'api' is not unique constraint, we must fetch ID. 
        // Assuming 'api' is unique enough or we use loop fallback if upsert fails.
        
        return {
            api: apiKey,
            usage_today: cachedKey.usage_today,
            usage_tokens_today: cachedKey.usage_tokens_today,
            last_date_checked: cachedKey.last_date_checked,
            last_used_at: cachedKey.last_used_at,
            // Preserve other required fields if it's an insert (it won't be, but good practice)
            provider: cachedKey.provider, 
            model: cachedKey.model
        };
    }).filter(k => k !== null);

    if (updates.length === 0) return;

    try {
        // Try Bulk Upsert first (Much faster)
        const { error } = await dbService.supabase
            .from('api_list')
            .upsert(updates, { onConflict: 'api', ignoreDuplicates: false });

        if (error) {
            // console.warn("[KeyService] Bulk upsert failed (likely no unique constraint on 'api'). Falling back to loop...", error.message);
            // Fallback to loop if upsert fails
            for (const update of updates) {
                await dbService.supabase
                    .from('api_list')
                    .update({ 
                        usage_today: update.usage_today,
                        usage_tokens_today: update.usage_tokens_today,
                        last_date_checked: update.last_date_checked,
                        last_used_at: update.last_used_at
                    })
                    .eq('api', update.api);
            }
        }
    } catch (err) {
        console.error(`[KeyService] Failed to flush stats`, err.message);
    }
}

// Update Key Status based on Response Headers
function updateKeyStatusFromHeaders(apiKey, headers) {
    if (!apiKey || !headers) return;

    const remaining = headers['x-ratelimit-remaining-requests'] || headers['x-ratelimit-remaining'] || headers['ratelimit-remaining'];
    const resetTime = headers['x-ratelimit-reset-requests'] || headers['x-ratelimit-reset'] || headers['ratelimit-reset'];

    if (remaining !== undefined && parseInt(remaining) === 0) {
        console.warn(`[KeyService] Key ${apiKey.substring(0,8)}... exhausted (Headers).`);
        
        let timeoutMs = 60 * 1000; // Default 1 min
        if (resetTime) {
            const val = parseInt(resetTime);
            if (val > 1000000000) { // Timestamp
                timeoutMs = val - Date.now();
            } else { // Seconds
                timeoutMs = val * 1000;
            }
        }
        
        if (timeoutMs > 0) {
            markKeyAsDead(apiKey); 
        }
    }
}

// Smart Key Rotation (Serial Round Robin + Health Check)
async function getSmartKey(provider, model) {
    // 1. Ensure Cache is Fresh
    await updateKeyCache();

    // 2. Filter Keys from Memory Cache
    let validKeys = keyCache;

    // Filter by Provider
    if (provider) {
        if (provider === 'google' || provider === 'gemini') {
            validKeys = validKeys.filter(k => k.provider === 'google' || k.provider === 'gemini');
        } else {
            validKeys = validKeys.filter(k => k.provider === provider);
        }
    }

    // Filter by Model (Strict Match)
    let modelSpecificKeys = [];
    if (model) {
        modelSpecificKeys = validKeys.filter(k => k.model === model);
    }

    // RETRY LOGIC: If no keys found in cache, FORCE REFRESH from DB and try again
    if (model && modelSpecificKeys.length === 0) {
        // Prevent excessive DB hammering: Only force refresh if cache is older than 10 seconds
        if (Date.now() - lastCacheUpdate > 10000) {
            console.log(`[KeyService] No local keys found for ${provider}/${model}. Forcing DB refresh...`);
            await updateKeyCache(true);
            
            // Re-filter after refresh
            validKeys = keyCache;
            if (provider) {
                if (provider === 'google' || provider === 'gemini') {
                    validKeys = validKeys.filter(k => k.provider === 'google' || k.provider === 'gemini');
                } else {
                    validKeys = validKeys.filter(k => k.provider === provider);
                }
            }
            if (model) {
                modelSpecificKeys = validKeys.filter(k => k.model === model);
            }
        } else {
             // console.log(`[KeyService] No strict keys for ${model} and cache is fresh. Skipping refresh.`);
        }
    }

    // Use model-specific keys if available. 
    // STRICT MODE: If model is specified, we PREFER keys for that model.
    // BUT if no model-specific keys exist, we FALLBACK to ANY key for that provider.
    // This allows using a generic "google" key for any "gemini-*" model.
    if (model) {
        if (modelSpecificKeys.length > 0) {
            validKeys = modelSpecificKeys;
        } else {
            // RELAXED MODE: If we didn't find keys specifically labeled for this model,
            // we check if we have ANY keys for this provider.
            // Google keys are generally universal.
            if (validKeys.length > 0) {
                console.log(`[KeyService] No specific keys for ${model}. Using generic ${provider} keys.`);
                // validKeys is already filtered by provider, so we keep it.
            } else {
                console.warn(`[KeyService] No keys found for ${provider} (Specific or Generic). Returning null.`);
                return null;
            }
        }
    }
    // If model is NOT specified, we use any key for the provider (validKeys is already filtered by provider)

    // 3. Serial Round Robin Selection
    const mapKey = `${provider || 'all'}:${model || 'all'}`;
    let startIndex = modelIndexMap.get(mapKey) || 0;
    
    // Ensure start index is within bounds
    if (startIndex >= validKeys.length) {
        startIndex = 0;
    }

    // Iterate through keys starting from startIndex to find the first valid one
    for (let i = 0; i < validKeys.length; i++) {
        const currentIndex = (startIndex + i) % validKeys.length;
        const candidateKey = validKeys[currentIndex];

        if (isKeyAlive(candidateKey.api) && isKeyWithinLimits(candidateKey)) {
            // Found a good key!
            
            // Update pointer to next one for next call
            modelIndexMap.set(mapKey, (currentIndex + 1) % validKeys.length);

            return {
                key: candidateKey.api,
                provider: candidateKey.provider,
                model: candidateKey.model
            };
        }
    }

    // FAILSAFE REFRESH: If we are here, it means we have keys in memory, but ALL are either dead or rate-limited.
    // It is possible the DB has new keys that we haven't loaded yet (stale cache).
    // Let's force a refresh ONCE and try again.
    
    // Check if we already forced a refresh? We can't easily pass state here without argument.
    // But updateKeyCache has a check. If we pass force=true, it hits DB.
    // We should only do this if we haven't just done it. 
    // Ideally, we check `Date.now() - lastCacheUpdate`. If it's very recent (< 5s), we assume we already have latest.
    
    if (Date.now() - lastCacheUpdate > 5000) {
        console.log(`[KeyService] All cached keys are dead/limited. Forcing DB refresh to check for new keys...`);
        await updateKeyCache(true);
        
        // Re-fetch and Re-filter
        validKeys = keyCache;
        if (provider) {
             if (provider === 'google' || provider === 'gemini') {
                validKeys = validKeys.filter(k => k.provider === 'google' || k.provider === 'gemini');
            } else {
                validKeys = validKeys.filter(k => k.provider === provider);
            }
        }
        if (model) {
            validKeys = validKeys.filter(k => k.model === model);
        }
        
        // Try Loop Again
        for (let i = 0; i < validKeys.length; i++) {
            // Simple iteration for the second pass
            const candidateKey = validKeys[i];
            if (isKeyAlive(candidateKey.api) && isKeyWithinLimits(candidateKey)) {
                modelIndexMap.set(mapKey, (i + 1) % validKeys.length);
                return {
                    key: candidateKey.api,
                    provider: candidateKey.provider,
                    model: candidateKey.model
                };
            }
        }
    }

    // If still no valid key...
    console.warn(`[KeyService] All ${validKeys.length} keys for ${provider}/${model} are dead/limited.`);
    return null;
}

module.exports = {
    getManagedKey: () => null, 
    getAllManagedKeys: () => [], 
    getSmartKey, 
    markKeyAsDead,
    markKeyAsQuotaExceeded,
    recordKeyUsage,
    updateKeyStatusFromHeaders,
    updateKeyCache // Export this!
};
