
const fetch = require('node-fetch');
require('dotenv').config();

const WAHA_BASE_URL = process.env.WAHA_BASE_URL || 'https://wahubbd.salesmanchatbot.online';
const WAHA_API_KEY = process.env.WAHA_API_KEY;
const SESSION_NAME = 'sales-not'; // User mentioned this session name

async function testQrFetch() {
    console.log(`Fetching QR for session: ${SESSION_NAME}`);
    console.log(`Base URL: ${WAHA_BASE_URL}`);

    const url = `${WAHA_BASE_URL}/api/${encodeURIComponent(SESSION_NAME)}/auth/qr?format=image`;
    const headers = {};
    if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;

    try {
        const response = await fetch(url, { headers });
        console.log(`Response Status: ${response.status}`);
        console.log(`Content-Type: ${response.headers.get('content-type')}`);

        if (response.ok) {
            const buffer = await response.buffer();
            console.log(`✅ Success! Received ${buffer.length} bytes.`);
            if (buffer.length > 0) {
                 const base64 = buffer.toString('base64');
                 console.log(`Base64 Preview: ${base64.substring(0, 50)}...`);
            } else {
                console.log('⚠️ Empty buffer received.');
            }
        } else {
            const text = await response.text();
            console.log(`❌ Error Body: ${text}`);
        }

    } catch (error) {
        console.error('❌ Fetch Error:', error);
    }
}

testQrFetch();
