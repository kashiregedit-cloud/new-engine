const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

// Config
const PORT = 3001;
const SUPABASE_URL = 'https://supabasexyz.salesmanchatbot.online';
const SUPABASE_KEY = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc2ODkwNTEyMCwiZXhwIjo0OTI0NTc4NzIwLCJyb2xlIjoic2VydmljZV9yb2xlIn0.beU7mPb3wHjqfrI1jWsgk00_W6LPRMZ09kCiNBCZ6oY';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runTest() {
    console.log("1. Setting up Test Environment...");
    
    // 1. Get a valid user
    const { data: users, error: userError } = await supabase
        .from('user_configs')
        .select('user_id')
        .limit(1);

    if (userError || !users || users.length === 0) {
        console.error("Failed to find a user in user_configs:", userError);
        return;
    }
    const userId = users[0].user_id;
    console.log(`   Using User ID: ${userId}`);

    // 2. Create/Upsert Dummy WhatsApp Session
    const sessionName = 'test_sim_session_v2';
    const { error: dbError } = await supabase
        .from('whatsapp_message_database')
        .upsert({
            session_name: sessionName,
            user_id: userId,
            active: true,
            status: 'connected',
            reply_message: true,
            text_prompt: "You are a helpful assistant.",
            image_detection: true // Ensure this is true!
        }, { onConflict: 'session_name' });

    if (dbError) {
        console.error("Failed to setup test session:", dbError);
        return;
    }
    console.log(`   Session '${sessionName}' configured.`);

    // 3. Send Webhook Payload
    const imageUrl = "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b6/Image_created_with_a_mobile_phone.png/640px-Image_created_with_a_mobile_phone.png";
    
    const payload = {
        event: "message",
        session: sessionName,
        payload: {
            id: "msg_" + Date.now(),
            timestamp: Math.floor(Date.now() / 1000),
            from: "8801700000000@c.us",
            to: "8801800000000@c.us",
            body: "",
            hasMedia: true,
            mediaUrl: imageUrl,
            mimetype: "image/png",
            _data: { notifyName: "Tester" }
        }
    };

    console.log("2. Sending Webhook...");
    try {
        const response = await axios.post(`http://localhost:${PORT}/whatsapp/webhook`, payload);
        console.log("   Webhook Response:", response.status, response.data);
    } catch (e) {
        console.error("   Webhook Failed:", e.message);
    }

    console.log("3. Done. Check backend console logs for AI processing output.");
}

runTest();
