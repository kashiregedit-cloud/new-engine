require('dotenv').config();
const { supabase } = require('./src/services/dbService');

async function testSchema() {
    console.log("--- Starting Diagnostics ---");

    // 1. Check whatsapp_message_database columns (lock_emojis)
    console.log("1. Testing whatsapp_message_database columns...");
    try {
        const { data, error } = await supabase
            .from('whatsapp_message_database')
            .select('lock_emojis, unlock_emojis')
            .limit(1);
        
        if (error) {
            console.error("❌ Error selecting emoji columns:", error.message);
            console.error("Hint: The columns 'lock_emojis' and 'unlock_emojis' likely do not exist in 'whatsapp_message_database' table.");
        } else {
            console.log("✅ Columns exist. Data sample:", data);
        }
    } catch (e) {
        console.error("❌ Exception checking message database:", e.message);
    }

    // 2. Check whatsapp_contacts lock update (Upsert Conflict Test)
    console.log("\n2. Testing whatsapp_contacts lock update (Conflict Test)...");
    const testSession = 'test_session_debug_conflict';
    const testPhone = '9876543210@c.us';
    
    try {
        // Cleanup first
        await supabase.from('whatsapp_contacts').delete().eq('session_name', testSession).eq('phone_number', testPhone);

        // First Insert
        console.log("Attempting first insert...");
        const { data: insertData, error: insertError } = await supabase
            .from('whatsapp_contacts')
            .upsert({
                session_name: testSession,
                phone_number: testPhone,
                is_locked: false,
                name: 'Debug User 1',
                last_interaction: new Date().toISOString()
            }, { onConflict: 'session_name, phone_number' })
            .select();

        if (insertError) {
            console.error("❌ First insert failed:", insertError.message);
        } else {
            console.log("✅ First insert successful.");
        }

        // Second Upsert (Should Update)
        console.log("Attempting second upsert (should update is_locked to true)...");
        const { data: updateData, error: updateError } = await supabase
            .from('whatsapp_contacts')
            .upsert({
                session_name: testSession,
                phone_number: testPhone,
                is_locked: true, // Changing status
                name: 'Debug User 2',
                last_interaction: new Date().toISOString()
            }, { onConflict: 'session_name, phone_number' })
            .select();

        if (updateError) {
            console.error("❌ Second upsert failed (Constraint issue?):", updateError.message);
            console.error("Full Error:", JSON.stringify(updateError, null, 2));
        } else {
            console.log("✅ Second upsert successful. Data:", updateData);
            if (updateData[0].is_locked === true) {
                console.log("✅ Value correctly updated to true.");
            } else {
                console.error("❌ Value NOT updated. It is:", updateData[0].is_locked);
                console.error("⚠️ This means the Unique Constraint on (session_name, phone_number) might be missing!");
            }
        }

        // Clean up
        await supabase.from('whatsapp_contacts').delete().eq('session_name', testSession).eq('phone_number', testPhone);

    } catch (e) {
        console.error("❌ Exception checking lock status:", e.message);
    }
}

testSchema();
