import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'path';

dotenv.config({ path: './backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function fetchPrompts() {
    console.log("Fetching sample prompts...");
    const { data, error } = await supabase
        .from('fb_message_database')
        .select('text_prompt, page_id')
        .limit(3);

    if (error) {
        console.error("Error:", error);
    } else {
        console.log("Found", data.length, "prompts.");
        data.forEach((p, i) => {
            console.log(`\n--- Prompt ${i+1} (Page ${p.page_id}) ---`);
            if (p.text_prompt) {
                console.log(p.text_prompt.substring(0, 500) + "...");
            } else {
                console.log("NULL PROMPT");
            }
        });
    }
}

fetchPrompts();