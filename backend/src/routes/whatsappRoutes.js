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
        const { name, sessionName, config, engine, phoneNumber } = req.body;
        const finalName = (sessionName || name || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
        
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
        const backendWebhookUrl = process.env.BACKEND_URL 
            ? `${process.env.BACKEND_URL}/whatsapp/webhook`
            : "https://webhook.salesmanchatbot.online/whatsapp/webhook";

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
                    } else if (session.status === 'STARTING' || session.status === 'SCAN_QR_CODE' || session.status === 'SCAN_QR' || session.status === 'WORKING') {
                        // If Pairing Code requested, we strictly need SCAN_QR status (or WORKING if re-pairing)
                        if (phoneNumber && session.status !== 'SCAN_QR' && session.status !== 'SCAN_QR_CODE' && session.status !== 'WORKING') {
                             console.log(`[WhatsApp] Waiting for SCAN_QR status for Pairing Code (Current: ${session.status})...`);
                             sessionReady = false; // Keep waiting
                        } else {
                            sessionReady = true;
                            console.log(`[WhatsApp] Session '${finalName}' is active/starting.`);
                        }
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
        const dbEntry = await dbService.createWhatsAppEntry(finalName, user.id);
        
        let qr = null;
        let pairingCode = null;

        // 4. Handle Pairing Code or QR
        if (phoneNumber) {
            // Format Phone
            let formattedPhone = phoneNumber.replace(/\D/g, '');
            if (formattedPhone.startsWith('01')) {
                formattedPhone = '880' + formattedPhone.substring(1);
            } else if (formattedPhone.startsWith('1') && formattedPhone.length === 10) {
                formattedPhone = '880' + formattedPhone;
            }

            console.log(`[WhatsApp] Auto-Pairing requested for '${finalName}' with phone '${formattedPhone}'`);

            // Retry getting Pairing Code directly (more reliable than status checking)
            let pairingAttempts = 0;
            const maxPairingAttempts = 30; // Increased to 30 attempts (approx 30-45 seconds)
            
            while (!pairingCode && pairingAttempts < maxPairingAttempts) {
                try {
                    // Try to fetch pairing code
                    pairingCode = await whatsappService.getPairingCode(finalName, formattedPhone);
                    console.log(`[WhatsApp] Pairing Code Generated: ${pairingCode}`);
                    break; // Success!
                } catch (e) {
                    pairingAttempts++;
                    const is404 = e.response && e.response.status === 404;
                    const errorMsg = is404 ? "Endpoint not ready (404)" : e.message;
                    console.log(`[WhatsApp] Pairing Code not ready yet (Attempt ${pairingAttempts}/${maxPairingAttempts}). Error: ${errorMsg}. Waiting...`);
                    
                    // Wait 1.5 seconds before retry
                    await new Promise(r => setTimeout(r, 1500));
                }
            }

            if (!pairingCode) {
                console.warn(`[WhatsApp] Failed to get Pairing Code after ${maxPairingAttempts} attempts.`);
            }
        }

        // ALWAYS fetch QR Code as well (User requested both)
        try {
            // If we didn't wait for pairing (no phone number), wait a bit for initialization
            if (!phoneNumber) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            qr = await whatsappService.getScreenshot(finalName);
        } catch (error) {
            console.warn(`[WhatsApp] Failed to fetch QR code: ${error.message}`);
        }

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
            qr_code: qr,
            pairing_code: pairingCode
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
            await whatsappService.logoutSession(target); // Try logout first (Best Practice for WAHA)
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (e) { 
            // Ignore logout error (might be already logged out)
        }

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
                
                // Wait a bit for startup
                await new Promise(r => setTimeout(r, 3000));
            } catch (err) {
                console.error(`[WhatsApp] Reset failed:`, err.message);
                // Continue to polling, hoping it started
            }
        }

        // 3. Wait for Session Readiness (SCAN_QR)
        console.log(`[WhatsApp] Waiting for session '${sessionName}' to be ready...`);
        for (let i = 0; i < 10; i++) {
            const sessionInfo = await whatsappService.getSession(sessionName);
            if (sessionInfo && sessionInfo.status === 'SCAN_QR') {
                console.log(`[WhatsApp] Session '${sessionName}' is ready (SCAN_QR).`);
                break;
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        // 4. Request Code with Retry (Directly, instead of waiting for SCAN_QR status)
        let pairingCode = null;
        let attempts = 0;
        const maxAttempts = 15;

        while (!pairingCode && attempts < maxAttempts) {
            try {
                pairingCode = await whatsappService.getPairingCode(sessionName, formattedPhone);
                console.log(`[WhatsApp] Pairing Code Generated: ${pairingCode}`);
                break;
            } catch (e) {
                attempts++;
                console.log(`[WhatsApp] Pairing Code not ready yet (Attempt ${attempts}/${maxAttempts}). Waiting...`);
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        if (pairingCode) {
             res.json({ success: true, code: pairingCode });
        } else {
             throw new Error("Failed to generate Pairing Code. Please check if the session is running.");
        }
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
