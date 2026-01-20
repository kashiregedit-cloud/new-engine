require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const OpenAI = require('openai');

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
- আপনি Automation Hub BD এর একজন স্টাফ... (Rest of the prompt)
- তুমি প্রোডাক্টের ছবি বা অডিও ভয়েস বুঝতে পারো।
- যদি ছবি দেওয়া হয়, সেটা বিশ্লেষণ করে উত্তর দাও।
`;

// --- Helpers ---

// Get AI Configuration from DB or Env
async function getAIConfig() {
  try {
    const { data } = await supabase.from('user_configs').select('*').limit(1).single();
    if (data && data.api_key) {
      return {
        provider: data.ai_provider || 'openrouter',
        apiKey: data.api_key,
        model: data.model_name || 'xiaomi/mimo-v2-flash:free',
        systemPrompt: data.system_prompt || DEFAULT_SYSTEM_PROMPT
      };
    }
  } catch (e) {
    // Ignore error, fallback to env
  }
  return {
    provider: 'openrouter',
    apiKey: process.env.OPENROUTER_API_KEY,
    model: 'xiaomi/mimo-v2-flash:free',
    systemPrompt: DEFAULT_SYSTEM_PROMPT
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

    // 2. Merge Content
    let mergedText = '';
    let hasImage = false;
    let hasAudio = false;

    messages.forEach(m => {
      if (m.media_type === 'image') {
        mergedText += ` [User sent an image] `;
        hasImage = true;
      } else if (m.media_type === 'audio') {
        mergedText += ` [User sent a voice message] `;
        hasAudio = true;
      } else {
        mergedText += ` ${m.text} `;
      }
    });

    console.log(`Merged Context: ${mergedText}`);

    // 3. Get AI Config & Init Client
    const config = await getAIConfig();
    const openai = new OpenAI({
      baseURL: config.provider === 'openai' ? undefined : 'https://openrouter.ai/api/v1',
      apiKey: config.apiKey,
    });

    // 4. Call AI
    let completion;
    try {
      const messagesPayload = [
        { role: 'system', content: config.systemPrompt },
        { role: 'user', content: mergedText.trim() }
      ];

      // TODO: If hasImage, we could attach image URL if the model supports it.
      // For now, we rely on text description placeholders.

      completion = await openai.chat.completions.create({
        model: config.model,
        messages: messagesPayload,
      });
    } catch (aiError) {
      console.error('AI API Error:', aiError);
      return;
    }

    const aiResponseRaw = completion.choices[0].message.content;
    let aiResponse;
    try {
      aiResponse = JSON.parse(aiResponseRaw);
    } catch (e) {
      aiResponse = { output: aiResponseRaw, admin_handover: false };
    }

    // 5. Send Response
    if (aiResponse.output) {
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
  const { sessionName } = req.body;
  if (!sessionName) return res.status(400).json({ error: 'sessionName is required' });

  try {
    const url = `${WAHA_BASE_URL}/api/sessions`;
    const headers = { 'Content-Type': 'application/json' };
    if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;

    // Configure WAHA with OUR Webhook URL
    const payload = {
      name: sessionName,
      config: {
        webhooks: [
          {
            url: `${BACKEND_URL}/webhook`, // Auto-configure webhook
            events: ['message', 'session.status'],
            retries: { delaySeconds: 2, attempts: 15 }
          }
        ]
      }
    };

    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    const data = await response.json();

    if (!response.ok) return res.status(response.status).json(data);

    // Save to DB
    await supabase.from('whatsapp_sessions').insert({
      session_id: data.id, // WAHA usually returns { id, name, ... }
      session_name: sessionName,
      status: 'created'
    });

    res.json(data);
  } catch (error) {
    console.error('Create Session Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/session/qr/:sessionName', async (req, res) => {
  const { sessionName } = req.params;
  try {
    const url = `${WAHA_BASE_URL}/api/sessions/${sessionName}/auth/qr?format=image`;
    const headers = {};
    if (WAHA_API_KEY) headers['X-Api-Key'] = WAHA_API_KEY;

    const response = await fetch(url, { headers });
    if (!response.ok) return res.status(response.status).send(await response.text());

    // Pipe image back
    const buffer = await response.arrayBuffer();
    res.set('Content-Type', 'image/png');
    res.send(Buffer.from(buffer));
  } catch (error) {
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
       // For now, we assume text description.
       const rawType = messageData._data ? messageData._data.type : 'unknown';
       if (rawType === 'ptt' || rawType === 'audio') type = 'audio';
       else if (rawType === 'image') type = 'image';
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
