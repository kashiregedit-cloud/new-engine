require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const { generateAIResponse } = require('./utils/aiEngine');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Configuration
const WAHA_BASE_URL = process.env.WAHA_BASE_URL || 'http://localhost:3000';
const WAHA_API_KEY = process.env.WAHA_API_KEY;
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
const DEBOUNCE_TIME = 2000; // 2 seconds

// Default System Prompt (Fallback)
const DEFAULT_SYSTEM_PROMPT = `IMPORTANT:
You MUST respond ONLY in valid JSON.
Do NOT use markdown.
Do NOT use emojis.
Do NOT write explanations.
Return ONLY the JSON object that matches the schema.
Your response MUST look exactly like this example:

{
  "output": "string",
  "admin_handover": false
}

About You :
- আপনি Automation Hub BD এর একজন স্টাফ...
- তুমি প্রোডাক্টের ছবি বা অডিও ভয়েস বুঝতে পারো।
- যদি ছবি দেওয়া হয়, সেটা বিশ্লেষণ করে উত্তর দাও।
`;

// --- Helpers ---

// Get AI Configuration from DB or Env
async function getAIConfig(sessionName) {
  let userId = null;

  try {
    if (sessionName) {
      const { data: sessionData } = await supabase
        .from('whatsapp_sessions')
        .select('user_id')
        .eq('session_name', sessionName)
        .maybeSingle();
      
      if (sessionData) {
        userId = sessionData.user_id;
      }
    }

    let query = supabase.from('user_configs').select('*');
    if (userId) {
      query = query.eq('user_id', userId);
    } else {
      query = query.limit(1);
    }

    const { data } = await query.maybeSingle();

    if (data) {
      return {
        provider: data.ai_provider || 'openrouter',
        apiKey: data.api_key || process.env.OPENROUTER_API_KEY,
        model: data.model_name || 'xiaomi/mimo-v2-flash:free',
        systemPrompt: data.system_prompt || DEFAULT_SYSTEM_PROMPT,
        autoReply: data.auto_reply ?? true,
        aiEnabled: data.ai_enabled ?? true,
        mediaEnabled: data.media_enabled ?? true
      };
    }
  } catch (e) {
    console.error("Error fetching AI Config:", e);
    // Ignore error, fallback to env
  }
  return {
    provider: 'openrouter',
    apiKey: process.env.OPENROUTER_API_KEY,
    model: 'xiaomi/mimo-v2-flash:free',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    autoReply: true,
    aiEnabled: true,
    mediaEnabled: true
  };
}

// Send Message via WAHA
async function sendWAHAMessage(chatId, text, session) {
  try {
    const url = `${WAHA_BASE_URL}/api/sendText`;
    const body = { chatId, text, session };
    const headers = { 'Content-Type': 'application/json' };
    if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;
    
    console.log(`Sending to WAHA (${session}):`, text.substring(0, 50) + '...');
    
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) console.error(`WAHA Error (${response.status}):`, await response.text());
  } catch (error) {
    console.error('Error sending message via WAHA:', error);
  }
}

// Process Messages (Core Engine)
async function processUserMessages(debounceKey, senderId, pageId, session) {
  console.log(`Processing messages for: ${debounceKey}`);
  
  try {
    // 1. Fetch pending messages
    const { data: messages, error: fetchError } = await supabase
      .from('wp_chats')
      .select('*')
      .eq('sender_id', senderId)
      .eq('page_id', pageId)
      .eq('status', 'pending')
      .order('timestamp', { ascending: true });

    if (fetchError || !messages || messages.length === 0) return;

    // 2. Get AI Config early to check flags
    const config = await getAIConfig(session);

    if (!config.autoReply) {
      console.log(`Auto-reply disabled for ${debounceKey}. Marking messages as ignored.`);
      await supabase.from('wp_chats').update({ status: 'ignored' }).in('id', messages.map(m => m.id));
      return;
    }

    // 3. Merge Content
    let mergedText = '';
    
    messages.forEach(m => {
      if (m.media_type === 'image') {
        if (config.mediaEnabled) {
          mergedText += ` [User sent an image] `;
        } else {
          mergedText += ` [User sent an image (Ignored)] `;
        }
      } else if (m.media_type === 'audio') {
        if (config.mediaEnabled) {
          mergedText += ` [User sent a voice message] `;
        } else {
          mergedText += ` [User sent a voice message (Ignored)] `;
        }
      } else {
        mergedText += ` ${m.text} `;
      }
    });

    console.log(`Merged Context: ${mergedText}`);

    if (!config.aiEnabled) {
      console.log(`AI disabled. Marking done.`);
      await supabase.from('wp_chats').update({ status: 'done' }).in('id', messages.map(m => m.id));
      return;
    }

    // 4. Call AI Engine (Platform Agnostic)
    // Construct User Message Object
    const userMessage = {
      text: mergedText,
      images: messages
        .filter(m => m.media_type === 'image' && m.media_url && config.mediaEnabled)
        .map(m => m.media_url)
    };

    const aiResponse = await generateAIResponse(config, [], userMessage);

    // 5. Send Response
    if (aiResponse && aiResponse.output) {
      await sendWAHAMessage(senderId, aiResponse.output, session);
    }

    // 6. Mark done
    const messageIds = messages.map(m => m.id);
    await supabase.from('wp_chats').update({ status: 'done' }).in('id', messageIds);

  } catch (err) {
    console.error('Error in processing flow:', err);
  }
}

// --- Routes ---

app.get('/session/qr/:sessionName', async (req, res) => {
  const { sessionName } = req.params;
  try {
    const url = `${WAHA_BASE_URL}/api/${sessionName}/auth/qr?format=image`;
    const headers = {};
    if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;

    const response = await fetch(url, { headers });
    if (!response.ok) return res.status(response.status).send('QR not found');

    const buffer = await response.arrayBuffer();
    const bufferData = Buffer.from(buffer);
    
    res.setHeader('Content-Type', 'image/png');
    res.send(bufferData);
  } catch (error) {
    console.error('Error fetching QR:', error);
    res.status(500).send('Error fetching QR');
  }
});

// 1. Session Management API (Automatic Setup)
app.post('/session/create', async (req, res) => {
  console.log('Received /session/create request body:', req.body); // LOG REQUEST BODY
  let { sessionName, userEmail, userId } = req.body;
  
  if (!sessionName) return res.status(400).json({ error: 'sessionName is required' });

  // Create a scoped Supabase client if authorization header is provided
  // Use ANON KEY for scoped client to respect RLS policies
  const authHeader = req.headers.authorization;
  const scopedSupabase = authHeader 
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY, { 
        global: { headers: { Authorization: authHeader } } 
      })
    : supabase;

  // Attempt to recover missing user info from Token
  if (!userEmail && authHeader) {
      const token = authHeader.replace('Bearer ', '');
      
      // Method 1: Try Supabase getUser()
      try {
          console.log('Attempting to recover User Info from Token via Supabase...');
          const { data: { user }, error: userError } = await scopedSupabase.auth.getUser();
          if (user && !userError) {
              console.log('Recovered User from Token (Supabase):', user.email);
              userEmail = user.email;
              if (!userId) userId = user.id;
          } else {
              console.warn('Supabase getUser() failed:', userError);
          }
      } catch (e) {
          console.error('Token recovery error (Supabase):', e);
      }

      // Method 2: Fallback to manual JWT decoding if still missing
      if (!userEmail) {
          try {
              console.log('Attempting to recover User Info via Manual JWT Decode...');
              const payloadPart = token.split('.')[1];
              if (payloadPart) {
                  const decodedBuffer = Buffer.from(payloadPart, 'base64');
                  const decodedString = decodedBuffer.toString('utf-8');
                  const decoded = JSON.parse(decodedString);
                  
                  if (decoded.email) {
                      console.log('Recovered User from Token (Manual Decode):', decoded.email);
                      userEmail = decoded.email;
                      if (!userId) userId = decoded.sub; // 'sub' is usually the user ID in Supabase JWT
                  }
              }
          } catch (e) {
              console.error('Token recovery error (Manual Decode):', e);
          }
      }
  }

  // RELAXED CHECK: Only fail if email is missing. UID is optional if missing.
  if (!userEmail) {
      console.error('CRITICAL: User Email missing even after recovery attempt. Aborting session creation.');
      return res.status(401).json({ error: 'User email not found. Please login again.' });
  }
  
  if (!userId) {
      console.warn('Warning: userId missing. Proceeding with email only as per user request.');
  }

  // --- PRICING LOGIC ---
  const SESSION_PRICE = 500;
  
  if (userId) {
      // Check balance
      const { data: userConfig, error: configError } = await supabase
        .from('user_configs')
        .select('balance')
        .eq('user_id', userId)
        .maybeSingle();

      if (configError) {
          console.error('Balance check error:', configError);
          // Optional: Fail safe or strict? Let's be strict for payments.
          return res.status(500).json({ error: 'Failed to check balance' });
      }

      const currentBalance = userConfig?.balance || 0;

      if (currentBalance < SESSION_PRICE) {
          return res.status(402).json({ 
              error: `Insufficient balance. Required: ${SESSION_PRICE} BDT, Available: ${currentBalance} BDT` 
          });
      }

      // Deduct balance
      const { error: deductionError } = await supabase
        .from('user_configs')
        .update({ balance: currentBalance - SESSION_PRICE })
        .eq('user_id', userId);

      if (deductionError) {
          console.error('Balance deduction error:', deductionError);
          return res.status(500).json({ error: 'Failed to process payment' });
      }
      
      console.log(`Deducted ${SESSION_PRICE} BDT from user ${userId}. New Balance: ${currentBalance - SESSION_PRICE}`);
  } else {
      console.warn('Skipping payment check for unknown user (email-only auth).');
  }
  // ---------------------

  try {
    const url = `${WAHA_BASE_URL}/api/sessions`;
    const headers = { 'Content-Type': 'application/json' };
    if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;

    // Configure WAHA with specific config requested by user
    const payload = {
      name: sessionName,
      start: true, // Auto-start session immediately
      config: {
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
            url: `https://n8n.salesmanchatbot.online/webhook/webhook`,
            events: ['message', 'session.status'],
            retries: {
              delaySeconds: 2,
              attempts: 15,
              policy: "linear"
            },
            customHeaders: null
          },
          {
            url: `http://ak4kcgcog0880g4owgwcss8c.72.62.196.104.sslip.io/webhook`,
            events: ['message', 'session.status'],
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
      }
    };

    // 1. Create Session (and Start due to start: true)
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await response.json();

    if (!response.ok) return res.status(response.status).json(data);

    // 1.5. Ensure Session is Started (Fix for STOPPED status)
    if (data.status === 'STOPPED') {
        console.log(`Session ${sessionName} created but STOPPED. Attempting explicit start...`);
        try {
            await fetch(`${WAHA_BASE_URL}/api/sessions/${sessionName}/start`, { method: 'POST', headers });
        } catch (startErr) {
            console.error('Error starting session:', startErr);
        }
    }

    // Initialize qrDataUri
    let qrDataUri = null;

    // 3. Fetch QR Code (Blocking Retry Logic - n8n style)
        // Wait for QR before inserting into DB or responding
        for (let i = 0; i < 20; i++) { // Increased to 20 attempts
            try {
                console.log(`Fetching QR for ${sessionName} (Attempt ${i + 1})...`);
                // Wait 2s before each attempt
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Corrected URL: Removed /sessions/ as per testing
                // WAHA returns image/png even if format=json is requested, so we must handle binary
                const qrUrl = `${WAHA_BASE_URL}/api/${encodeURIComponent(sessionName)}/auth/qr?format=image`;
                const qrResponse = await fetch(qrUrl, { headers });
                
                if (qrResponse.ok) {
                    const buffer = await qrResponse.arrayBuffer();
                    if (buffer.byteLength > 0) {
                        const base64 = Buffer.from(buffer).toString('base64');
                        qrDataUri = `data:image/png;base64,${base64}`;
                        console.log(`QR fetched for ${sessionName} (Size: ${buffer.byteLength})`);
                        break; 
                    }
                } else {
                     console.log(`QR not ready yet for ${sessionName} (${qrResponse.status})...`);
                }
            } catch (e) {
                console.error(`Retry failed for ${sessionName}:`, e);
            }
        }

    // 2. Save to DB (Create User/Session Row)
    // Now we insert EVERYTHING at once (session + qr)
    const finalSessionId = data.id || sessionName;

    try {
        const payload = {
            session_id: finalSessionId, 
            session_name: sessionName,
            user_email: userEmail || null, // Explicitly set even if null
            user_id: userId || null,       // Explicitly set even if null
            status: 'created',
          qr_code: qrDataUri,
          updated_at: new Date().toISOString()
      };
        console.log('Upserting to DB:', payload);

        const { error: upsertError } = await scopedSupabase
            .from('whatsapp_sessions')
            .upsert(payload, { onConflict: 'session_name' });

        if (upsertError) {
            console.error('DB Upsert Error (Non-fatal):', upsertError);
            // Try fallback to global client if scoped failed (e.g. invalid token)
             if (authHeader) {
                 console.log('Retrying with global client...');
                 await supabase.from('whatsapp_sessions').upsert(payload, { onConflict: 'session_name' });
             }
        }
    } catch (dbErr) {
        console.error('DB Unexpected Error (Non-fatal):', dbErr);
    }

    // Return final response with QR (or null if timed out)
    res.json({ ...data, qr_code: qrDataUri });

  } catch (error) {
    console.error('Create Session Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/sessions', async (req, res) => {
  try {
    const url = `${WAHA_BASE_URL}/api/sessions?all=true`;
    const headers = {};
    if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;

    const response = await fetch(url, { headers });
    const wahaData = await response.json();
    if (!response.ok) return res.status(response.status).json(wahaData);

    // Fetch from Supabase to merge additional info (QR, plan, etc)
    const { data: dbSessions } = await supabase.from('whatsapp_sessions').select('*');

    // Merge WAHA data with DB data
    const mergedSessions = wahaData.map(session => {
      const dbSession = dbSessions?.find(s => s.session_name === session.name);
      return {
        ...session,
        qr_code: dbSession?.qr_code || null,
        user_email: dbSession?.user_email || null,
        user_id: dbSession?.user_id || null
      };
    });

    res.json(mergedSessions);
  } catch (error) {
    console.error('Fetch Sessions Error:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

app.post('/session/start', async (req, res) => {
  const { sessionName } = req.body;
  try {
    const url = `${WAHA_BASE_URL}/api/sessions/${sessionName}/start`;
    const headers = { 'Content-Type': 'application/json' };
    if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;

    const response = await fetch(url, { method: 'POST', headers });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    
    await supabase.from('whatsapp_sessions').update({ status: 'WORKING' }).eq('session_name', sessionName);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to start session' });
  }
});

app.post('/session/stop', async (req, res) => {
  const { sessionName } = req.body;
  try {
    const url = `${WAHA_BASE_URL}/api/sessions/${sessionName}/stop`;
    const headers = { 'Content-Type': 'application/json' };
    if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;

    const response = await fetch(url, { method: 'POST', headers });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);

    await supabase.from('whatsapp_sessions').update({ status: 'STOPPED' }).eq('session_name', sessionName);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop session' });
  }
});

app.post('/session/restart', async (req, res) => {
  const { sessionName } = req.body;
  try {
    // 1. Stop Session
    try {
        const stopUrl = `${WAHA_BASE_URL}/api/sessions/${sessionName}/stop`;
        const headers = { 'Content-Type': 'application/json' };
        if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;
        await fetch(stopUrl, { method: 'POST', headers });
    } catch (e) {
        console.log(`Stop failed for ${sessionName} (might be already stopped):`, e);
    }

    // Wait 5s to ensure full stop
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 2. Start Session
    const startUrl = `${WAHA_BASE_URL}/api/sessions/${sessionName}/start`;
    const headers = { 'Content-Type': 'application/json' };
    if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;
    
    const response = await fetch(startUrl, { method: 'POST', headers });
    const data = await response.json();
    
    if (!response.ok) return res.status(response.status).json(data);

    await supabase.from('whatsapp_sessions').update({ status: 'WORKING' }).eq('session_name', sessionName);

    // 3. Trigger QR Fetch Loop
     (async () => {
         // Initial delay
         await new Promise(resolve => setTimeout(resolve, 5000));
 
         for (let i = 0; i < 20; i++) {
             try {
                 console.log(`Fetching QR for ${sessionName} (Restart Attempt ${i + 1})...`);
                 
                 const qrUrl = `${WAHA_BASE_URL}/api/${sessionName}/auth/qr?format=image`;
                 const qrResponse = await fetch(qrUrl, { headers });
                 
                 if (qrResponse.ok) {
                     const contentType = qrResponse.headers.get('content-type');
                     let newQrUri = null;
 
                     if (contentType && contentType.includes('application/json')) {
                         const json = await qrResponse.json();
                         if (json.data) newQrUri = `data:image/png;base64,${json.data}`;
                         else if (json.qr) newQrUri = json.qr;
                     } else {
                         const buffer = await qrResponse.arrayBuffer();
                         if (buffer.byteLength > 0) {
                             const base64 = Buffer.from(buffer).toString('base64');
                             newQrUri = `data:image/png;base64,${base64}`;
                         }
                     }
 
                     if (newQrUri) {
                        await supabase
                            .from('whatsapp_sessions')
                            .update({ qr_code: newQrUri, updated_at: new Date().toISOString() })
                            .eq('session_name', sessionName);
                        
                        console.log(`QR fetched and saved for ${sessionName} (Restart)`);
                        break;
                    }
                 }
             } catch (e) {
                 console.error(`Retry failed for ${sessionName}:`, e);
             }
             await new Promise(resolve => setTimeout(resolve, 2000));
         }
     })();

    res.json({ message: "Session restarting. QR code will update shortly." });
  } catch (error) {
    console.error('Restart Session Error:', error);
    res.status(500).json({ error: 'Failed to restart session' });
  }
});

app.post('/session/delete', async (req, res) => {
  const { sessionName } = req.body;
  try {
    const url = `${WAHA_BASE_URL}/api/sessions/${sessionName}`;
    const headers = { 'Content-Type': 'application/json' };
    if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;

    const response = await fetch(url, { method: 'DELETE', headers });
    
    // Attempt to parse WAHA response
    let wahaData = {};
    try {
        const text = await response.text();
        wahaData = text ? JSON.parse(text) : {};
    } catch (e) {
        console.warn('Failed to parse WAHA delete response:', e);
    }

    // Log WAHA error but PROCEED to delete from DB so user isn't stuck
    if (!response.ok && response.status !== 404) {
        console.error(`WAHA Delete Failed (${response.status}):`, wahaData);
        // We continue to DB delete...
    }

    await supabase.from('whatsapp_sessions').delete().eq('session_name', sessionName);
    
    res.json({ success: true, message: "Session deleted from DB (and WAHA if available)" });
  } catch (error) {
    console.error('Delete Session Error:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

app.get('/session/qr/:sessionName', async (req, res) => {
    const { sessionName } = req.params;
    try {
        // 1. Try fetching from Supabase first (Fastest)
        const { data: dbSession } = await supabase
            .from('whatsapp_sessions')
            .select('qr_code')
            .eq('session_name', sessionName)
            .maybeSingle();

        if (dbSession?.qr_code) {
             const matches = dbSession.qr_code.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
             if (matches && matches.length === 3) {
                 const type = matches[1];
                 const buffer = Buffer.from(matches[2], 'base64');
                 res.set('Content-Type', type);
                 return res.send(buffer);
             }
        }

        // 2. If not in DB, try WAHA directly (Slow but fresh)
    const url = `${WAHA_BASE_URL}/api/${sessionName}/auth/qr?format=image`;
    const headers = {};
    if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;

    const response = await fetch(url, { headers });
    
    // Fallback: If WAHA fails, check DB
    if (!response.ok) {
        console.log(`WAHA QR Fetch failed (${response.status}) using path /api/${sessionName}/auth/qr, checking DB...`);
        const { data: dbSession } = await supabase
            .from('whatsapp_sessions')
            .select('qr_code')
            .eq('session_name', sessionName)
            .maybeSingle();

        if (dbSession && dbSession.qr_code) {
             const matches = dbSession.qr_code.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
             if (matches && matches.length === 3) {
                 const type = matches[1];
                 const buffer = Buffer.from(matches[2], 'base64');
                 res.set('Content-Type', type);
                 return res.send(buffer);
             }
        }
        return res.status(response.status).send(await response.text());
    }

    // Pipe image back
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const dataUri = `data:image/png;base64,${base64}`;

    // Save to Supabase
    await supabase
      .from('whatsapp_sessions')
      .update({ qr_code: dataUri, updated_at: new Date().toISOString() })
      .eq('session_name', sessionName);

    res.set('Content-Type', 'image/png');
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('QR Fetch Error:', error);
    res.status(500).send('Error fetching QR');
  }
});

// 2. Webhook Endpoint
app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    // Adapt to WAHA structure
    const body = payload.payload || payload;
    
    // Ignore status updates, only care about messages
    if (payload.event !== 'message') {
        return res.status(200).send('Ignored event');
    }

    const session = payload.session || 'default';
    const messageData = body;
    
    // 0. Ignore self-messages
    if (messageData.fromMe) return res.status(200).send({ status: 'skipped' });

    const senderId = messageData.from;
    const pageId = messageData.to; // This is usually the bot's number
    const messageId = messageData.id;
    const timestamp = messageData.timestamp || Math.floor(Date.now() / 1000);
    
    // Type Detection
    let type = 'text';
    let text = messageData.body || '';
    
    // Check for Media
    if (messageData.hasMedia) {
       // WAHA 2024+ might send mediaUrl or we need to download.
       // We try to find the URL in the payload
       const rawType = messageData._data ? messageData._data.type : (messageData.type || 'unknown');
       if (rawType === 'ptt' || rawType === 'audio') type = 'audio';
       else if (rawType === 'image') type = 'image';

       // Try to get Media URL
       // Note: WAHA might provide it in 'mediaUrl' or 'body' if it's a link
       if (messageData.mediaUrl) {
         // Direct URL provided by WAHA (if configured to download)
         // We store this in the 'media_url' column
          // @ts-ignore
         // We will add media_url to the insert below
       }
    }

    // 1. Check duplicates
    const { data: existing } = await supabase.from('wp_chats').select('id').eq('message_id', messageId).single();
    if (existing) return res.status(200).send({ status: 'duplicate' });

    // 2. Save to DB
    await supabase.from('wp_chats').insert({
      page_id: pageId,
      sender_id: senderId,
      recipient_id: pageId,
      timestamp: timestamp,
      message_id: messageId,
      text: text,
      media_type: type,
      media_url: messageData.mediaUrl || null, // Capture Media URL
      status: 'pending'
    });

    // 3. Database-Backed Debounce (Production Grade)
    const debounceKey = `${pageId}_${senderId}`;
    const now = new Date().toISOString();
    
    // Update last_message_at
    await supabase.from('wpp_debounce').upsert({ 
      debounce_key: debounceKey, 
      last_message_at: now 
    }, { onConflict: 'debounce_key' });

    // Schedule check
    setTimeout(async () => {
      const { data } = await supabase.from('wpp_debounce').select('last_message_at').eq('debounce_key', debounceKey).single();
      if (!data) return;

      const dbTime = new Date(data.last_message_at).getTime();
      const checkTime = new Date(now).getTime();

      // If DB has a newer time than our 'now', it means another message came after us.
      if (dbTime > checkTime) {
        console.log(`Skipping processing for ${debounceKey} (newer message detected)`);
        return;
      }

      await processUserMessages(debounceKey, senderId, pageId, session);
    }, DEBOUNCE_TIME);

    res.status(200).send({ status: 'queued' });

  } catch (error) {
    console.error('Webhook Error:', error);
    res.status(500).send({ error: 'Internal Server Error' });
  }
});

app.get('/stats/total-sessions', async (req, res) => {
  try {
    const { count, error } = await supabase
      .from('whatsapp_sessions')
      .select('*', { count: 'exact', head: true });
    
    if (error) throw error;
    res.json({ count: count || 0 });
  } catch (error) {
    console.error('Stats Error:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Production Engine running on port ${PORT}`);
});
