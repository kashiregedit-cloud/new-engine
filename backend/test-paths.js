
const fetch = require('node-fetch');

const WAHA_BASE_URL = 'https://wahubbd.salesmanchatbot.online';
const WAHA_API_KEY = 'e9457ca133cc4d73854ee0d43cee3bc5';
const sessionName = 'sales-not';

async function testPaths() {
    const paths = [
        `/api/sessions/${sessionName}/auth/qr`,
        `/api/${sessionName}/auth/qr`,
        `/sessions/${sessionName}/auth/qr`,
        `/api/session/${sessionName}/auth/qr`, // singular session
        `/api/sessions/${sessionName}/qr`,
        `/api/${sessionName}/qr`
    ];

    for (const p of paths) {
        try {
            const url = `${WAHA_BASE_URL}${p}?format=image`;
            console.log(`Testing: ${url}`);
            const res = await fetch(url, { headers: { 'X-Api-Key': WAHA_API_KEY } });
            console.log(`-> ${res.status}`);
            if (res.ok) console.log('   FOUND!!!');
        } catch (e) { console.error(e.message); }
    }
}

testPaths();
