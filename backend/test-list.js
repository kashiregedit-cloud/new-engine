
const fetch = require('node-fetch');

const WAHA_BASE_URL = 'https://wahubbd.salesmanchatbot.online';
const WAHA_API_KEY = 'e9457ca133cc4d73854ee0d43cee3bc5';

async function listSessions() {
    try {
        const url = `${WAHA_BASE_URL}/api/sessions?all=true`;
        console.log(`Fetching: ${url}`);
        const res = await fetch(url, { headers: { 'X-Api-Key': WAHA_API_KEY } });
        console.log(`Status: ${res.status}`);
        
        if (res.ok) {
            const data = await res.json();
            console.log(`Found ${data.length} sessions.`);
            data.forEach(s => {
                console.log(`- ${s.name} (${s.status})`);
            });
        } else {
            console.log('Error:', await res.text());
        }
    } catch (e) { console.error(e.message); }
}

listSessions();
