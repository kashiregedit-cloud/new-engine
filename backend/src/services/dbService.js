const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 1. Get Page Config (Multi-Tenant Rule - Step 7)
async function getPageConfig(pageId) {
  const { data, error } = await supabase
    .from('page_access_token_message')
    .select('*')
    .eq('page_id', pageId)
    .single();

  if (error) {
    console.error(`Error fetching config for page ${pageId}:`, error);
    return null;
  }
  return data;
}

// 2. Get Knowledge Base / Prompts (Step 2 Context)
async function getPagePrompts(pageId) {
    // Join with fb_message_database
    const { data, error } = await supabase
        .from('fb_message_database')
        .select('*')
        .eq('page_id', pageId)
        .maybeSingle(); // Use maybeSingle to avoid error if not set yet

    if (error) {
        console.error(`Error fetching prompts for page ${pageId}:`, error);
        return null;
    }
    return data;
}

// 3. Save Lead / Chat History (Step 5)
async function saveLead(data) {
    // data: { page_id, sender_id, message, reply, sentiment, etc. }
    const { error } = await supabase
        .from('wp_chats') // Reusing existing table or fb_chats if preferred
        .insert({
            page_id: data.page_id,
            sender_id: data.sender_id,
            text: data.message,
            // You might want to add columns for 'reply', 'sentiment' to wp_chats or create fb_chats
            // For now, mapping to existing schema
            status: 'done',
            timestamp: new Date().toISOString()
        });

    if (error) console.error("Error saving lead:", error);
}

// 4. Debounce / Duplicate Check
async function checkDuplicate(messageId) {
    if (!messageId) return false;

    // Check if message_id exists in fb_chats (if unique constraint exists)
    // Or use wpp_debounce table if we want a generic debounce key
    // Let's use wpp_debounce for now with message_id as key
    
    const { data } = await supabase
        .from('wpp_debounce')
        .select('id')
        .eq('debounce_key', messageId)
        .maybeSingle();

    if (data) return true; // It's a duplicate

    // If not duplicate, insert it
    await supabase.from('wpp_debounce').insert({ debounce_key: messageId });
    return false;
}

// 5. Credit Deduction (Crucial for Business Model)
async function deductCredit(pageId, currentCredit) {
    if (currentCredit <= 0) return false;
    
    const newCredit = Number(currentCredit) - 1;
    const { error } = await supabase
        .from('page_access_token_message')
        .update({ message_credit: newCredit })
        .eq('page_id', pageId);
        
    if (error) {
        console.error(`Failed to deduct credit for ${pageId}:`, error);
        return false;
    }
    return true;
}

// 6. Get Chat History (Context Window)
async function getChatHistory(sessionId, limit = 10) {
    const { data, error } = await supabase
        .from('n8n_chat_histories')
        .select('message')
        .eq('session_id', sessionId)
        .order('id', { ascending: false }) // Get latest messages
        .limit(limit);

    if (error) {
        console.error("Error fetching chat history:", error);
        return [];
    }

    // Supabase returns newest first due to order by id desc, so reverse them to be chronological
    return data.map(row => row.message).reverse(); 
}

// 7. Save Chat Message
async function saveChatMessage(sessionId, role, content) {
    const { error } = await supabase
        .from('n8n_chat_histories')
        .insert({
            session_id: sessionId,
            message: { role, content }
        });

    if (error) {
        console.error("Error saving chat message:", error);
    }
}

module.exports = {
    supabase,
    getPageConfig,
    getPagePrompts,
    saveLead,
    checkDuplicate,
    deductCredit,
    getChatHistory,
    saveChatMessage
};
