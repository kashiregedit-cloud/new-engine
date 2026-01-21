
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://supabasexyz.salesmanchatbot.online';
const supabaseKey = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc2ODkwNTEyMCwiZXhwIjo0OTI0NTc4NzIwLCJyb2xlIjoiYW5vbiJ9.gxYvU2Wtwi74sTBWUeEeMt1Cak-Jv4w28w-9Nlfhk-k';

const supabase = createClient(supabaseUrl, supabaseKey);

async function testLogin() {
    console.log('Attempting login with xbluewhalebd@gmail.com...');
    const { data, error } = await supabase.auth.signInWithPassword({
        email: 'xbluewhalebd@gmail.com',
        password: '909090'
    });

    if (error) {
        console.error('Login failed:', error.message);
        return;
    }

    console.log('Login successful!');
    console.log('Session User Email:', data.session.user.email);
    console.log('Session User ID:', data.session.user.id);
    console.log('Session Access Token:', data.session.access_token.substring(0, 20) + '...');

    console.log('Attempting getUser()...');
    const { data: userData, error: userError } = await supabase.auth.getUser();
    
    if (userError) {
        console.error('getUser() failed:', userError.message);
    } else {
        console.log('getUser() Email:', userData.user.email);
    }

    // Also simulate the session create check logic
    let session = data.session;
    if (!session || !session.user || !session.access_token) {
        console.log('Simulating refresh check: Session missing or incomplete');
    } else {
        console.log('Session check passed: User and Access Token present');
    }

    // Check user.email specifically
    if (!session.user.email) {
        console.error('CRITICAL: session.user.email is missing!');
    } else {
        console.log('session.user.email is present:', session.user.email);
    }
}

testLogin();
