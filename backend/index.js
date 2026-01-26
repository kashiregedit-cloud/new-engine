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
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
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

function generateRandomId() {
  return Math.floor(100000 + Math.random() * 900000); // 6 digit random number
}

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

// Send Message via Facebook
async function sendFacebookMessage(recipientId, text, pageAccessToken) {
  try {
    const url = `https://graph.facebook.com/v19.0/me/messages?access_token=${pageAccessToken}`;
    const body = {
      recipient: { id: recipientId },
      message: { text: text }
    };
    
    console.log(`Sending to Facebook (${recipientId}):`, text.substring(0, 50) + '...');
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();
    if (data.error) {
      console.error('Facebook Send Error:', data.error);
    }
  } catch (error) {
    console.error('Error sending message via Facebook:', error);
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

    // --- DETECT PLATFORM (Facebook vs WAHA) ---
    // Check if this pageId belongs to a Facebook Page in our DB
    const { data: fbPage } = await supabase
        .from('page_access_token_message')
        .select('*')
        .eq('page_id', pageId)
        .maybeSingle();

    let config = {};
    let isFacebook = false;

    if (fbPage) {
        // FACEBOOK CONFIG
        isFacebook = true;
        config = {
            provider: fbPage.ai || 'openrouter',
            apiKey: process.env.OPENROUTER_API_KEY, // Or custom if we supported it
            model: fbPage.chat_model || 'xiaomi/mimo-v2-flash:free',
            systemPrompt: fbPage.system_prompt || DEFAULT_SYSTEM_PROMPT,
            autoReply: true, // Assuming always true for active plans
            aiEnabled: true,
            mediaEnabled: true,
            // Plan Specifics
            messageCredit: fbPage.message_credit,
            subscriptionStatus: fbPage.subscription_status,
            pageAccessToken: fbPage.access_token,
            managedKey: fbPage.api_key // If not null, user provided their own key (unlikely for "Buy Plan" scenario)
        };
        
        // If user provided their own API Key (Managed Mode), use it
        if (config.managedKey) {
            // Logic to use user's key if we supported it in generateAIResponse
            // For now, generateAIResponse uses process.env or passed apiKey
            // We might need to pass it explicitly if we want to support "Use Own API" fully
        }

    } else {
        // WAHA CONFIG (Existing Logic)
        config = await getAIConfig(session);
        // Add userId to config for credit deduction (legacy)
        // ... (getAIConfig already returns what we need, but we need userId for credit update)
        // Re-fetching userId for legacy credit deduction if needed
        if (session) {
             const { data: sessionData } = await supabase.from('whatsapp_sessions').select('user_id').eq('session_name', session).maybeSingle();
             if (sessionData) config.userId = sessionData.user_id;
        }
        // Also fetch user_configs for credit balance
         if (config.userId) {
            const { data: uConf } = await supabase.from('user_configs').select('message_credit').eq('user_id', config.userId).maybeSingle();
            if (uConf) config.messageCredit = uConf.message_credit;
        }
    }

    // 2. Check Auto-Reply / Credit
    if (!config.autoReply) {
      console.log(`Auto-reply disabled for ${debounceKey}. Marking messages as ignored.`);
      await supabase.from('wp_chats').update({ status: 'ignored' }).in('id', messages.map(m => m.id));
      return;
    }

    // 3. Merge Content
    let mergedText = '';
    messages.forEach(m => {
      if (m.media_type === 'image') {
        mergedText += config.mediaEnabled ? ` [User sent an image] ` : ` [User sent an image (Ignored)] `;
      } else if (m.media_type === 'audio') {
        mergedText += config.mediaEnabled ? ` [User sent a voice message] ` : ` [User sent a voice message (Ignored)] `;
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

    // 4. Call AI Engine
    const userMessage = {
      text: mergedText,
      images: messages.filter(m => m.media_type === 'image' && m.media_url && config.mediaEnabled).map(m => m.media_url)
    };

    const aiResponse = await generateAIResponse(config, [], userMessage);

    // 5. Send Response & Deduct Credit
    if (aiResponse && aiResponse.output) {
      
      if (isFacebook) {
          // --- FACEBOOK SEND ---
          if (config.pageAccessToken) {
              await sendFacebookMessage(senderId, aiResponse.output, config.pageAccessToken);
              
              // Deduct Credit (Page-Based)
              // Ensure we are checking 'active' (case-insensitive just in case)
              const isActive = config.subscriptionStatus && config.subscriptionStatus.toLowerCase() === 'active';
              
              if (isActive && config.messageCredit > 0) {
                  const newCredit = Number(config.messageCredit) - 1; // Ensure number
                  console.log(`Deducting credit for Page ${pageId}. Old: ${config.messageCredit}, New: ${newCredit}`);

                  const updates = { message_credit: newCredit };
                  
                  // Auto-Unlock if exhausted
                  if (newCredit <= 0) {
                      console.log(`Page ${pageId} credit exhausted. Switching to inactive.`);
                      updates.subscription_status = 'inactive';
                      updates.api_key = null; // Unlock
                  }

                  const { error: updateError } = await supabase.from('page_access_token_message')
                    .update(updates)
                    .eq('page_id', pageId);
                  
                  if (updateError) {
                      console.error(`Failed to update credit for page ${pageId}:`, updateError);
                  } else {
                      console.log(`Credit updated successfully for page ${pageId}`);
                  }
              } else {
                  console.log(`Skipping credit deduction for Page ${pageId}. Status: ${config.subscriptionStatus}, Credit: ${config.messageCredit}`);
              }
          } else {
              console.error('Missing Page Access Token for Facebook reply');
          }

      } else {
          // --- WAHA SEND (Legacy) ---
          await sendWAHAMessage(senderId, aiResponse.output, session);

          // Decrement Message Credit (User-Based Legacy)
          if (config.userId && config.messageCredit > 0) {
            const newCredit = config.messageCredit - 1;
            const updates = { message_credit: newCredit };

            if (newCredit === 0) {
               console.log(`User ${config.userId} message credit exhausted. Resetting to default AI model.`);
               updates.model_name = 'xiaomi/mimo-v2-flash:free';
               updates.ai_provider = 'openrouter';
            }

            await supabase.from('user_configs')
              .update(updates)
              .eq('user_id', config.userId);
          }
      }
    }

    // 6. Mark done
    const messageIds = messages.map(m => m.id);
    await supabase.from('wp_chats').update({ status: 'done' }).in('id', messageIds);

  } catch (err) {
    console.error('Error in processing flow:', err);
  }
}

// --- Routes ---

app.post('/api/auth/facebook/exchange-token', async (req, res) => {
  const { shortLivedToken } = req.body;

  if (!shortLivedToken) {
    return res.status(400).json({ error: 'Short-lived token is required' });
  }

  if (!FACEBOOK_APP_ID || !FACEBOOK_APP_SECRET) {
    console.error('Facebook App ID or Secret not configured in backend');
    return res.status(500).json({ error: 'Server configuration error: Facebook credentials missing' });
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${FACEBOOK_APP_ID}&client_secret=${FACEBOOK_APP_SECRET}&fb_exchange_token=${shortLivedToken}`
    );

    const data = await response.json();

    if (data.error) {
      console.error('Error exchanging token:', data.error);
      return res.status(400).json({ error: data.error.message });
    }

    res.json({ access_token: data.access_token });
  } catch (error) {
    console.error('Server error exchanging token:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
  let { sessionName, userEmail, userId, planDays, engine } = req.body;
  
  if (!sessionName) return res.status(400).json({ error: 'sessionName is required' });

  // Default values
  const days = planDays ? parseInt(planDays) : 30;
  const selectedEngine = engine || 'NOWEB'; // Default to NOWEB (NOWAB) if not specified
  
  // Pricing Logic
  let price = 0;
  // Ensure selectedEngine is uppercase for consistency
  const engineCode = selectedEngine === 'WEBJS' ? 'WEBJS' : 'NOWEB';

  if (engineCode === 'WEBJS') {
      if (days === 2) price = 200; // New Demo Plan
      if (days === 30) price = 2000;
      if (days === 60) price = 3500;
      if (days === 90) price = 4000;
  } else {
      // NOWAB / NOWEB (Default)
      if (days === 2) price = 100; // New Demo Plan
      if (days === 30) price = 500;
      if (days === 60) price = 900;
      if (days === 90) price = 1500;
  }
  
  // Fallback if price is 0 (invalid days)
  if (price === 0) price = (engineCode === 'WEBJS') ? 2000 : 500;

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
  const SESSION_PRICE = price;
  let currentBalance = 0;
  
  if (userId) {
      // Check balance
      const { data: userConfig, error: configError } = await supabase
        .from('user_configs')
        .select('balance')
        .eq('user_id', userId)
        .maybeSingle();

      if (configError) {
          console.error('Balance check error:', configError);
          return res.status(500).json({ error: 'Failed to check balance' });
      }

      currentBalance = userConfig?.balance || 0;

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
      
      // Log Transaction (Pending/Completed)
      await supabase.from('payment_transactions').insert({
          user_email: userEmail,
          amount: SESSION_PRICE,
          method: 'plan_purchase',
          status: 'completed',
          trx_id: `PLAN-${days}D-${Date.now()}`,
          sender_number: 'System'
      });
      
      console.log(`Deducted ${SESSION_PRICE} BDT from user ${userId}. New Balance: ${currentBalance - SESSION_PRICE}`);
  }
  // ---------------------

  try {
    const url = `${WAHA_BASE_URL}/api/sessions`;
    const headers = { 'Content-Type': 'application/json' };
    if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;

    // Configure WAHA with specific config requested by user
    const isNoweb = engineCode !== 'WEBJS';
    
    const payload = {
      name: sessionName,
      start: true, // Auto-start session immediately
      config: {
        engine: engineCode, // Explicitly send engine to WAHA
        metadata: {
            "user_email": userEmail,
            "plan_days": String(days), // WAHA requires string values for metadata
            "engine": engineCode
        },
        debug: false,
        // Only include noweb config if engine is NOWEB
        ...(isNoweb ? {
            noweb: {
              markOnline: true,
              store: {
                enabled: true,
                fullSync: false
              }
            }
        } : {}),
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
          }
        ],
        client: {
          deviceName: "salesmanchatbot.online || wp : +880195687140.",
          browserName: isNoweb ? "IE" : "Chrome"
        }
      }
    };
    
    // Log the payload to debug engine selection
    console.log('Sending WAHA Payload:', JSON.stringify(payload, null, 2));

    // 1. Create Session (and Start due to start: true)
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await response.json();

    if (!response.ok) {
        console.error('WAHA Creation Failed:', data);
        
        // --- REFUND LOGIC ---
        if (userId) {
            console.log(`Refunding ${SESSION_PRICE} BDT to user ${userId} due to failure...`);
            await supabase
                .from('user_configs')
                .update({ balance: currentBalance }) // Restore original balance
                .eq('user_id', userId);
                
            await supabase.from('payment_transactions').insert({
                user_email: userEmail,
                amount: SESSION_PRICE,
                method: 'refund',
                status: 'completed',
                trx_id: `REFUND-${Date.now()}`,
                sender_number: 'System'
            });
        }
        // --------------------
        
        return res.status(response.status).json(data);
    }

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
    
    // Calculate Expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    let wpMessageId = null; // Defined in outer scope

    try {
        const payload = {
            session_id: finalSessionId, 
            session_name: sessionName,
            user_email: userEmail || null, // Explicitly set even if null
            user_id: userId || null,       // Explicitly set even if null
            status: 'created',
          qr_code: qrDataUri,
          updated_at: new Date().toISOString(),
          expires_at: expiresAt.toISOString(),
          plan_days: days
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

        // --- NEW: Insert or Update wp_message_database ---
        try {
            // Check if row exists for this session
            const { data: existingWp } = await scopedSupabase
                .from('wp_message_database')
                .select('id')
                .eq('session', sessionName)
                .maybeSingle();

            if (existingWp) {
                wpMessageId = existingWp.id;
                console.log(`Reactivating existing wp_message_database row for ${sessionName} (ID: ${existingWp.id})`);
                const { error: updateError } = await scopedSupabase
                    .from('wp_message_database')
                    .update({ verified: true })
                    .eq('id', existingWp.id);
                
                if (updateError) {
                    console.error('wp_message_database Reactivation Error:', updateError);
                    // Fallback
                    if (authHeader) {
                        await supabase.from('wp_message_database').update({ verified: true }).eq('id', existingWp.id);
                    }
                }
            } else {
                wpMessageId = generateRandomId();
                const wpPayload = {
                    id: wpMessageId,
                    session: sessionName,
                    reply_message: false,
                    swipe_reply: false,
                    image_detection: false,
                    image_send: false,
                    template: false,
                    order_tracking: false,
                    verified: true, // Auto-verified on creation
                    page_id: null,
                    text_prompt: null,
                    image_prompt: null,
                    template_prompt_x1: null,
                    template_prompt_x2: null,
                    api_key: null,
                    provider: null,
                    chatmodel: null
                };

                console.log('Inserting into wp_message_database:', wpPayload);
                const { error: wpError } = await scopedSupabase
                    .from('wp_message_database')
                    .insert(wpPayload);
                
                if (wpError) {
                    console.error('wp_message_database Insert Error:', wpError);
                    // Fallback to global client
                    if (authHeader) {
                       await supabase.from('wp_message_database').insert(wpPayload);
                    }
                }
            }
        } catch (wpErr) {
             console.error('wp_message_database logic error:', wpErr);
        }
        // --------------------------------------------

    } catch (dbErr) {
        console.error('DB Unexpected Error (Non-fatal):', dbErr);
    }

    // Return final response with QR and WP DB ID
    res.json({ 
        ...data, 
        qr_code: qrDataUri,
        wp_db_id: wpMessageId // Return the generated ID to frontend
    });

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
    const { data: wpSessions } = await supabase.from('wp_message_database').select('id, session');

    // Merge WAHA data with DB data
    const mergedSessions = wahaData.map(session => {
      const dbSession = dbSessions?.find(s => s.session_name === session.name);
      const wpSession = wpSessions?.find(s => s.session === session.name);
      return {
        ...session,
        qr_code: dbSession?.qr_code || null,
        user_email: dbSession?.user_email || null,
        user_id: dbSession?.user_id || null,
        wp_id: wpSession?.id || null
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
    // 1. Fetch Session Info from DB (to preserve config)
    const { data: sessionData, error: dbError } = await supabase
        .from('whatsapp_sessions')
        .select('*')
        .eq('session_name', sessionName)
        .single();
     
    if (dbError || !sessionData) {
         return res.status(404).json({ error: 'Session not found in database' });
    }

    const engineCode = sessionData.engine || 'WEBJS'; // Default to WEBJS for safety
    const planDays = sessionData.plan_days || 30;
    const userEmail = sessionData.user_email;

    console.log(`Hard Restarting session ${sessionName} (Engine: ${engineCode})...`);

    // 2. DELETE Session from WAHA (Hard Reset to fix "Could not connect")
    try {
        const deleteUrl = `${WAHA_BASE_URL}/api/sessions/${sessionName}`;
        const headers = { 'Content-Type': 'application/json' };
        if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;
        await fetch(deleteUrl, { method: 'DELETE', headers });
        console.log(`Deleted session ${sessionName} from WAHA for restart.`);
    } catch (e) {
        console.log(`Delete failed for ${sessionName} (might not exist):`, e);
    }

    // Wait 3s to ensure cleanup
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 3. RE-CREATE Session in WAHA
    const createUrl = `${WAHA_BASE_URL}/api/sessions`;
    const headers = { 'Content-Type': 'application/json' };
    if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;

    const isNoweb = engineCode !== 'WEBJS';
    const payload = {
      name: sessionName,
      start: true,
      config: {
        engine: engineCode,
        metadata: {
            "user_email": userEmail,
            "plan_days": String(planDays),
            "engine": engineCode
        },
        debug: false,
        ...(isNoweb ? {
            noweb: {
              markOnline: true,
              store: { enabled: true, fullSync: false }
            }
        } : {}),
        webhooks: [
          {
            url: `https://n8n.salesmanchatbot.online/webhook/webhook`,
            events: ['message', 'session.status'],
            retries: { delaySeconds: 2, attempts: 15, policy: "linear" },
            customHeaders: null
          }
        ],
        client: {
          deviceName: "salesmanchatbot.online || wp : +880195687140.",
          browserName: isNoweb ? "IE" : "Chrome"
        }
      }
    };

    const response = await fetch(createUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await response.json();
    
    if (!response.ok) {
         console.error('WAHA Restart/Create Failed:', data);
         return res.status(response.status).json(data);
    }

    await supabase.from('whatsapp_sessions').update({ status: 'WORKING' }).eq('session_name', sessionName);

    // 4. Trigger QR Fetch Loop
     (async () => {
         // Initial delay
         await new Promise(resolve => setTimeout(resolve, 3000));
 
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

app.delete('/session/delete', async (req, res) => {
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
    } else {
        console.log(`WAHA Session ${sessionName} deleted successfully (or not found).`);
    }

    const { error: dbError } = await supabase.from('whatsapp_sessions').delete().eq('session_name', sessionName);
    
    // Also delete from wp_message_database
    const { error: wpError } = await supabase.from('wp_message_database').delete().eq('session', sessionName);
    
    if (dbError) {
        console.error('DB Delete Error:', dbError);
        throw new Error('Failed to delete from database');
    }

    if (wpError) {
        console.error('WP DB Delete Error:', wpError);
        // We log but don't block success if main session is deleted
    }

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
    console.log('Webhook Payload:', JSON.stringify(payload, null, 2));

    // --- FACEBOOK HANDLER ---
    if (payload.object === 'page') {
      res.status(200).send('EVENT_RECEIVED'); // Immediate response required by FB

      for (const entry of payload.entry) {
        // Facebook can batch messages, but usually messaging array has 1 item
        const webhookEvent = entry.messaging ? entry.messaging[0] : null;
        
        if (webhookEvent && webhookEvent.message) {
           const senderId = webhookEvent.sender.id;
           const pageId = webhookEvent.recipient.id;
           const messageId = webhookEvent.message.mid;
           const timestamp = webhookEvent.timestamp || Date.now();
           const text = webhookEvent.message.text || '';
           
           // Media Handling (Basic)
           let type = 'text';
           let mediaUrl = null;
           if (webhookEvent.message.attachments) {
               const attachment = webhookEvent.message.attachments[0];
               if (attachment.type === 'image') type = 'image';
               else if (attachment.type === 'audio') type = 'audio';
               else type = 'unknown'; // fallback
               
               if (attachment.payload && attachment.payload.url) {
                   mediaUrl = attachment.payload.url;
               }
           }

           // Check Duplicates
           const { data: existing } = await supabase.from('wp_chats').select('id').eq('message_id', messageId).maybeSingle();
           if (existing) {
               console.log('Duplicate FB message:', messageId);
               continue;
           }

           // Save to DB
           await supabase.from('wp_chats').insert({
              page_id: pageId,
              sender_id: senderId,
              recipient_id: pageId,
              timestamp: Math.floor(timestamp / 1000), // FB sends ms
              message_id: messageId,
              text: text,
              media_type: type,
              media_url: mediaUrl,
              status: 'pending'
           });

           // Trigger Processing
           const debounceKey = `${pageId}_${senderId}`;
           await supabase.from('wpp_debounce').upsert({ debounce_key: debounceKey, last_message_at: new Date().toISOString() }, { onConflict: 'debounce_key' });
           
           setTimeout(() => {
               processUserMessages(debounceKey, senderId, pageId, null); // Session is null for FB
           }, DEBOUNCE_TIME);
        }
      }
      return;
    }

    // --- WAHA HANDLER (Legacy) ---
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

// --- Auto-Delete Expired Sessions ---
async function checkExpiredSessions() {
  console.log('Checking for expired sessions...');
  try {
    const now = new Date().toISOString();
    const { data: expiredSessions, error } = await supabase
      .from('whatsapp_sessions')
      .select('*')
      .lt('expires_at', now);

    if (error) {
      console.error('Error fetching expired sessions:', error);
      return;
    }

    if (!expiredSessions || expiredSessions.length === 0) {
      console.log('No expired sessions found.');
      return;
    }

    console.log(`Found ${expiredSessions.length} expired sessions. Deleting...`);

    for (const session of expiredSessions) {
      const sessionName = session.session_name;
      console.log(`Processing expired session: ${sessionName}`);

      // 0. Mark as Unverified in wp_message_database (Lock Logic)
      try {
        console.log(`Locking wp_message_database for ${sessionName}...`);
        await supabase
            .from('wp_message_database')
            .update({ verified: false })
            .eq('session', sessionName);
      } catch (lockErr) {
        console.error(`Failed to lock wp_message_database for ${sessionName}:`, lockErr);
      }

      // 1. Delete from WAHA
      try {
        const url = `${WAHA_BASE_URL}/api/sessions/${sessionName}`;
        const headers = { 'Content-Type': 'application/json' };
        if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;
        
        await fetch(url, { method: 'DELETE', headers });
      } catch (e) {
        console.error(`Failed to delete ${sessionName} from WAHA (might already be gone):`, e);
      }

      // 2. Delete from Supabase
      const { error: dbError } = await supabase
        .from('whatsapp_sessions')
        .delete()
        .eq('session_name', sessionName);
      
      if (dbError) console.error(`Failed to delete ${sessionName} from DB:`, dbError);
      else console.log(`Successfully deleted ${sessionName} from DB.`);
    }

    // --- Facebook Pages Expiry Check ---
    const { data: expiredPages, error: fbError } = await supabase
      .from('page_access_token_message')
      .select('*')
      .lt('expires_at', now)
      // .eq('subscription_status', 'active') // Check all expired, regardless of status if they have an expiry date
      ;

    if (fbError) {
        console.error('Error fetching expired FB pages:', fbError);
    } else if (expiredPages && expiredPages.length > 0) {
        console.log(`Found ${expiredPages.length} expired Facebook pages. Deleting...`);
        for (const page of expiredPages) {
            console.log(`Processing expired FB page: ${page.name || page.page_id} (${page.page_id})`);
            
            // Delete from DB (Disconnects integration)
            const { error: delError } = await supabase
                .from('page_access_token_message')
                .delete()
                .eq('page_id', page.page_id);
                
            if (delError) console.error(`Failed to delete FB page ${page.page_id}:`, delError);
            else console.log(`Successfully deleted FB page ${page.page_id}`);
        }
    }

    // --- Facebook Credits Check (Auto Unlock) ---
    // Unlocks own key if credits are exhausted
    const { data: exhaustedPages, error: creditError } = await supabase
      .from('page_access_token_message')
      .select('*')
      .lte('message_credit', 0)
      .not('api_key', 'is', null) // Only if api_key is set (Managed Key)
      .eq('subscription_status', 'active');

    if (creditError) {
        console.error('Error fetching exhausted FB pages:', creditError);
    } else if (exhaustedPages && exhaustedPages.length > 0) {
        console.log(`Found ${exhaustedPages.length} exhausted Facebook pages. Unlocking own key...`);
        for (const page of exhaustedPages) {
            console.log(`Unlocking own key for page: ${page.name || page.page_id}`);
            
            const { error: updateError } = await supabase
                .from('page_access_token_message')
                .update({
                    api_key: null, // Unlock own key
                    subscription_status: 'inactive', // Mark as inactive/expired
                    ai: 'openrouter', // Default provider
                    chat_model: 'xiaomi/mimo-v2-flash:free' // Default model
                })
                .eq('page_id', page.page_id);

            if (updateError) console.error(`Failed to unlock page ${page.page_id}:`, updateError);
            else console.log(`Successfully unlocked page ${page.page_id}`);
        }
    }

  } catch (err) {
    console.error('Auto-Delete Loop Error:', err);
  }
}

// Run check every 1 hour (3600000 ms)
setInterval(checkExpiredSessions, 3600000);
// Run once on startup
checkExpiredSessions();

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Production Engine running on port ${PORT} (v1.2)`);
});
