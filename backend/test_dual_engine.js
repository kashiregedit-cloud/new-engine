const fetch = require('node-fetch');

const BACKEND_URL = 'http://localhost:3001';

async function createSession(engine) {
    // Unique session name
    const sessionName = `test_${engine.toLowerCase()}_${Math.random().toString(36).substring(7)}`;
    
    const payload = {
        sessionName: sessionName,
        userEmail: 'test_verify@example.com',
        userId: null, // Bypass balance check for testing
        planDays: 30,
        engine: engine 
    };

    console.log(`\n--- Creating session ${sessionName} with engine ${engine} ---`);

    try {
        // 1. Create Session
        const res = await fetch(`${BACKEND_URL}/session/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();
        
        if (res.ok) {
            console.log(`[SUCCESS] Session created. Status: ${res.status}`);
            
            // 2. Verify Engine via GET /sessions
            console.log('Verifying engine type from WAHA...');
            // Wait a moment for WAHA to register it fully
            await new Promise(r => setTimeout(r, 2000));
            
            const sessionsRes = await fetch(`${BACKEND_URL}/sessions`);
            const sessions = await sessionsRes.json();
            
            const mySession = sessions.find(s => s.name === sessionName);
            if (mySession) {
                // Check engine in session config
                // WAHA structure: session.config.engine or session.engine?
                // Let's print the whole config part we care about
                const engineInConfig = mySession.config?.engine;
                const browser = mySession.config?.client?.browserName;
                
                console.log(`> Session Name: ${mySession.name}`);
                console.log(`> Engine (Config): ${engineInConfig}`);
                console.log(`> Browser: ${browser}`);
                
                if (engine === 'NOWAB') {
                     if (engineInConfig === 'NOWEB' || browser === 'IE') {
                         console.log('✅ NOWAB Engine Verified!');
                     } else {
                         console.log('❌ NOWAB Mismatch! Got: ' + engineInConfig);
                     }
                } else if (engine === 'WEBJS') {
                    if (engineInConfig === 'WEBJS') {
                        console.log('✅ WEBJS Engine Verified!');
                    } else {
                        console.log('❌ WEBJS Mismatch! Got: ' + engineInConfig);
                    }
                }
                
            } else {
                console.error('Session NOT found in list!');
            }
        } else {
            console.error('[FAILED] Creation Failed:', data);
        }

    } catch (error) {
        console.error('Test error:', error);
    }
}

async function runTests() {
    await createSession('WEBJS');
    console.log('\n-----------------------------------\n');
    await createSession('NOWAB');
}

runTests();
