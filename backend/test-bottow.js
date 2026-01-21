
const fetch = require('node-fetch');

const WAHA_BASE_URL = 'https://wahubbd.salesmanchatbot.online';
const WAHA_API_KEY = 'e9457ca133cc4d73854ee0d43cee3bc5';

async function checkBottow() {
    console.log('Checking bottow screenshot...');
    try {
        const url = `${WAHA_BASE_URL}/api/sessions/bottow/screenshot`;
        const res = await fetch(url, { headers: { 'X-Api-Key': WAHA_API_KEY } });
        console.log(`Status: ${res.status}`);
        if (res.ok) {
            const buffer = await res.buffer();
            console.log(`Size: ${buffer.length}`);
        } else {
            console.log('Error:', await res.text());
        }
    } catch (e) { console.error(e.message); }
}

checkBottow();
