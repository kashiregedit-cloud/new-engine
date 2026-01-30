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
            timestamp: Date.now() // Changed to bigint compatible timestamp
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
        .from('backend_chat_histories')
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
    console.log(`[DB] Saving chat for ${sessionId}: [${role}] ${content.substring(0, 50)}...`);
    const { error } = await supabase
        .from('backend_chat_histories')
        .insert({
            session_id: sessionId,
            message: { role, content }
        });

    if (error) {
        console.error("Error saving chat message:", error);
    }
}

// --- n8n Workflow Specific Tables ---

// 8. Save to fb_chats (n8n compatible)
async function saveFbChat(data) {
    // data: { page_id, sender_id, recipient_id, message_id, text, timestamp, status, reply_by }
    const { error } = await supabase
        .from('fb_chats')
        .upsert(data, { onConflict: 'message_id' });

    if (error) {
        console.error("Error saving to fb_chats:", error);
    }
}

// 9. Get Old Messages from fb_chats
async function getFbChatHistory(pageId, senderId, limit = 5) {
    const { data, error } = await supabase
        .from('fb_chats')
        .select('*')
        .eq('page_id', pageId)
        .or(`sender_id.eq.${senderId},recipient_id.eq.${senderId}`)
        .order('timestamp', { ascending: false })
        .limit(limit);

    if (error) {
        console.error("Error getting fb_chats history:", error);
        return [];
    }
    return data.reverse(); // Return chronological order
}

// 10. n8n Debounce (fb_n8n_debounce)
async function checkN8nDebounce(key) {
    // Increment 'incr' for the key
    // This is a simplified version of n8n's debounce logic which might use a stored procedure or transaction
    // Here we just check if key exists or update timestamp
    // Ideally we use Redis, but for Postgres/Supabase:
    
    // First, try to insert
    const { error } = await supabase
        .from('fb_n8n_debounce')
        .upsert({ key: key, incr: 1 }, { onConflict: 'key' })
        .select();

    // If we wanted to count increments, we'd need a different approach, 
    // but for simple debounce (existence check), this might be enough.
    // However, n8n usually waits. 
    // My webhookController already handles in-memory debounce.
    // I will expose this function for compatibility.
    return !error;
}

async function getMessageById(messageId) {
    if (!messageId) return null;
    
    // Prioritize fb_chats as per user instruction
    const { data: fbData } = await supabase
        .from('fb_chats')
        .select('text')
        .eq('message_id', messageId)
        .maybeSingle();
        
    return fbData ? fbData.text : null;
}

module.exports = {
    supabase,
    getPageConfig,
    getPagePrompts,
    saveLead,
    checkDuplicate,
    deductCredit,
    getChatHistory,
    saveChatMessage,
    saveFbChat,
    getFbChatHistory,
    checkN8nDebounce,
    saveFbComment,
    logMessage,
    getMessageById
};

// 11. Save Comment (n8n compatible)
async function saveFbComment(data) {
    const { error } = await supabase
        .from('fb_comments')
        .upsert(data, { onConflict: 'comment_id' });
    
    if (error) {
        console.error("Error saving comment:", error);
    }
}

async function logMessage(msgData) {
    const { page_id, sender_id, recipient_id, message_id, text, reply_to, image, timestamp, status, reply_by } = msgData;

    try {
        const { error } = await supabase
            .from('backend_chat_histories') // Using the new table
            .insert([
                {
                    page_id,
                    sender_id,
                    recipient_id,
                    message_id,
                    text,
                    reply_to: reply_to || null, // Ensure null if undefined
                    image,
                    timestamp,
                    status,
                    reply_by: reply_by || 'user' // Default to user if not specified (bot replies will override)
                }
            ]);

        if (error) {
            console.error('[DB] Error logging message:', error.message);
        } else {
            // console.log(`[DB] Message logged: ${message_id}`);
        }
    } catch (err) {
        console.error('[DB] Unexpected error logging message:', err);
    }
}

// 12. Save Order Tracking
async function saveOrderTracking(orderData) {
    const { page_id, sender_id, product_name, number, location, product_quantity, price } = orderData;
    
    console.log(`[Order] Attempting to save order for ${sender_id}...`);

    // --- DUPLICATE CHECK LOGIC (Updated for Robustness) ---
    // User Strategy: "time set na kore customer er privious 20-30 ta conversion check korba"
    // We check the LAST order from this user. If it's the SAME product/qty/price, we treat it as the same order session.
    // We only Insert if it's a DIFFERENT order or adds new critical info (like address/phone) that wasn't there?
    // Actually, simply checking if the last order matches the current one is safest to prevent "bar bar save".
    
    const { data: lastOrder, error: checkError } = await supabase
        .from('fb_order_tracking')
        .select('*')
        .eq('number', number) // Filter by user phone/id
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
        
    if (checkError) {
        console.error("[Order] Error checking duplicates:", checkError.message);
    }
    
    if (lastOrder) {
        // Compare Logic
        const isSameProduct = lastOrder.product_name === product_name;
        // const isSameQty = lastOrder.product_quantity === product_quantity; // Qty might change, that's an update
        
        // If it's the same product and saved recently (e.g. within 12 hours), we assume it's the same conversation
        const timeDiff = Date.now() - new Date(lastOrder.created_at).getTime();
        const twelveHours = 12 * 60 * 60 * 1000;
        
        if (isSameProduct && timeDiff < twelveHours) {
             // Check if we are gaining new info?
             // If old location was null and new one is present, maybe we should UPDATE or INSERT?
             // User provided INSERT only. Let's skip to avoid "bar bar save" unless it's clearly different.
             // If location is same or new is null, definitely skip.
             
             if (lastOrder.location === location || !location) {
                 console.log(`[Order] Duplicate/Redundant order detected (ID: ${lastOrder.id}). Skipping.`);
                 return null;
             }
             
             // If location is new, we might want to save the improved version.
             // Let's allow insert if location was missing before but present now.
             if (lastOrder.location && location && lastOrder.location !== location) {
                 // Location CHANGED? Might be a correction. Allow save.
             } else if (!lastOrder.location && location) {
                 // New Location added. Allow save.
             } else {
                 console.log(`[Order] Duplicate order detected (ID: ${lastOrder.id}). Skipping.`);
                 return null;
             }
        }
    }
    // -----------------------------

    const { data, error } = await supabase
        .from('fb_order_tracking')
        .insert([{
            page_id,
            product_name,
            number, // Using sender_id or extracted phone number
            location,
            product_quantity,
            price
            // created_at is default now()
        }])
        .select();

    if (error) {
        console.error("[Order] Failed to save order:", error.message);
        return null;
    }
    
    console.log(`[Order] Order saved successfully: ID ${data[0].id}`);
    return data[0];
}

module.exports = {
    supabase,
    getPageConfig,
    getPagePrompts,
    saveLead,
    checkDuplicate,
    deductCredit,
    getChatHistory,
    saveChatMessage,
    saveFbChat,
    getFbChatHistory,
    checkN8nDebounce,
    saveFbComment,
    logMessage,
    getMessageById,
    saveOrderTracking
};
