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

  // --- SHARED CREDIT LOGIC ---
  // If the page is linked to a user account, use the User's credit balance.
  // This ensures all pages under one account share the same credit pool.
  if (data.user_id) {
      const { data: userData } = await supabase
          .from('user_configs')
          .select('message_credit')
          .eq('user_id', data.user_id)
          .single();
      
      if (userData) {
          // Priority: Shared Credit ONLY
          // User instruction: "page er nijesso credit bolte kisu takbe na"
          data.message_credit = userData.message_credit || 0;
          data.credit_source = 'shared_user_balance';
      }
  }
  
  if (!data.credit_source) {
      data.credit_source = 'page_balance';
  }
  // ---------------------------

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
    // This RPC also logs the transaction to payment_transactions table for visibility
    const { data: success, error: rpcError } = await supabase
        .rpc('deduct_credits_via_page', { p_page_id: pageId });

    if (!rpcError) {
        // If RPC executed successfully, it returns true (deducted) or false (insufficient funds)
        if (!success) {
            console.warn(`[Credit] RPC deduction returned false (Insufficient funds) for Page ${pageId}`);
        }
        return success; 
    }

    console.warn(`[dbService] RPC deduct_credits_via_page failed (${rpcError.message}). Falling back to legacy logic.`);

    // 2. Manual User Credit Deduction (Node.js Fallback if RPC missing)
    try {
        const { data: pageData } = await supabase
            .from('page_access_token_message')
            .select('user_id, email') // Added email for transaction logging
            .eq('page_id', pageId)
            .single();

        if (pageData && pageData.user_id) {
            const { data: userConfig } = await supabase
                .from('user_configs')
                .select('message_credit')
                .eq('user_id', pageData.user_id)
                .single();

            // Prioritize User Credit
            if (userConfig && userConfig.message_credit > 0) {
                const { error: updateError } = await supabase
                    .from('user_configs')
                    .update({ message_credit: userConfig.message_credit - 1 })
                    .eq('user_id', pageData.user_id);
                
                if (!updateError) {
                    console.log(`[Credit] Deducted 1 credit from User ${pageData.user_id}`);
                    
                    // Log Transaction for History Visibility
                    if (pageData.email) {
                        await supabase.from('payment_transactions').insert({
                           user_email: pageData.email,
                           amount: 1,
                           method: 'balance_deduction',
                           trx_id: `DED_${Date.now()}`,
                           sender_number: 'SYSTEM',
                           status: 'completed'
                       });
                   }

                    return true;
                } else {
                    console.error(`[Credit] Update failed: ${updateError.message}`);
                }
            } else {
                console.warn(`[Credit] Insufficient credits for User ${pageData.user_id}. Balance: ${userConfig?.message_credit}`);
            }
        } else {
            console.warn(`[Credit] Page ${pageId} not linked to any user.`);
        }
    } catch (err) {
        console.error("Error in manual user credit deduction:", err);
    }

    // 3. Fallback to Legacy Page-Specific Credit
    // REMOVED STRICTLY as per user instruction: "page er nijesso credit bolte kisu takbe na"
    // Credits must come ONLY from user_configs (Shared Pool).
    console.warn(`[Credit] Page ${pageId} has no shared credits (User ${pageData?.user_id}). Legacy page credit is DISABLED.`);
    
    return false;
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
        
    if (fbData && fbData.text) return fbData.text;

    // WhatsApp fallback: check whatsapp_chats for quoted/replied media messages
    const { data: waData } = await supabase
        .from('whatsapp_chats')
        .select('text')
        .eq('message_id', messageId)
        .maybeSingle();

    return waData ? waData.text : null;
}

// 12. Create WhatsApp Entry (whatsapp_message_database)
async function createWhatsAppEntry(sessionName, userId, planDays = 30, initialStatus = 'connected', userEmail = null) {
    // Check if it already exists
    const { data: existing } = await supabase
        .from('whatsapp_message_database')
        .select('*')
        .eq('session_name', sessionName)
        .maybeSingle();

    if (existing) return existing;

    // Calculate Expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + parseInt(planDays));

    const { data, error } = await supabase
        .from('whatsapp_message_database')
        .insert({
            session_name: sessionName,
            user_id: userId,
            email: userEmail,              // Save Email for Team Sharing
            active: true,
            status: initialStatus,         // Use detected status
            reply_message: true,           // Auto-enable bot
            order_tracking: true,          // Auto-enable order tracking
            subscription_status: 'active', // Auto-activate subscription
            text_prompt: "You are a helpful assistant for this store. Reply in a friendly manner.", // Default prompt
            expires_at: expiresAt.toISOString(),
            plan_days: parseInt(planDays)
        })
        .select()
        .single();

    if (error) {
        console.error("Error creating WhatsApp DB entry:", error);
        throw error;
    }
    return data;
}

// --- WhatsApp Specific Functions ---

// 13. Get WhatsApp Config & Prompts
async function getWhatsAppConfig(sessionName) {
    const { data, error } = await supabase
        .from('whatsapp_message_database')
        .select('*')
        .eq('session_name', sessionName)
        .maybeSingle();

    if (error) {
        console.error(`Error fetching config for session ${sessionName}:`, error);
        return null;
    }

    if (!data) return null;

    // Credit Logic (Shared with User)
    if (data.user_id) {
        const { data: userData } = await supabase
            .from('user_configs')
            .select('message_credit')
            .eq('user_id', data.user_id)
            .single();
        
        if (userData) {
            data.message_credit = userData.message_credit;
        }
    }
    
    // Default credit if fetch failed (should handle gracefully)
    if (data.message_credit === undefined) data.message_credit = 0;

    // --- Label Actions ---
    const { data: labelActions, error: labelError } = await supabase
        .from('label_actions')
        .select('label_name, ai_action')
        .eq('page_id', sessionName);

    if (labelActions) {
        data.label_actions = labelActions;
    }

    return data;
}

// 14. Save WhatsApp Chat
async function saveWhatsAppChat(data) {
    // data: { session_name, sender_id, recipient_id, message_id, text, timestamp, status, reply_by }
    const { error } = await supabase
        .from('whatsapp_chats')
        .upsert(data, { onConflict: 'message_id' });

    if (error) {
        console.error("Error saving to whatsapp_chats:", error);
    }
}

// 15. Get WhatsApp Chat History (Deprecated - Removed Duplicate)
// See function at line ~460


// 16. Check WhatsApp Duplicate
async function checkWhatsAppDuplicate(messageId) {
    if (!messageId) return false;

    const { data } = await supabase
        .from('whatsapp_debounce')
        .select('id')
        .eq('message_id', messageId)
        .maybeSingle();

    if (data) return true;

    await supabase.from('whatsapp_debounce').insert({ message_id: messageId });
    return false;
}

// 17. Save WhatsApp Order Tracking
async function saveWhatsAppOrderTracking(orderData) {
    const { session_name, sender_id, product_name, number, location, product_quantity, price } = orderData;
    
    console.log(`[WA Order] Attempting to save order for ${sender_id}...`);

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    
    const { data: recentOrders, error: checkError } = await supabase
        .from('whatsapp_order_tracking')
        .select('*')
        .eq('number', number)
        .gte('created_at', twentyFourHoursAgo)
        .order('id', { ascending: false });

    if (checkError) console.error("[WA Order] Error checking duplicates:", checkError.message);
    
    let existingOrder = null;

    if (recentOrders && recentOrders.length > 0) {
        const normalize = (str) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const currentProd = normalize(product_name);
        
        existingOrder = recentOrders.find(o => {
            const existingProd = normalize(o.product_name);
            const isMatch = existingProd.includes(currentProd) || currentProd.includes(existingProd);
            const isPending = !o.status || o.status === 'pending';
            return isMatch && isPending;
        });
    }

    if (existingOrder) {
        console.log(`[WA Order] Found existing PENDING order (ID: ${existingOrder.id}). Updating...`);
        
        const updatePayload = {};
        if (location && location !== existingOrder.location) updatePayload.location = location;
        if (product_quantity && product_quantity !== existingOrder.product_quantity) updatePayload.product_quantity = product_quantity;
        if (price && price !== existingOrder.price) updatePayload.price = price;
        
        if (Object.keys(updatePayload).length > 0) {
            await supabase
                .from('whatsapp_order_tracking')
                .update(updatePayload)
                .eq('id', existingOrder.id);
        }
        return null;
    }

    const { data, error } = await supabase
        .from('whatsapp_order_tracking')
        .insert([{
            session_name,
            sender_id,
            product_name,
            number,
            location,
            product_quantity,
            price
        }])
        .select();

    if (error) {
        console.error("[WA Order] Failed to save order:", error.message);
        return null;
    }
    
    return data[0];
}

// 17. Get WhatsApp Chat History
async function getWhatsAppChatHistory(sessionName, senderId, limit = 10) {
    const { data, error } = await supabase
        .from('whatsapp_chats')
        .select('*')
        .eq('session_name', sessionName)
        // Check both sender and recipient to get full conversation
        // OR logic: (sender_id = user AND recipient_id = page) OR (sender_id = page AND recipient_id = user)
        .or(`and(sender_id.eq.${senderId},recipient_id.eq.${sessionName}),and(sender_id.eq.${sessionName},recipient_id.eq.${senderId})`)
        .order('timestamp', { ascending: false })
        .limit(limit);

    if (error) {
        console.error("Error fetching WA chat history:", error.message);
        return [];
    }

    // Transform for AI Service: [{ role: 'user'|'assistant', content: '...' }]
    return data.reverse().map(msg => ({
        role: (msg.reply_by === 'user') ? 'user' : 'assistant',
        content: msg.text || ''
    }));
}

// --- Helper: Get Last WhatsApp Message (Raw) for Duplicate Check ---
async function getLastWhatsAppMessage(sessionName, recipientId) {
    const { data, error } = await supabase
        .from('whatsapp_chats')
        .select('*')
        .eq('session_name', sessionName)
        // We want the last message in this conversation, regardless of sender
        .or(`and(sender_id.eq.${recipientId},recipient_id.eq.${sessionName}),and(sender_id.eq.${sessionName},recipient_id.eq.${recipientId})`)
        .order('timestamp', { ascending: false })
        .limit(1)
        .single();

    if (error) return null;
    return data;
}

// 18. Deduct WhatsApp Credit (Shared User Balance)
async function deductWhatsAppCredit(sessionName, amount = 1) {
    // 1. Get User ID from Session
    const { data: sessionData, error: sessionError } = await supabase
        .from('whatsapp_message_database')
        .select('user_id')
        .eq('session_name', sessionName)
        .single();

    if (sessionError || !sessionData || !sessionData.user_id) {
        console.error(`[WA Credit] Session ${sessionName} not linked to user or not found.`);
        return false;
    }

    const userId = sessionData.user_id;

    // 2. Get User Credit
    const { data: userConfig, error: userError } = await supabase
        .from('user_configs')
        .select('message_credit, email') // Assuming email might be here or we fetch from auth.users (but auth.users not accessible directly usually, relying on user_configs)
        // actually user_configs might not have email. page_access_token_message had it.
        // We can skip email logging for now or try to fetch it if stored.
        .eq('user_id', userId)
        .single();

    if (userError || !userConfig) {
        console.error(`[WA Credit] User config not found for ${userId}.`);
        return false;
    }

    if (userConfig.message_credit < amount) {
        console.warn(`[WA Credit] Insufficient credits for User ${userId}. Balance: ${userConfig.message_credit}`);
        return false;
    }

    // 3. Deduct
    const { error: updateError } = await supabase
        .from('user_configs')
        .update({ message_credit: userConfig.message_credit - amount })
        .eq('user_id', userId);

    if (updateError) {
        console.error(`[WA Credit] Update failed: ${updateError.message}`);
        return false;
    }

    console.log(`[WA Credit] Deducted ${amount} credit from User ${userId}`);
    return true;
}

// 19. Save WhatsApp Contact (Lead)
async function saveWhatsAppContact(data) {
    // data: { session_name, phone_number, name }
    const { error } = await supabase
        .from('whatsapp_contacts')
        .upsert({
            session_name: data.session_name,
            phone_number: data.phone_number,
            name: data.name,
            last_interaction: new Date().toISOString()
        }, { onConflict: 'session_name, phone_number' });

    if (error) console.error("Error saving WA contact:", error.message);
}

// 20. Toggle WhatsApp Lock (Handover)
async function toggleWhatsAppLock(sessionName, phoneNumber, isLocked) {
    console.log(`[WA Lock] Toggling lock for ${sessionName} - User: ${phoneNumber} -> ${isLocked}`);

    if (!sessionName || !phoneNumber) {
        console.error("[WA Lock] Missing sessionName or phoneNumber");
        return false;
    }

    try {
        // 1. Check if exists
        const { data: existing, error: fetchError } = await supabase
            .from('whatsapp_contacts')
            .select('id')
            .eq('session_name', sessionName)
            .eq('phone_number', phoneNumber)
            .maybeSingle();

        if (fetchError) {
             console.error(`[WA Lock] Fetch failed: ${fetchError.message}`);
        }

        if (existing) {
            // 2. UPDATE
            const { error: updateError } = await supabase
                .from('whatsapp_contacts')
                .update({ 
                    is_locked: isLocked,
                    last_interaction: new Date().toISOString()
                })
                .eq('session_name', sessionName)
                .eq('phone_number', phoneNumber);

            if (updateError) {
                console.error(`[WA Lock] Update failed: ${updateError.message}`);
                return false;
            }
            console.log(`[WA Lock] Update successful for ${phoneNumber}`);
            return true;
        } else {
            // 3. INSERT
            const { error: insertError } = await supabase
                .from('whatsapp_contacts')
                .insert({
                    session_name: sessionName,
                    phone_number: phoneNumber,
                    is_locked: isLocked,
                    name: 'Unknown',
                    last_interaction: new Date().toISOString()
                });

            if (insertError) {
                console.error(`[WA Lock] Insert failed: ${insertError.message}`);
                return false;
            }
            console.log(`[WA Lock] Insert successful for ${phoneNumber}`);
            return true;
        }
    } catch (err) {
        console.error(`[WA Lock] Unexpected error: ${err.message}`);
        return false;
    }
}

// 27. Check WhatsApp Emoji Lock (History Scan)
async function checkWhatsAppEmojiLock(sessionName, phoneNumber, lockEmojis, unlockEmojis) {
    try {
        // Fetch last 10 messages from Admin or Bot (Page side)
        const { data, error } = await supabase
            .from('whatsapp_chats')
            .select('text, reply_by, timestamp')
            .eq('session_name', sessionName)
            .eq('recipient_id', phoneNumber) // Messages sent TO user
            .in('reply_by', ['admin', 'bot']) // Only check Page replies
            .order('timestamp', { ascending: false })
            .limit(10);

        if (error) {
            console.error("Error fetching chat history for lock check:", error);
            return null;
        }
        
        if (!data || data.length === 0) return null;

        // Iterate from newest to oldest
        for (const msg of data) {
            const text = (msg.text || '').trim();
            if (!text) continue;

            // Check for Lock Emojis
            for (const emoji of lockEmojis) {
                if (text.includes(emoji)) {
                    console.log(`[WA Lock] Found Lock Emoji '${emoji}' in message: "${text}"`);
                    return { locked: true, timestamp: msg.timestamp };
                }
            }

            // Check for Unlock Emojis
            for (const emoji of unlockEmojis) {
                if (text.includes(emoji)) {
                     console.log(`[WA Lock] Found Unlock Emoji '${emoji}' in message: "${text}"`);
                     return { locked: false, timestamp: msg.timestamp };
                }
            }
        }

        return null; // No emoji found in recent history
    } catch (e) {
        console.error("Error checking emoji lock history:", e);
        return null;
    }
}

// 21. Get WhatsApp Contact (Check Lock Status)
async function getWhatsAppContact(sessionName, phoneNumber) {
    const { data, error } = await supabase
        .from('whatsapp_contacts')
        .select('*')
        .eq('session_name', sessionName)
        .eq('phone_number', phoneNumber)
        .single();

    if (error) return null;
    return data;
}



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
    // Strategy: Page must be Active/Trial AND (Have Credit OR Have Own API)
    const { data: pages, error } = await supabase
        .from('page_access_token_message')
        .select('page_id, user_id, message_credit, subscription_status, api_key, cheap_engine')
        .or('subscription_status.eq.active,subscription_status.eq.trial,subscription_status.eq.active_trial,subscription_status.eq.active_paid');
        
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

    // 3. Filter: Subscription Status + Credit Check
    const allowedPageIds = pages.filter(p => {
        // Normalize Status
        const status = p.subscription_status;
        const isActive = ['active', 'trial', 'active_trial', 'active_paid'].includes(status);

        // If status is NOT active, skip
        if (!isActive) {
             return false;
        }
        
        // Check Shared Credits (Primary & Only)
        const sharedCredits = userCredits[p.user_id] || 0;
        
        // Logic:
        // 1. If Own API Key is present (and cheap_engine is FALSE), allow access (BYPASS Credit Check).
        // 2. If using System API (cheap_engine is TRUE or api_key is empty), require Credit > 0.
        
        const hasOwnKey = p.api_key && p.api_key.length > 5 && p.cheap_engine === false;
        
        if (hasOwnKey) {
            // Own API users are always active if subscription is active
            return true;
        }
        
        // Strict Rule: No page-level credit check.
        if (sharedCredits > 0) return true;
        
        // Log skipped page
        // console.log(`[DB] Page ${p.page_id} skipped (No Shared Credits: ${sharedCredits})`);
        return false;
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

    // Insert System Alert into fb_chats
    await saveFbChat({
        page_id: pageId,
        sender_id: pageId, // System is sender
        recipient_id: pageId, // Self
        message_id: `sys_err_${Date.now()}`,
        text: "⚠️ SYSTEM ALERT: Facebook Page Token Expired. Please Reconnect Page in Dashboard.",
        timestamp: new Date(),
        status: 'error',
        reply_by: 'bot'
    });
}

// 20. Update WhatsApp Entry (e.g. status, QR code)
async function updateWhatsAppEntry(id, updates) {
    const { error } = await supabase
        .from('whatsapp_message_database')
        .update(updates)
        .eq('id', id);

    if (error) console.error("Error updating WhatsApp entry:", error.message);
}

// 21. Update WhatsApp Entry By Name
async function updateWhatsAppEntryByName(sessionName, updates) {
    const { error } = await supabase
        .from('whatsapp_message_database')
        .update(updates)
        .eq('session_name', sessionName);

    if (error) console.error("Error updating WhatsApp entry by name:", error.message);
}

// 22. Renew WhatsApp Session
async function renewWhatsAppSession(sessionName, days) {
    // 1. Get current expiry
    const { data: session, error: fetchError } = await supabase
        .from('whatsapp_message_database')
        .select('expires_at, plan_days')
        .eq('session_name', sessionName)
        .single();

    if (fetchError || !session) throw new Error("Session not found");

    let newExpiresAt = new Date();
    // If currently active and not expired, add to existing expiry
    if (session.expires_at && new Date(session.expires_at) > new Date()) {
        newExpiresAt = new Date(session.expires_at);
    }
    
    // Add days
    newExpiresAt.setDate(newExpiresAt.getDate() + days);

    const { data, error } = await supabase
        .from('whatsapp_message_database')
        .update({
            expires_at: newExpiresAt.toISOString(),
            plan_days: (session.plan_days || 0) + days,
            active: true,
            status: 'working', // Restore status if it was expired
            subscription_status: 'active'
        })
        .eq('session_name', sessionName)
        .select()
        .single();

    if (error) throw error;
    return data;
}

// 23. Get Expired WhatsApp Sessions
async function getExpiredWhatsAppSessions() {
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('whatsapp_message_database')
        .select('session_name, user_id, expires_at')
        .lt('expires_at', now)
        .eq('active', true); // Only get those marked as active but time has passed

    if (error) {
        console.error("Error fetching expired sessions:", error);
        return [];
    }
    return data;
}

// 24. Deduct User Balance (for Plans)
async function deductUserBalance(userId, amount, description = 'Plan Purchase') {
    // Check balance
    const { data: userConfig, error: fetchError } = await supabase
        .from('user_configs')
        .select('balance, email') // Assuming email is not here but in auth.users, but checking schema
        .eq('user_id', userId)
        .single();

    if (fetchError || !userConfig) throw new Error("User config not found");
    
    if ((userConfig.balance || 0) < amount) {
        throw new Error("Insufficient balance");
    }

    // Deduct
    const { error: updateError } = await supabase
        .from('user_configs')
        .update({ balance: (userConfig.balance || 0) - amount })
        .eq('user_id', userId);

    if (updateError) throw updateError;

    // Log Transaction
    await supabase.from('payment_transactions').insert({
        user_email: userConfig.email || 'unknown', // Ideally fetch email from auth or store it in user_configs
        amount: amount,
        method: 'balance_deduction',
        trx_id: `SUB_${Date.now()}`,
        sender_number: 'SYSTEM',
        status: 'completed',
        notes: description
    });

    return true;
}

// 25. Delete WhatsApp Entry
async function deleteWhatsAppEntry(sessionName) {
    const { error } = await supabase
        .from('whatsapp_message_database')
        .delete()
        .eq('session_name', sessionName);

    if (error) {
        console.error("Error deleting WhatsApp entry:", error.message);
        throw error;
    }
}

// 26. Check WhatsApp Lock Status
async function checkWhatsAppLockStatus(sessionName, senderId) {
    try {
        const { data, error } = await supabase
            .from('whatsapp_chats')
            .select('status, timestamp')
            .eq('session_name', sessionName)
            .eq('recipient_id', senderId)
            .eq('reply_by', 'bot')
            .order('timestamp', { ascending: false })
            .limit(4);

        if (error || !data || data.length < 4) return false;

        const allIgnored = data.every(msg => msg.status === 'ai_ignored');
        if (!allIgnored) return false;

        const lastIgnoredTime = Number(data[0].timestamp); 
        const ONE_DAY_MS = 24 * 60 * 60 * 1000;
        
        if (Date.now() - lastIgnoredTime < ONE_DAY_MS) {
            return true;
        }
        
        return false;
    } catch (e) {
        console.error("WA Lock Check Error:", e);
        return false;
    }
}

// --- Helper: Get Last N WhatsApp Messages (Raw) for Echo Check ---
async function getLastNWhatsAppMessages(sessionName, recipientId, limit = 20) {
    const { data, error } = await supabase
        .from('whatsapp_chats')
        .select('*')
        .eq('session_name', sessionName)
        // We want messages in this conversation
        .or(`and(sender_id.eq.${recipientId},recipient_id.eq.${sessionName}),and(sender_id.eq.${sessionName},recipient_id.eq.${recipientId})`)
        .order('timestamp', { ascending: false })
        .limit(limit);

    if (error) {
        console.warn(`[WA DB] Failed to fetch last ${limit} messages: ${error.message}`);
        return [];
    }
    return data;
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
    markPageTokenInvalid,
    createWhatsAppEntry,
    getWhatsAppConfig,
    saveWhatsAppChat,
    getWhatsAppChatHistory,
    checkWhatsAppDuplicate,
    saveWhatsAppOrderTracking,
    deductWhatsAppCredit,
    saveWhatsAppContact,
    updateWhatsAppEntry,
    updateWhatsAppEntryByName,
    getLastWhatsAppMessage,
    getLastNWhatsAppMessages,
    toggleWhatsAppLock,
    getWhatsAppContact,
    renewWhatsAppSession,
    getExpiredWhatsAppSessions,
    deductUserBalance,
    deleteWhatsAppEntry,
    checkWhatsAppLockStatus,
    checkWhatsAppEmojiLock
};
