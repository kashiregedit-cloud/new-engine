
const fetch = require('node-fetch'); // Ensure node-fetch is available or use native fetch in Node 18+

async function createSession() {
    const backendUrl = 'http://localhost:3001';
    const sessionName = 'test-session-' + Date.now();
    
    console.log(`Creating session: ${sessionName}...`);
    
    try {
        const response = await fetch(`${backendUrl}/session/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
                // Note: Not sending Authorization header here, so it will use the global client in backend.
                // If backend requires auth, this might fail or create as anonymous.
            },
            body: JSON.stringify({
                sessionName: sessionName,
                userEmail: 'test@example.com', // Mock data
                userId: 'test-user-id',        // Mock data
                plan: 30
            })
        });

        const data = await response.json();
        
        console.log('Status:', response.status);
        console.log('Response:', JSON.stringify(data, null, 2));
        
        if (data.qr) {
            console.log('✅ QR Code received!');
        } else {
            console.log('⚠️ No QR Code in response (might be waiting for webhook or delayed).');
        }

    } catch (error) {
        console.error('❌ Error creating session:', error);
    }
}

createSession();
