
const fetch = require('node-fetch');

const WAHA_BASE_URL = 'https://wahubbd.salesmanchatbot.online';
const WAHA_API_KEY = 'e9457ca133cc4d73854ee0d43cee3bc5';
const sessionName = 'test-auto-trae-1';

async function createAndCheck() {
    console.log(`Creating session: ${sessionName}`);

    // 1. Create
    try {
        const res = await fetch(`${WAHA_BASE_URL}/api/sessions`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-Api-Key': WAHA_API_KEY
            },
            body: JSON.stringify({ name: sessionName, config: { proxy: null } })
        });
        console.log(`Create Status: ${res.status}`);
        const data = await res.json();
        console.log('Create Response:', data);
    } catch (e) { console.error('Create failed:', e.message); }

    // 2. Start (It might auto-start, but let's be sure)
    try {
        const res = await fetch(`${WAHA_BASE_URL}/api/sessions/${sessionName}/start`, {
            method: 'POST',
            headers: { 'X-Api-Key': WAHA_API_KEY }
        });
        console.log(`Start Status: ${res.status}`);
    } catch (e) {}

    // 3. Poll for QR
    console.log('Polling for QR...');
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 2000));
        
        try {
            // Try with format=image AND Accept header
            const res = await fetch(`${WAHA_BASE_URL}/api/sessions/${sessionName}/auth/qr?format=image`, {
                headers: { 
                    'X-Api-Key': WAHA_API_KEY,
                    'Accept': 'image/png'
                }
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

createAndCheck();
