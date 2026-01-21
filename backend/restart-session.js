
const fetch = require('node-fetch');

const WAHA_BASE_URL = 'https://wahubbd.salesmanchatbot.online';
const WAHA_API_KEY = 'e9457ca133cc4d73854ee0d43cee3bc5';
const sessionName = 'sales-not';

async function restartAndCheck() {
    console.log(`Restarting session: ${sessionName}`);

    // 1. STOP
    try {
        console.log('Stopping...');
        await fetch(`${WAHA_BASE_URL}/api/sessions/${sessionName}/stop`, {
            method: 'POST',
            headers: { 'X-Api-Key': WAHA_API_KEY }
        });
    } catch (e) {}

    // 2. START
    try {
        console.log('Starting...');
        await fetch(`${WAHA_BASE_URL}/api/sessions/${sessionName}/start`, {
            method: 'POST',
            headers: { 'X-Api-Key': WAHA_API_KEY }
        });
    } catch (e) { console.error('Start failed:', e.message); }

    // 3. Wait and Poll for QR
    console.log('Polling for QR...');
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000)); // Wait 2s
        
        try {
            const res = await fetch(`${WAHA_BASE_URL}/api/sessions/${sessionName}/auth/qr?format=image`, {
                headers: { 'X-Api-Key': WAHA_API_KEY }
            });
            
            console.log(`Attempt ${i+1}: Status ${res.status}`);
            if (res.ok) {
                console.log('QR FOUND!');
                const buffer = await res.buffer();
                console.log('Buffer size:', buffer.length);
                break;
            }
        } catch (e) {
            console.error('Poll error:', e.message);
        }
    }
}

restartAndCheck();
