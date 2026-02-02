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

// 5. Credit Deduction (Centralized User Balance)
async function deductCredit(pageId, currentCredit) {
    // 1. Try Centralized Deduction (RPC) - Supports Multi-Page per User
    const { data: success, error: rpcError } = await supabase
        .rpc('deduct_credits_via_page', { p_page_id: pageId });

    if (!rpcError) {
        // If RPC executed successfully, it returns true (deducted) or false (insufficient funds)
        return success; 
    }

    // console.warn(`[dbService] RPC deduct_credits_via_page failed (${rpcError.message}). Falling back to legacy logic.`);

    // 2. Fallback to Legacy Page-Specific Credit (If RPC not setup)
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
    // User Feedback: "Full message na asle AI bujbe na". Reverting truncation.
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

    // --- DUPLICATE CHECK LOGIC (Production Level) ---
    // User Strategy: "Check 24 hours window for same pending order"
    // Goal: Prevent duplicate orders for same item if already pending.
    
    // 1. Find ANY recent order for this user (last 24 hours)
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: recentOrders, error: checkError } = await supabase
        .from('fb_order_tracking')
        .select('*')
        .eq('number', number) // Identify by User (Phone/ID)
        .gte('created_at', twentyFourHoursAgo)
        .order('id', { ascending: false });

    if (checkError) console.error("[Order] Error checking duplicates:", checkError.message);
    
    let existingOrder = null;

    if (recentOrders && recentOrders.length > 0) {
        // 2. Fuzzy Match Product Name
        // Simple normalization: lowercase, remove spaces/special chars
        const normalize = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const currentProd = normalize(product_name);
        
        // Find if any recent order matches this product
        existingOrder = recentOrders.find(o => {
            // Check Product Name Match
            const existingProd = normalize(o.product_name);
            // Check Similarity (Exact contains)
            const isMatch = existingProd.includes(currentProd) || currentProd.includes(existingProd);
            // Check Status (Only update if PENDING)
            // Assuming default status is 'pending' or null. If 'shipped'/'completed', allow new order.
            const isPending = !o.status || o.status === 'pending' || o.status === 'new';
            
            return isMatch && isPending;
        });
    }

    if (existingOrder) {
        console.log(`[Order] Found existing PENDING order (ID: ${existingOrder.id}) for "${product_name}". Updating...`);
        
        // UPSERT LOGIC: Update the existing order with new details
        // Only update fields if they are provided (not null) and different
        const updatePayload = {};
        
        if (location && location !== existingOrder.location) updatePayload.location = location;
        if (product_quantity && product_quantity !== existingOrder.product_quantity) updatePayload.product_quantity = product_quantity;
        if (price && price !== existingOrder.price) updatePayload.price = price;
        // if (product_name) updatePayload.product_name = product_name; // Keep original name or update? Maybe keep original to avoid confusion.
        
        if (Object.keys(updatePayload).length > 0) {
            const { error: updateError } = await supabase
                .from('fb_order_tracking')
                .update(updatePayload)
                .eq('id', existingOrder.id);
                
            if (updateError) console.error(`[Order] Failed to update order ${existingOrder.id}:`, updateError.message);
            else console.log(`[Order] Successfully updated order ${existingOrder.id} with new info.`);
        } else {
            console.log(`[Order] No new info to update for order ${existingOrder.id}. Skipping.`);
        }
        
        return null; // Stop here, don't create new order
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

// 13. Check Conversation Lock Status (Failure Lock)
async function checkLockStatus(pageId, senderId) {
    try {
        // Fetch last 4 bot replies
        const { data, error } = await supabase
            .from('fb_chats')
            .select('status, timestamp')
            .eq('page_id', pageId)
            .eq('recipient_id', senderId)
            .eq('reply_by', 'bot')
            .order('timestamp', { ascending: false })
            .limit(4);

        if (error || !data || data.length < 4) return false;

        // Check if all 4 are 'ai_ignored' (Silent Failures)
        const allIgnored = data.every(msg => msg.status === 'ai_ignored');
        if (!allIgnored) return false;

        // Check if within 24 hours
        // timestamp is stored as BigInt (Date.now())
        const lastIgnoredTime = Number(data[0].timestamp); 
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        
        if (Date.now() - lastIgnoredTime < ONE_DAY_MS) {
            return true;
        }
        
        return false;
    } catch (e) {
        console.error("Lock Check Error:", e);
        return false;
    }
}

// 14. Get All Active Page IDs (Cache Warmup)
async function getAllActivePages() {
    // Used for Gatekeeper / Allowed List cache
    // Strategy: Page must be Active/Trial AND have Message Credits (Page-level or User-level)
    const { data: pages, error } = await supabase
        .from('page_access_token_message')
        .select('page_id, user_id, message_credit')
        .or('subscription_status.eq.active,subscription_status.eq.trial');
        
    if (error) {
        console.error("Error fetching active pages:", error);
        return [];
    }

    // 2. Fetch Centralized User Credits (if user_id exists)
    const userIds = [...new Set(pages.map(p => p.user_id).filter(Boolean))];
    let userCredits = {};

    if (userIds.length > 0) {
        const { data: configs } = await supabase
            .from('user_configs')
            .select('user_id, message_credit')
            .in('user_id', userIds);
            
        if (configs) {
            configs.forEach(c => {
                userCredits[c.user_id] = c.message_credit || 0;
            });
        }
    }

    // 3. Filter: Must have Credit > 0
    const allowedPageIds = pages.filter(p => {
        const pageCredit = Number(p.message_credit || 0);
        const userCredit = Number(userCredits[p.user_id] || 0);

        // Allow if EITHER has credit > 0
        // (This covers both Legacy Page Credits and Centralized User Credits)
        return pageCredit > 0 || userCredit > 0;
    }).map(p => p.page_id);

    return allowedPageIds;
}

// 15. Mark Page Token as Invalid
async function markPageTokenInvalid(pageId) {
    console.warn(`[DB] Marking token as INVALID for page ${pageId}`);
    const { error } = await supabase
        .from('page_access_token_message')
        .update({ subscription_status: 'invalid_token' })
        .eq('page_id', pageId);
        
    if (error) console.error(`Error marking page ${pageId} invalid:`, error);
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
    saveOrderTracking,
    checkLockStatus,
    getAllActivePages,
    markPageTokenInvalid
};
