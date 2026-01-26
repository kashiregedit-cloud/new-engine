const dbService = require('./dbService');

// Fetch a rotating key from the global pool (api_list)
async function getManagedKey(provider = 'gemini') {
    // Check if provider is 'google' or 'gemini'
    const isGoogle = provider === 'google' || provider === 'gemini';
    
    const { data: keys, error } = await dbService.supabase
        .from('api_list')
        .select('*')
        .or(`provider.eq.${provider},provider.eq.${isGoogle ? 'google' : provider},provider.eq.${isGoogle ? 'gemini' : provider}`);

    if (error || !keys || keys.length === 0) {
        console.error("No active managed keys found for provider:", provider);
        return null;
    }

    // Simple Random Rotation
    const randomIndex = Math.floor(Math.random() * keys.length);
    const selectedKey = keys[randomIndex];

    // Optional: Update usage count (async, don't block)
    // dbService.supabase.from('api_list').update({ usage_count: selectedKey.usage_count + 1 }).eq('id', selectedKey.id);

    return {
        key: selectedKey.api,
        provider: selectedKey.provider,
        model: selectedKey.model
    };
}

// Fetch ALL keys for retry logic
async function getAllManagedKeys(provider = 'gemini') {
    // Check if provider is 'google' or 'gemini'
    const isGoogle = provider === 'google' || provider === 'gemini';
    
    const { data: keys, error } = await dbService.supabase
        .from('api_list')
        .select('*')
        .or(`provider.eq.${provider},provider.eq.${isGoogle ? 'google' : provider},provider.eq.${isGoogle ? 'gemini' : provider}`);

    if (error || !keys || keys.length === 0) {
        return [];
    }

    // Shuffle the array (Fisher-Yates) to randomize load
    for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
    }

    return keys.map(k => ({
        key: k.api,
        provider: k.provider,
        model: k.model
    }));
}

module.exports = {
    getManagedKey,
    getAllManagedKeys
};
