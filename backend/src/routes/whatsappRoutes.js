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
        // Frontend sends 'engine' and 'planDays' but WAHA needs 'config' object
        // We construct a basic config here if not provided
        const wahaConfig = config || {
            engine: engine || "WEBJS", 
            // Add default webhooks if needed, pointing to OUR backend
            webhooks: [
                {
                    url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/whatsapp/webhook`,
                    events: ["message", "message.any", "state.change"]
                }
            ]
        };

        // 1. Create Session in WAHA
        await whatsappService.createSession({ name: finalName, config: wahaConfig });
        
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
        await whatsappService.deleteSession(target);
        res.json({ success: true });
    } catch (err) {
        console.error("Delete Session Error:", err);
        res.status(500).json({ error: err.message });
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
