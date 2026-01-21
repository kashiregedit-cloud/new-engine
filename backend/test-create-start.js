
const fetch = require('node-fetch');
require('dotenv').config();

const WAHA_BASE_URL = process.env.WAHA_BASE_URL || 'https://wahubbd.salesmanchatbot.online';
const WAHA_API_KEY = process.env.WAHA_API_KEY;

async function testCreateAndStart() {
    const sessionName = 'test-start-' + Date.now();
    console.log(`Creating session: ${sessionName}`);

    const headers = { 'Content-Type': 'application/json' };
    if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;

    // 1. Create
    const createRes = await fetch(`${WAHA_BASE_URL}/api/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            name: sessionName,
            start: true,
            config: {
                metadata: {},
                debug: false,
                noweb: { store: { enabled: true, fullSync: false } }
            }
        })
    });
    const createData = await createRes.json();
    console.log('Create Response:', createData);

    if (createData.status === 'STOPPED') {
        console.log('⚠️ Session created but STOPPED. Attempting explicit start...');
        const startRes = await fetch(`${WAHA_BASE_URL}/api/sessions/${sessionName}/start`, {
            method: 'POST',
            headers
        });
        if (startRes.ok) {
            console.log('✅ Explicit Start command sent.');
        } else {
            console.log('❌ Start command failed:', await startRes.text());
        }
    }

    // 2. Wait and check QR
    for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, 2000));
        console.log(`Checking QR (Attempt ${i+1})...`);
        const qrRes = await fetch(`${WAHA_BASE_URL}/api/${sessionName}/auth/qr?format=image`, { headers });
        if (qrRes.ok) {
            console.log('✅ QR Found!');
            break;
        } else {
            console.log(`❌ QR Not Ready: ${qrRes.status}`);
        }
    }
}

testCreateAndStart();
