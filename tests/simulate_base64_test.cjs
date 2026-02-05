const path = require('path');
const fs = require('fs');

// Try to load dotenv from backend node_modules if not found in root
try {
    require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });
} catch (e) {
    try {
        require(path.join(__dirname, '../backend/node_modules/dotenv')).config({ path: path.join(__dirname, '../backend/.env') });
    } catch (e2) {
        console.error("Could not load dotenv");
    }
}

const { createClient } = require(path.join(__dirname, '../backend/node_modules/@supabase/supabase-js'));
const axios = require(path.join(__dirname, '../backend/node_modules/axios'));


const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const PORT = 3001; // Backend runs on 3001

async function runTest() {
    console.log("1. Setting up Test Environment...");
    
    // 1. Get a user ID
    const { data: users, error: userError } = await supabase
        .from('user_configs')
        .select('user_id')
        .limit(1);

    if (userError || !users || users.length === 0) {
        console.error("Error fetching user:", userError);
        return;
    }
    const userId = users[0].user_id;
    console.log("   User ID:", userId);

    // 2. Setup WhatsApp Session in DB
            const sessionName = 'test_sim_base64_v3';
            
            // Ensure entry exists
    const { error: upsertError } = await supabase
        .from('whatsapp_message_database')
        .upsert({ 
            session_name: sessionName, 
            user_id: userId,
            active: true,
            reply_message: true,
            image_detection: true 
        });

    if (upsertError) {
        console.error("Error setting up DB:", upsertError);
        return;
    }
    console.log(`   Session '${sessionName}' ready.`);

    // 3. Simulate Webhook with jpegThumbnail (Base64)
    console.log("2. Sending Webhook with jpegThumbnail...");
    
    // 1x1 Red Dot Base64 (without prefix, as WAHA usually sends raw base64 in jpegThumbnail)
    const base64Raw = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

    const payload = {
        event: "message",
        session: sessionName,
        payload: {
            id: "msg_" + Date.now(),
            timestamp: Math.floor(Date.now() / 1000),
            from: "8801700000000@c.us",
            to: "8801800000000@c.us",
            body: "", // Empty body
            hasMedia: true,
            _data: {
                jpegThumbnail: base64Raw
            }
        }
    };

    try {
        const response = await axios.post(`http://localhost:${PORT}/whatsapp/webhook`, payload);
        console.log("   Webhook Response:", response.status, response.data);
        console.log("3. Check server logs to see if '[WA] Using jpegThumbnail...' and '[Vision] Processing Base64...' appeared.");
    } catch (e) {
        console.error("   Webhook Failed:", e.message);
    }
}

runTest();
