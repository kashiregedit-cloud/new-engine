const fetch = require('node-fetch');

const BACKEND_URL = 'http://localhost:3001';

async function createSession() {
    // Unique session name to avoid conflicts
    const sessionName = `test_noweb_real_${Math.random().toString(36).substring(7)}`;
    
    const payload = {
        sessionName: sessionName,
        userEmail: 'test_verify@example.com',
        userId: 'f3cc8cff-fded-49c1-8850-c49b402ef489',
        planDays: 30,
        engine: 'NOWAB' // Frontend sends NOWAB
    };

    console.log(`Creating session ${sessionName} with engine NOWAB...`);

    try {
        // 1. Create Session
        const res = await fetch(`${BACKEND_URL}/session/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        console.log('Create Status:', res.status);
        
        if (res.ok) {
            console.log('Session created successfully.');
            
            // 2. Verify Engine via GET /sessions
            console.log('Verifying engine type...');
            // Wait a moment for WAHA to register it fully
            await new Promise(r => setTimeout(r, 2000));
            
            const sessionsRes = await fetch(`${BACKEND_URL}/sessions`);
            const sessions = await sessionsRes.json();
            
            const mySession = sessions.find(s => s.name === sessionName);
            if (mySession) {
                console.log('FULL SESSION OBJECT:', JSON.stringify(mySession, null, 2));
            } else {
                console.error('Session NOT found in list!');
            }
        } else {
            console.error('Creation Failed:', data);
        }

    } catch (error) {
        console.error('Test error:', error);
    }
}

createSession();
