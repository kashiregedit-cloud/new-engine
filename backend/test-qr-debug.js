
const fetch = require('node-fetch');

const WAHA_BASE_URL = 'https://wahubbd.salesmanchatbot.online';
const WAHA_API_KEY = 'e9457ca133cc4d73854ee0d43cee3bc5';
const sessionName = 'sales-not';

async function testEndpoints() {
    console.log(`Testing QR endpoints for: ${sessionName}`);

    // Test 1: Default (should be image)
    try {
        console.log('\n--- Test 1: Default (No params) ---');
        const url = `${WAHA_BASE_URL}/api/sessions/${sessionName}/auth/qr`;
        const res = await fetch(url, { headers: { 'X-Api-Key': WAHA_API_KEY } });
        console.log(`Status: ${res.status}`);
        console.log(`Content-Type: ${res.headers.get('content-type')}`);
        if (res.ok) {
            const buffer = await res.buffer();
            console.log(`Received buffer length: ${buffer.length}`);
            console.log(`Base64 start: ${buffer.toString('base64').substring(0, 50)}...`);
        } else {
            console.log('Error:', await res.text());
        }
    } catch (e) { console.error(e.message); }

    // Test 3: Check Session Info with ?all=true
    try {
        console.log('\n--- Test 3: Session Info (all=true) ---');
        const url = `${WAHA_BASE_URL}/api/sessions/${sessionName}?all=true`;
        const res = await fetch(url, { headers: { 'X-Api-Key': WAHA_API_KEY } });
        console.log(`Status: ${res.status}`);
        if (res.ok) {
            const data = await res.json();
            console.log('Session Data Keys:', Object.keys(data));
            // Check for any nested QR data
            if (data.qr) console.log('Found data.qr!');
            if (data.me) console.log('Found data.me:', data.me);
        }
    } catch (e) { console.error(e.message); }

    // Test 4: Screenshot
    try {
        console.log('\n--- Test 4: Screenshot ---');
        const url = `${WAHA_BASE_URL}/api/sessions/${sessionName}/screenshot`;
        const res = await fetch(url, { headers: { 'X-Api-Key': WAHA_API_KEY } });
        console.log(`Status: ${res.status}`);
        if (res.ok) {
            const buffer = await res.buffer();
            console.log(`Screenshot size: ${buffer.length}`);
        } else {
             console.log('Error:', await res.text());
        }
    } catch (e) { console.error(e.message); }
}

testEndpoints();
