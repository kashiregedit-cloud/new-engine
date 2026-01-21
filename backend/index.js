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

// 1. Session Management API (Automatic Setup)
app.post('/session/create', async (req, res) => {
  const { sessionName, userEmail, userId } = req.body;
  if (!sessionName) return res.status(400).json({ error: 'sessionName is required' });

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
            url: `${BACKEND_URL}/webhook`,
            events: ['message', 'session.status'],
            retries: {
              delaySeconds: 2,
              attempts: 15,
              policy: "linear"
            }
          }
        ],
        client: {
          deviceName: "salesmanchatbot.online || wp : +8801310148077",
          browserName: "IE"
        }
      }
    };

    // 1. Create Session (and Start due to start: true)
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await response.json();

    if (!response.ok) return res.status(response.status).json(data);

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
                const qrUrl = `${WAHA_BASE_URL}/api/${encodeURIComponent(sessionName)}/auth/qr?format=json`;
                const qrResponse = await fetch(qrUrl, { headers });
                
                if (qrResponse.ok) {
                    const json = await qrResponse.json();
                    // Handle various JSON formats
                    if (json.qr) {
                        qrDataUri = json.qr;
                    } else if (json.data) {
                        // n8n style or other wrapper
                         qrDataUri = json.data.startsWith('data:') ? json.data : `data:image/png;base64,${json.data}`;
                    }

                    if (qrDataUri) {
                        console.log(`QR fetched for ${sessionName}`);
                        break; // Stop retrying once found
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

    const { error: upsertError } = await supabase
        .from('whatsapp_sessions')
        .upsert({
            session_id: finalSessionId, 
            session_name: sessionName,
            ...(userEmail ? { user_email: userEmail } : {}),
            ...(userId ? { user_id: userId } : {}),
            status: 'created',
            qr_code: qrDataUri, // Will be populated if found, else null
            plan_days: req.body.plan || 30,
            updated_at: new Date().toISOString()
        }, { onConflict: 'session_name' });

    if (qrDataUri) {
        // Also insert into session_qr_link
        await supabase.from('session_qr_link').insert({
           qr_link: qrDataUri,
           session_name: sessionName,
           session_used: false
        });
    }

    if (upsertError) {
        console.error('DB Upsert Error:', upsertError);
        return res.status(500).json({ error: 'Failed to save session to database' });
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
        plan_days: dbSession?.plan_days || null,
        user_email: dbSession?.user_email || null
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

    // Wait 2s
    await new Promise(resolve => setTimeout(resolve, 2000));

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
                         
                         await supabase.from('session_qr_link').insert({
                            qr_link: newQrUri,
                            session_name: sessionName,
                            session_used: false
                         });
 
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
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);

    await supabase.from('whatsapp_sessions').delete().eq('session_name', sessionName);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

app.get('/session/qr/:sessionName', async (req, res) => {
  const { sessionName } = req.params;
  try {
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Production Engine running on port ${PORT}`);
});
