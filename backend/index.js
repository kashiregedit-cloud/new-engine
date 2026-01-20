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

// Initialize OpenAI (OpenRouter)
const openai = new OpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
});

// System Prompt
const SYSTEM_PROMPT = `IMPORTANT:
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
- আপনি Automation Hub BD এর একজন স্টাফ, যিনি অটো কমেন্ট রিপ্লাই এবং অটো মেসেজ রিপ্লাই সার্ভিস সম্পর্কে বিস্তারিত জানাতে সাহায্য করেন বাংলায়।
- গ্রাহক চাইলে ডেলিভারি বা চার্জ সম্পর্কেও জানতে চাইতে পারেন, তবে সেটা এই সার্ভিসের জন্য প্রযোজ্য ❤️‍🩹
- তুমি প্রোডাক্টের ছবি থেকে দাম বলে দিতে পারো, প্রোডাক্টের ছবি পাঠাতে পারো।
- তুমি প্রোডাক্টের সব তথ্য দিতে পারবা যদি তোমায় তথ্য সেট করে দেওয়া হয়।
- তুমি অর্ডার তৈরি করতে পারো।
- তোমার সার্ভিসের অফিস দিনাজপুর জেলার ফুলবাড়ি উপজেলায়।
- তুমি কাস্টমারের মেসেজগুলোর তৎক্ষণাৎ উত্তর দিতে পারো Facebook Messenger বা অন্যান্য প্ল্যাটফর্মে।
- তোমার কাজ: পন্য প্রদর্শন, লিস্টিং আপডেট, নতুন পন্য বা অফার জানানো, অর্ডার কনফার্মেশন, শিপিং আপডেট পাঠানো ইত্যাদি।
- আমি ২৪/৭ আপনার ভার্চুয়াল সহকারী হিসেবে কাজ করি, যাতে আপনার ব্যবসা কখনো থেমে না যায়।
- তুমি অডিও ভয়েস বা ছবি শনাক্ত করতে পারো — যদি কেউ তোমার সম্পর্কে কিছু জানতে চায়, তুমি শুধুমাত্র ডেটা সার্ভারে থাকা তথ্যই দিতে পারবে।
- যদি সেই তথ্য না থাকে, সদয়ভাবে বলবে: “দুঃখিত, এই ধরনের তথ্য এডমিন আমাদের দেয়নি, তাই জানাতে পারলাম না।”
- তুমি গ্রাহকের সাথে দামা দামি করতে পারবা । ধরো তোমার সার্ভিসের দাম ১০০০ টাকা গ্রাহক যদি বলে "এতো দাম", "দাম বেশি" তবে তুমি 5% ডিসকাউন্ট দিতে পারবা
- কখনই বলবা না দাম ফিক্সড
- "ছবি একবার চাইলে আবার চাইলে আবার দিতে হইবে, যেবার চাইবে সেবার দিতে হইবে।"`;

// Debounce Map: userId -> { timeoutId, session }
const debounceMap = new Map();
const DEBOUNCE_TIME = 8000; // 8 seconds

// WAHA Configuration
const WAHA_BASE_URL = process.env.WAHA_BASE_URL || 'http://localhost:3000';
const WAHA_API_KEY = process.env.WAHA_API_KEY;

// Helper: Send Message via WAHA
async function sendWAHAMessage(chatId, text, session) {
  try {
    const url = `${WAHA_BASE_URL}/api/sendText`;
    const body = {
      chatId: chatId,
      text: text,
      session: session
    };

    console.log(`Sending to WAHA: ${url}`, body);

    const headers = {
      'Content-Type': 'application/json',
    };
    
    if (WAHA_API_KEY) {
      headers['X-Api-Key'] = WAHA_API_KEY;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`WAHA Error (${response.status}):`, errText);
    } else {
      console.log('Message sent successfully via WAHA');
    }
  } catch (error) {
    console.error('Error sending message via WAHA:', error);
  }
}

// Helper: Process the accumulated messages
async function processUserMessages(userId, senderId, pageId, session) {
  console.log(`Processing messages for user: ${userId}`);

  try {
    // 1. Fetch all pending messages for this user
    const { data: messages, error: fetchError } = await supabase
      .from('wp_chats')
      .select('*')
      .eq('sender_id', senderId)
      .eq('page_id', pageId)
      .eq('status', 'pending')
      .order('timestamp', { ascending: true });

    if (fetchError || !messages || messages.length === 0) {
      console.log('No pending messages found or error fetching.');
      return;
    }

    // 2. Merge messages
    const mergedText = messages.map(m => m.text).join(' ');
    console.log(`Merged Text: ${mergedText}`);

    // 3. Get Context (Optional: fetch last N done messages)
    // For simplicity, we skip fetching old context for now, but you can add it here.

    // 4. Call AI Agent
    const completion = await openai.chat.completions.create({
      model: 'xiaomi/mimo-v2-flash:free',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: mergedText }
      ],
    });

    const aiResponseRaw = completion.choices[0].message.content;
    console.log(`AI Response: ${aiResponseRaw}`);

    let aiResponse;
    try {
      aiResponse = JSON.parse(aiResponseRaw);
    } catch (e) {
      console.error('Failed to parse JSON from AI:', aiResponseRaw);
      // Fallback if AI doesn't return JSON
      aiResponse = { output: aiResponseRaw, admin_handover: false };
    }

    // 5. Send Response via WAHA
    if (aiResponse.output) {
      await sendWAHAMessage(senderId, aiResponse.output, session);
    }

    // 6. Mark messages as done
    const messageIds = messages.map(m => m.id);
    const { error: updateError } = await supabase
      .from('wp_chats')
      .update({ status: 'done' })
      .in('id', messageIds);

    if (updateError) console.error('Error updating status:', updateError);

  } catch (err) {
    console.error('Error in processing flow:', err);
  }
}

// Webhook Endpoint
app.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    
    // Log incoming payload for debugging
    console.log('Received Webhook:', JSON.stringify(payload, null, 2));

    // Extract basic info (Adapting to the n8n logic)
    // n8n: body.payload.from, body.payload.to, body.payload.body
    const body = payload.body || payload; // Handle wrapped or unwrapped
    const messageData = body.payload || body;
    const session = body.session || 'default'; // Capture session
    
    const senderId = messageData.from;
    const pageId = messageData.to; // or recipient
    const messageId = messageData.id;
    const timestamp = messageData.timestamp || Math.floor(Date.now() / 1000);
    const type = messageData._data ? messageData._data.type : 'chat';
    
    let text = '';
    if (type === 'chat') {
      text = messageData.body;
    } else if (type === 'ptt') {
      text = '[Audio Message]';
    } else if (type === 'image') {
      text = '[Image Message]';
    } else {
      text = '[Unknown Type]';
    }

    // 1. Check duplicates
    const { data: existing } = await supabase
      .from('wp_chats')
      .select('id')
      .eq('message_id', messageId)
      .single();

    if (existing) {
      console.log('Duplicate message, skipping:', messageId);
      return res.status(200).send({ status: 'skipped', reason: 'duplicate' });
    }

    // 2. Save to DB
    const { error: insertError } = await supabase
      .from('wp_chats')
      .insert({
        page_id: pageId,
        sender_id: senderId,
        recipient_id: pageId,
        timestamp: timestamp,
        message_id: messageId,
        text: text,
        status: 'pending'
      });

    if (insertError) {
      console.error('Error saving message:', insertError);
      return res.status(500).send({ error: 'Database error' });
    }

    // 3. Debounce
    const debounceKey = `${pageId}_${senderId}`;
    
    if (debounceMap.has(debounceKey)) {
      const { timeoutId } = debounceMap.get(debounceKey);
      clearTimeout(timeoutId);
    }

    const timeoutId = setTimeout(() => {
      debounceMap.delete(debounceKey);
      processUserMessages(debounceKey, senderId, pageId, session);
    }, DEBOUNCE_TIME);

    debounceMap.set(debounceKey, { timeoutId, session });

    res.status(200).send({ status: 'queued' });

  } catch (error) {
    console.error('Error in webhook:', error);
    res.status(500).send({ error: 'Internal Server Error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WhatsApp Engine running on port ${PORT}`);
});
