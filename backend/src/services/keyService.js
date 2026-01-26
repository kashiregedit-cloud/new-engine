const dbService = require('./dbService');

// Fetch a rotating key from the global pool (api_list)
async function getManagedKey(provider = 'gemini') {
    const { data: keys, error } = await dbService.supabase
        .from('api_list')
        .select('*')
        .eq('provider', provider)
        .eq('is_active', true);

    if (error || !keys || keys.length === 0) {
        console.error("No active managed keys found for provider:", provider);
        return null;
    }

    // Simple Random Rotation
    const randomIndex = Math.floor(Math.random() * keys.length);
    const selectedKey = keys[randomIndex];

    // Optional: Update usage count (async, don't block)
    // dbService.supabase.from('api_list').update({ usage_count: selectedKey.usage_count + 1 }).eq('id', selectedKey.id);

    return selectedKey.api;
}

module.exports = {
    getManagedKey
};
