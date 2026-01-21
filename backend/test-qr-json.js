
const fetch = require('node-fetch');

const WAHA_BASE_URL = 'https://wahubbd.salesmanchatbot.online';
const WAHA_API_KEY = 'e9457ca133cc4d73854ee0d43cee3bc5';
const sessionName = 'sales-not';

async function testJsonQR() {
    console.log(`Testing JSON QR for: ${sessionName}`);
    
    // Correct Path with format=json
    const url = `${WAHA_BASE_URL}/api/${sessionName}/auth/qr?format=json`;
    console.log(`Fetching: ${url}`);

    try {
        const res = await fetch(url, { headers: { 'X-Api-Key': WAHA_API_KEY } });
        console.log(`Status: ${res.status}`);
        
        if (res.ok) {
            const data = await res.json();
            console.log('Response Keys:', Object.keys(data));
            if (data.qr) console.log('QR found (length):', data.qr.length);
            if (data.data) console.log('Data found (length):', data.data.length);
            console.log('Sample:', JSON.stringify(data).substring(0, 100));
        } else {
            console.log('Error Body:', await res.text());
        }
    } catch (e) {
        console.error('Error:', e.message);
    }
}

testJsonQR();
