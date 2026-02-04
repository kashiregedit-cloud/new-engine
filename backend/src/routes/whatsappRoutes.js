const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');
const whatsappService = require('../services/whatsappService');
const dbService = require('../services/dbService');

// WAHA Webhook Listener (POST)
// Endpoint: /whatsapp/webhook
router.post('/webhook', whatsappController.handleWebhook);

// Get Sessions (Merged with DB Info)
router.get('/sessions', async (req, res) => {
    try {
        // 1. Get WAHA Sessions
        const wahaSessions = await whatsappService.getSessions(true);
        
        // 2. Get DB Sessions (for expiry info)
        const { data: dbSessions, error } = await dbService.supabase
            .from('whatsapp_message_database')
            .select('session_name, expires_at, plan_days, status, subscription_status');

        if (error) throw error;

        // 3. Merge
        const mergedSessions = wahaSessions.map(ws => {
            const dbSession = dbSessions.find(ds => ds.session_name === ws.name);
            return {
                ...ws,
                expires_at: dbSession?.expires_at || null,
                plan_days: dbSession?.plan_days || null,
                subscription_status: dbSession?.subscription_status || 'unknown',
                db_status: dbSession?.status || 'unknown'
            };
        });

        // Also include sessions that are in DB but NOT in WAHA (e.g. stopped/expired)
        // dbSessions.forEach(ds => {
        //     if (!wahaSessions.find(ws => ws.name === ds.session_name)) {
        //         mergedSessions.push({
        //             name: ds.session_name,
        //             status: 'STOPPED', // Assume stopped if not in WAHA
        //             expires_at: ds.expires_at,
        //             // ...
        //         });
        //     }
        // });
        // For now, let's stick to WAHA sessions as the source of truth for "active" sessions list, 
        // but frontend might need to know about expired ones too. 
        // User wants to see "expired" sessions? Maybe. 
        // Let's just return merged list of WAHA sessions for now to avoid duplicates/confusion.

        res.json(mergedSessions);
    } catch (err) {
        console.error("Get Sessions Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Create Session
router.post('/session/create', async (req, res) => {
    try {
        const { name, sessionName, config, engine, planDays } = req.body;
        const finalName = (sessionName || name || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
        const duration = planDays ? parseInt(planDays) : 30; // Default 30 days
        const selectedEngine = engine || 'WEBJS'; // Default WEBJS if not sent

        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error } = await dbService.supabase.auth.getUser(token);
        
        if (error || !user) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        // Pricing Logic
        const PRICING = {
            'WEBJS': { 1: 50, 2: 200, 30: 2000, 60: 3500, 90: 4000 },
            'NOWEB': { 1: 20, 2: 100, 30: 500, 60: 900, 90: 1500 }
        };
        
        // Fallback pricing if engine/duration not found
        const enginePricing = PRICING[selectedEngine] || PRICING['WEBJS'];
        const cost = enginePricing[duration] || (duration * 10); // Fallback safe default 

        // Deduct Balance
        try {
            await dbService.deductUserBalance(user.id, cost, `Create WhatsApp Session '${finalName}' (${duration} days, ${selectedEngine})`);
        } catch (paymentError) {
            return res.status(402).json({ error: `Insufficient Balance. Required: ${cost} BDT.` });
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
                deviceName: "salesmanchatbot.online || wp : +8801956871403.",
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
        const dbEntry = await dbService.createWhatsAppEntry(finalName, user.id, duration);
        
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

// Restart Session
router.post('/session/restart', async (req, res) => {
    try {
        const { sessionName } = req.body;
        console.log(`[WhatsApp] Restarting session '${sessionName}'...`);
        
        // 1. Stop
        try {
            await whatsappService.stopSession(sessionName);
        } catch (e) {
            console.warn(`[WhatsApp] Stop failed during restart (might be stopped): ${e.message}`);
        }
        
        await new Promise(r => setTimeout(r, 3000)); // Wait for full stop
        
        // 2. Start
        await whatsappService.startSession(sessionName);
        
        res.json({ success: true });
    } catch (err) {
        console.error("Restart Session Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Stop Session
router.post('/session/stop', async (req, res) => {
    try {
        const { sessionName } = req.body;
        console.log(`[WhatsApp] Stopping session '${sessionName}'...`);
        
        await whatsappService.stopSession(sessionName);
        
        // Update DB status immediately
        await dbService.updateWhatsAppEntryByName(sessionName, { 
            status: 'STOPPED', 
            active: false 
        });

        res.json({ success: true });
    } catch (err) {
        console.error("Stop Session Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Renew Session
router.post('/session/renew', async (req, res) => {
    try {
        const { sessionName, days } = req.body;
        if (!sessionName || !days) return res.status(400).json({ error: "Missing sessionName or days" });

        // Pricing Logic (Configurable)
        const PLAN_COSTS = {
            1: 10,   // 1 Day = 10 Credits/Balance
            30: 200, // 30 Days = 200 Credits/Balance
            60: 350,
            90: 500
        };

        const cost = PLAN_COSTS[days] || (days * 10); // Fallback to 10 per day

        // 1. Get Session Owner
        const { data: session, error: fetchError } = await dbService.supabase
            .from('whatsapp_message_database')
            .select('user_id')
            .eq('session_name', sessionName)
            .single();

        if (fetchError || !session) return res.status(404).json({ error: "Session not found" });

        // 2. Deduct Balance
        try {
            await dbService.deductUserBalance(session.user_id, cost, `Renew Session ${sessionName} for ${days} days`);
        } catch (paymentError) {
            return res.status(402).json({ error: `Payment Failed: ${paymentError.message}` });
        }
        
        // 3. Renew
        const result = await dbService.renewWhatsAppSession(sessionName, parseInt(days));
        res.json({ success: true, data: result, cost_deducted: cost });
    } catch (err) {
        console.error("Renew Session Error:", err);
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