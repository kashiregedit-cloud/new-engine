
const fetch = require('node-fetch');

const WAHA_BASE_URL = 'https://wahubbd.salesmanchatbot.online';
const WAHA_API_KEY = 'e9457ca133cc4d73854ee0d43cee3bc5';
const sessionName = 'sales-not';

async function checkQR() {
    console.log(`Checking QR for session: ${sessionName}`);
    
    // Check Session Status first
    try {
        const statusUrl = `${WAHA_BASE_URL}/api/sessions/${sessionName}`;
        const statusRes = await fetch(statusUrl, {
            headers: { 'X-Api-Key': WAHA_API_KEY }
        });
        const statusData = await statusRes.json();
        console.log('Session Status:', JSON.stringify(statusData, null, 2));
    } catch (e) {
        console.error('Error fetching status:', e.message);
    }

    // Try fetching QR
    try {
        const qrUrl = `${WAHA_BASE_URL}/api/sessions/${sessionName}/auth/qr?format=json`;
        console.log(`Fetching QR from: ${qrUrl}`);
        
        const qrRes = await fetch(qrUrl, {
            headers: { 'X-Api-Key': WAHA_API_KEY }
        });
        
        console.log(`QR Response Status: ${qrRes.status} ${qrRes.statusText}`);
        
        if (qrRes.ok) {
            const data = await qrRes.json();
            console.log('QR Response Data Keys:', Object.keys(data));
            if (data.qr) console.log('QR length:', data.qr.length);
            if (data.data) console.log('Data length:', data.data.length);
            console.log('Full Response:', JSON.stringify(data, null, 2).substring(0, 500) + '...');
        } else {
            const text = await qrRes.text();
            console.log('QR Error Body:', text);
        }
    } catch (e) {
        console.error('Error fetching QR:', e.message);
    }
}

checkQR();
