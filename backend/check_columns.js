
require('dotenv').config({ path: './.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function checkColumns() {
    console.log("Checking columns of fb_message_database...");
    const { data: one, error } = await supabase
        .from('fb_message_database')
        .select('*')
        .limit(1);

    if (error) {
         console.log("fb_message_database not found or empty. Checking page_access_token_message...");
    }
    
    const { data: two, error: error2 } = await supabase
        .from('page_access_token_message')
        .select('*')
        .limit(1);
        
    if (error2) console.error("Error checking page_access_token_message:", error2);
    else console.log("Keys (page_access_token_message):", Object.keys(two[0] || {}));

}

checkColumns();
