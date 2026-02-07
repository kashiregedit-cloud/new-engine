const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');
const whatsappService = require('../services/whatsappService');
const dbService = require('../services/dbService');

// WAHA Webhook Listener (POST)
// Endpoint: /whatsapp/webhook
router.post('/webhook', whatsappController.handleWebhook);

// Get Sessions (Merged with DB Info & Team Permissions)
router.get('/sessions', async (req, res) => {
    try {
        // 1. Auth Check
        const authHeader = req.headers.authorization;
        let userId = null;
        let userEmail = null;
        
        if (authHeader) {
            const token = authHeader.replace('Bearer ', '');
            const { data: { user }, error } = await dbService.supabase.auth.getUser(token);
            if (user) {
                userId = user.id;
                userEmail = user.email;
            }
        }

        if (!userId) {
            // Return empty if not authenticated (Security)
            return res.json([]);
        }

        // 2. Fetch User's Own Sessions (By ID or Email)
        const { data: mySessions, error: myError } = await dbService.supabase
            .from('whatsapp_message_database')
            .select('id, session_name, expires_at, plan_days, status, subscription_status, user_id, email')
            .or(`user_id.eq.${userId},email.eq.${userEmail}`);

        if (myError) throw myError;

        // 3. Fetch Shared Sessions (Team Members)
        let sharedSessionNames = [];
        if (userEmail) {
            const { data: teamData, error: teamError } = await dbService.supabase
                .from('team_members')
                .select('permissions')
                .eq('member_email', userEmail)
                .eq('status', 'active');
            
            if (!teamError && teamData) {
                teamData.forEach(row => {
                    if (row.permissions && Array.isArray(row.permissions.wa_sessions)) {
                        sharedSessionNames.push(...row.permissions.wa_sessions);
                    }
                });
            }
        }

        let sharedSessions = [];
        if (sharedSessionNames.length > 0) {
            const { data: sharedData, error: sharedError } = await dbService.supabase
                .from('whatsapp_message_database')
                .select('id, session_name, expires_at, plan_days, status, subscription_status, user_id, email')
                .in('session_name', sharedSessionNames);
            
            if (!sharedError && sharedData) {
                sharedSessions = sharedData;
            }
        }

        // 4. Combine DB Sessions
        // Deduplicate by ID
        const allDBSessions = [...(mySessions || []), ...sharedSessions];
        const uniqueDBSessions = Array.from(new Map(allDBSessions.map(item => [item.session_name, item])).values());

        // 5. Get WAHA Sessions (Real-time Status)
        let wahaSessions = [];
        try {
            wahaSessions = await whatsappService.getSessions(true);
        } catch (e) {
            console.warn("WAHA Sessions Fetch Failed:", e.message);
        }
        
        // 6. Merge and Format
        const finalSessions = uniqueDBSessions.map(ds => {
            const ws = wahaSessions.find(s => s.name === ds.session_name);
            return {
                name: ds.session_name,
                status: ws ? ws.status : (ds.status || 'STOPPED'), // Use WAHA status if available, else DB
                config: ws ? ws.config : {},
                me: ws ? ws.me : null,
                wp_db_id: ds.id,
                wp_id: ds.id,
                expires_at: ds.expires_at,
                plan_days: ds.plan_days,
                subscription_status: ds.subscription_status || 'unknown',
                db_status: ds.status || 'unknown',
                is_shared: ds.user_id !== userId // Flag if it's a shared session
            };
        });

        res.json(finalSessions);
    } catch (err) {
        console.error("Get Sessions Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Get Pairing Code
router.post('/session/pairing-code', async (req, res) => {
    try {
        const { sessionName, phoneNumber } = req.body;
        if (!sessionName || !phoneNumber) {
            return res.status(400).json({ error: "Missing sessionName or phoneNumber" });
        }
        
        console.log(`[WhatsApp] Requesting Pairing Code for ${sessionName} (Phone: ${phoneNumber})...`);
        const code = await whatsappService.getPairingCode(sessionName, phoneNumber);
        
        res.json({ success: true, code: code });
    } catch (err) {
        console.error("Get Pairing Code Error:", err);
        // Extract helpful error message if possible
        const msg = err.response?.data?.error || err.message;
        res.status(500).json({ error: msg });
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
            'WEBJS': { 2: 200, 30: 2000, 60: 3500, 90: 4000 },
            'NOWEB': { 2: 100, 30: 500, 60: 900, 90: 1500 }
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
        let detectedStatus = 'created'; // Default
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
                    detectedStatus = session.status; // Capture status
                    
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
        const dbEntry = await dbService.createWhatsAppEntry(finalName, user.id, duration, detectedStatus, user.email);
        
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
            wp_db_id: dbEntry.id, // Explicitly return wp_db_id for frontend consistency
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
        
        // 1. Stop (Best Effort)
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
        
        // 1. Try to Stop on WAHA (Best Effort)
        try {
            await whatsappService.stopSession(sessionName);
        } catch (wahaError) {
            console.warn(`[WhatsApp] WAHA Stop failed for '${sessionName}' (ignoring to update DB): ${wahaError.message}`);
        }
        
        // 2. Update DB status immediately (Force Update)
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
        
        console.log(`[WhatsApp] Deleting session '${target}'...`);

        // 1. Try Logout (Best Effort)
        try {
            await whatsappService.logoutSession(target);
            await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (e) { 
            console.warn(`[WhatsApp] Logout failed (ignoring): ${e.message}`);
        }

        // 2. Try Stop (Best Effort)
        try {
            await whatsappService.stopSession(target);
            await new Promise(resolve => setTimeout(resolve, 1000)); 
        } catch (stopErr) {
            console.warn(`[WhatsApp] Stop failed (ignoring): ${stopErr.message}`);
        }

        // 3. Try Delete from WAHA (Best Effort)
        try {
            await whatsappService.deleteSession(target);
        } catch (delErr) {
            console.warn(`[WhatsApp] WAHA Delete failed for '${target}' (might be already gone): ${delErr.message}`);
            // Do NOT throw here, proceed to DB delete
        }
        
        // 4. Always Delete from DB
        await dbService.deleteWhatsAppEntry(target);
        console.log(`[WhatsApp] DB Entry deleted for '${target}'.`);
        
        res.json({ success: true });
    } catch (err) {
        console.error("Delete Session Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Get Contacts (Only Locked Ones for Performance)
router.get('/contacts/:sessionName', async (req, res) => {
    try {
        const { sessionName } = req.params;
        const { data, error } = await dbService.supabase
            .from('whatsapp_contacts')
            .select('phone_number, is_locked')
            .eq('session_name', sessionName)
            .eq('is_locked', true);
            
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Toggle Lock Status (Handover)
router.post('/toggle-lock', async (req, res) => {
    try {
        const { sessionName, phoneNumber, isLocked } = req.body;
        
        if (!sessionName || !phoneNumber || typeof isLocked !== 'boolean') {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const success = await dbService.toggleWhatsAppLock(sessionName, phoneNumber, isLocked);
        
        if (success) {
            res.json({ success: true, isLocked });
        } else {
            res.status(500).json({ error: "Failed to update lock status" });
        }
    } catch (err) {
        console.error("Toggle Lock Error:", err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;