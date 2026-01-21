
const fetch = require('node-fetch');

const WAHA_BASE_URL = 'https://wahubbd.salesmanchatbot.online';
const WAHA_API_KEY = 'e9457ca133cc4d73854ee0d43cee3bc5';
const sessionName = 'sales-not';

async function checkContentType() {
    const url = `${WAHA_BASE_URL}/api/${sessionName}/auth/qr?format=json`;
    console.log(`Fetching: ${url}`);
    
    try {
        const res = await fetch(url, { headers: { 'X-Api-Key': WAHA_API_KEY } });
        console.log(`Status: ${res.status}`);
        console.log(`Content-Type: ${res.headers.get('content-type')}`);
        
        const buffer = await res.buffer();
        console.log(`Buffer length: ${buffer.length}`);
        console.log(`Is PNG? ${buffer.toString('hex').startsWith('89504e47')}`);
    } catch (e) { console.error(e); }
}

checkContentType();
