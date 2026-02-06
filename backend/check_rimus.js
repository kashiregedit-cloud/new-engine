
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Use Service Role for backend checks

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing Supabase credentials in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRimus() {
    console.log("Checking fb_message_database for 'rimus' in text_prompt...");
    const { data: fbConfigs, error: fbError } = await supabase
        .from('fb_message_database')
        .select('*')
        .ilike('text_prompt', '%rimus%');

    if (fbError) {
        console.error("FB Config Error:", fbError);
    } else {
        console.log(`Found ${fbConfigs.length} configs with 'rimus' in text_prompt.`);
        fbConfigs.forEach(c => console.log(`- ID: ${c.id}, PageID: ${c.page_id}, Prompt: ${c.text_prompt.substring(0, 50)}...`));
    }

    console.log("\nChecking fb_chats for 'rimus' in text...");
    const { data: chats, error: chatError } = await supabase
        .from('fb_chats')
        .select('*')
        .ilike('text', '%rimus%')
        .order('timestamp', { ascending: false })
        .limit(5);

    if (chatError) {
        console.error("Chat Error:", chatError);
    } else {
        console.log(`Found ${chats.length} recent chats with 'rimus'.`);
        chats.forEach(c => console.log(`[${new Date(Number(c.timestamp)).toISOString()}] ${c.sender_id} -> ${c.recipient_id}: ${c.text.substring(0, 100)}`));
    }
}

checkRimus();
