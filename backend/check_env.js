
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function checkEnv() {
    console.log("--- Environment Check ---");
    
    // 1. Check Gemini Key
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (geminiKey) {
        console.log("✅ GEMINI_API_KEY found in Environment.");
    } else {
        console.error("❌ GEMINI_API_KEY is MISSING in Environment.");
    }

    // 2. Check Supabase
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;
    
    if (supabaseUrl && supabaseKey) {
        console.log("✅ Supabase Credentials found.");
        const supabase = createClient(supabaseUrl, supabaseKey);
        const { data, error } = await supabase.from('api_list').select('count', { count: 'exact', head: true });
        
        if (error) {
            console.error("❌ Supabase Connection Failed:", error.message);
        } else {
            console.log("✅ Supabase Connected. API List Count:", data); // data is null for head:true but status is what matters
        }
    } else {
        console.error("❌ Supabase Credentials MISSING.");
    }
    
    console.log("-------------------------");
}

checkEnv();
