const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');
const whatsappService = require('../services/whatsappService');
const dbService = require('../services/dbService');

// WAHA Webhook Listener (POST)
// Endpoint: /whatsapp/webhook
router.post('/webhook', whatsappController.handleWebhook);

// Get Sessions
router.get('/sessions', async (req, res) => {
    const sessions = await whatsappService.getSessions(true);
    res.json(sessions);
});

// Create Session
router.post('/session/create', async (req, res) => {
    try {
        const { name, sessionName, config, engine } = req.body;
        const finalName = name || sessionName;
        
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error } = await dbService.supabase.auth.getUser(token);
        
        if (error || !user) {
            return res.status(401).json({ error: 'Invalid token' });
        }
        
        // Construct WAHA Config
        // User requested specific configuration for n8n and robustness
        const backendWebhookUrl = `${process.env.BACKEND_URL || 'https://webhook.salesmanchatbot.online'}/whatsapp/webhook`;
        
        // Only use the Backend Webhook as requested
        const wahaConfig = config || {
            metadata: {},
            debug: false,
            noweb: {
                markOnline: true,
                store: {
                    enabled: true,
                    fullSync: false
                }
            },
            webhooks: [
                {
                    url: backendWebhookUrl,
                    events: ["message", "message.any", "state.change"],
                    retries: {
                        delaySeconds: 2,
                        attempts: 15,
                        policy: "linear"
                    },
                    customHeaders: null
                }
            ],
            client: {
                deviceName: "salesmanchatbot.online || wp : +880195687140.",
                browserName: "IE"
            }
        };

        // 1. Create Session in WAHA
        console.log(`[WhatsApp] Creating session '${finalName}'...`);
        await whatsappService.createSession({ name: finalName, config: wahaConfig });

        // 2. Wait for Session to appear and Start it
        let sessionReady = false;
        let attempts = 0;
        const maxAttempts = 20; // 20 seconds timeout

        while (!sessionReady && attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
            
            try {
                // Check if session exists and its status
                const allSessions = await whatsappService.getSessions(true);
                const session = allSessions.find(s => s.name === finalName);

                if (session) {
                    console.log(`[WhatsApp] Session '${finalName}' found. Status: ${session.status}`);
                    
                    if (session.status === 'STOPPED') {
                        console.log(`[WhatsApp] Session '${finalName}' is STOPPED. Starting...`);
                        await whatsappService.startSession(finalName);
                    } else if (session.status === 'STARTING' || session.status === 'SCAN_QR' || session.status === 'WORKING') {
                        sessionReady = true;
                        console.log(`[WhatsApp] Session '${finalName}' is active/starting.`);
                    } else {
                        console.log(`[WhatsApp] Session '${finalName}' status: ${session.status}. Waiting...`);
                    }
                } else {
                    console.log(`[WhatsApp] Session '${finalName}' not found yet. Attempt ${attempts}/${maxAttempts}`);
                }
            } catch (err) {
                console.warn(`[WhatsApp] Error checking session status: ${err.message}`);
            }
        }

        if (!sessionReady) {
            console.warn(`[WhatsApp] Session '${finalName}' creation/start timed out, but proceeding to DB save.`);
        }
        
        // 3. Insert into whatsapp_message_database
        
        // 2. Insert into whatsapp_message_database
        const dbEntry = await dbService.createWhatsAppEntry(finalName, user.id);
        
        // 3. Fetch QR Code (Wait a bit for WAHA to initialize)
        await new Promise(resolve => setTimeout(resolve, 2000));
        const qr = await whatsappService.getScreenshot(finalName);

        // Save QR to DB for frontend polling
        if (qr) {
             await dbService.updateWhatsAppEntry(dbEntry.id, { 
                 qr_code: qr,
                 status: 'scanned' 
             });
        }

        res.json({ 
            success: true, 
            id: dbEntry.id,
            session_name: finalName,
            qr_code: qr 
        });
        
    } catch (err) {
        console.error("Create Session Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Delete Session
router.post('/session/delete', async (req, res) => {
    try {
        const { sessionName, name } = req.body; // Support both
        const target = sessionName || name;
        
        // Try to stop session first to avoid "session busy" errors
        try {
            await whatsappService.stopSession(target);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for stop
        } catch (stopErr) {
            console.warn(`[WhatsApp] Could not stop session '${target}' before delete:`, stopErr.message);
        }

        await whatsappService.deleteSession(target);
        
        // Also remove from DB
        await dbService.deleteWhatsAppEntry(target);
        
        res.json({ success: true });
    } catch (err) {
        console.error("Delete Session Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Get Pairing Code (Solution for Single Device)
router.post('/session/pairing-code', async (req, res) => {
    try {
        const { sessionName, phoneNumber } = req.body;
        
        if (!sessionName || !phoneNumber) {
            return res.status(400).json({ error: "Missing sessionName or phoneNumber" });
        }

        // Format Phone Number (Auto-fix for BD)
        let formattedPhone = phoneNumber.replace(/\D/g, '');
        if (formattedPhone.startsWith('01')) {
            formattedPhone = '880' + formattedPhone.substring(1);
        } else if (formattedPhone.startsWith('1') && formattedPhone.length === 10) {
            formattedPhone = '880' + formattedPhone;
        }
        
        console.log(`[WhatsApp] Pairing Code Request for '${sessionName}' with phone '${formattedPhone}'`);

        // 1. Check Session Status
        let allSessions = await whatsappService.getSessions(true);
        let session = allSessions.find(s => s.name === sessionName);

        if (!session) {
            return res.status(404).json({ error: `Session '${sessionName}' not found.` });
        }

        console.log(`[WhatsApp] Pairing Code Request for '${sessionName}'. Status: ${session.status}`);

        // 2. Handle Status
        // Special Handling for 'WORKING' or 'FAILED' sessions to force a fresh start
        if (session.status === 'WORKING' || session.status === 'FAILED' || session.status === 'STOPPED') {
            console.log(`[WhatsApp] Session '${sessionName}' is ${session.status}. Resetting for pairing code...`);
            
            try {
                // 1. Force Logout (Clear Auth Data to fix Connection Failure)
                try {
                    await whatsappService.logoutSession(sessionName);
                    await new Promise(r => setTimeout(r, 2000)); // Wait for logout
                } catch (logoutErr) {
                    console.warn(`[WhatsApp] Logout failed (non-fatal):`, logoutErr.message);
                }

                // 2. Stop Session (Ensure it's fully stopped)
                try {
                    await whatsappService.stopSession(sessionName);
                    await new Promise(r => setTimeout(r, 1000));
                } catch (stopErr) {
                    // Ignore if already stopped
                }
                
                // 3. Start Session (Fresh Start)
                console.log(`[WhatsApp] Starting session '${sessionName}'...`);
                await whatsappService.startSession(sessionName);
            } catch (err) {
                console.error(`[WhatsApp] Reset failed:`, err.message);
                // Continue to polling, hoping it started
            }
            
            // Poll for SCAN_QR_CODE
            let attempts = 0;
            const maxAttempts = 30; // Increased to 30 seconds for full restart
            let ready = false;

            while (!ready && attempts < maxAttempts) {
                await new Promise(r => setTimeout(r, 1000));
                allSessions = await whatsappService.getSessions(true);
                session = allSessions.find(s => s.name === sessionName);
                
                if (session && (session.status === 'SCAN_QR_CODE' || session.status === 'SCAN_QR')) {
                    ready = true;
                }
                attempts++;
            }

            if (!ready) {
                return res.status(500).json({ error: "Session failed to enter SCAN_QR_CODE mode. Please try again." });
            }
        }

        // 3. Request Code
        // Add a small delay to ensure WAHA is fully ready to accept auth code request
        await new Promise(r => setTimeout(r, 2000));

        const code = await whatsappService.getPairingCode(sessionName, formattedPhone);
        res.json({ success: true, code: code });
    } catch (err) {
        console.error("Pairing Code Error:", err);
        
        // Enhance error message for user
        let msg = err.message;
        if (err.response && err.response.data && err.response.data.message) {
            msg = err.response.data.message;
        }
        
        res.status(500).json({ error: msg });
    }
});

// Start Session
router.post('/session/start', async (req, res) => {
    try {
        const { sessionName } = req.body;
        await whatsappService.startSession(sessionName);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Stop Session
router.post('/session/stop', async (req, res) => {
    try {
        const { sessionName } = req.body;
        await whatsappService.stopSession(sessionName);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Restart Session
router.post('/session/restart', async (req, res) => {
    try {
        const { sessionName } = req.body;
        try { await whatsappService.stopSession(sessionName); } catch (e) {}
        
        // Wait 2 seconds before starting to ensure cleanup
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        await whatsappService.startSession(sessionName);
        
        // Wait and fetch QR
        await new Promise(resolve => setTimeout(resolve, 2000));
        const qr = await whatsappService.getScreenshot(sessionName);

        if (qr) {
             await dbService.updateWhatsAppEntryByName(sessionName, { 
                 qr_code: qr,
                 status: 'scanned' 
             });
        }

        res.json({ success: true, qr_code: qr });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get QR Code
router.get('/session/qr/:name', async (req, res) => {
    try {
        const { name } = req.params;
        const qr = await whatsappService.getScreenshot(name);
        res.json({ qr_code: qr });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
