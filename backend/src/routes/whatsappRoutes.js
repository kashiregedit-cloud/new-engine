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
                browserName: "Chrome"
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
        const dbEntry = await dbService.createWhatsAppEntry(finalName, user.id);
        
        let qr = null;

        // ALWAYS fetch QR Code
        try {
            await new Promise(resolve => setTimeout(resolve, 2000));
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
            qr_code: qr
        });
        
    } catch (err) {
        console.error("Create Session Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Delete Session
router.delete('/session/delete', async (req, res) => {
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

module.exports = router;