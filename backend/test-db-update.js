
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Use Service Role Key for Admin Access
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testDbUpdate() {
    const sessionName = 'db-test-' + Date.now();
    const testEmail = 'test@example.com';
    const testUserId = 'test-user-id-123';

    console.log(`Testing DB Upsert for ${sessionName}...`);

    const payload = {
        session_id: sessionName,
        session_name: sessionName,
        user_email: testEmail,
        user_id: testUserId,
        status: 'created',
        qr_code: 'data:image/png;base64,test',
        plan_days: 30,
        updated_at: new Date().toISOString()
    };

    const { data, error } = await supabase
        .from('whatsapp_sessions')
        .upsert(payload)
        .select()
        .single();

    if (error) {
        console.error('❌ DB Upsert Error:', error);
    } else {
        console.log('✅ DB Upsert Success!');
        console.log('Saved Data:', data);

        if (data.user_email === testEmail && data.user_id === testUserId) {
            console.log('✅ User Email and ID saved correctly.');
        } else {
            console.error('❌ User Email/ID MISMATCH in DB!');
            console.log(`Expected: ${testEmail}, ${testUserId}`);
            console.log(`Actual: ${data.user_email}, ${data.user_id}`);
        }
    }
}

testDbUpdate();
