
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function checkSchema() {
    console.log("Checking whatsapp_contacts schema...");
    const { data, error } = await supabase
        .from('whatsapp_contacts')
        .select('*')
        .limit(1);

    if (error) {
        console.error("Error accessing whatsapp_contacts:", error);
    } else {
        console.log("whatsapp_contacts access OK. Sample:", data);
    }
}

checkSchema();
