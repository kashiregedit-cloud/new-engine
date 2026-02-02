require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Error: SUPABASE_URL or SUPABASE_KEY is missing in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTables() {
    console.log("Checking for 'payment_transactions' table...");
    
    // Try to select 1 row
    const { data, error } = await supabase
        .from('payment_transactions')
        .select('*')
        .limit(1);

    if (error) {
        console.error("❌ Error accessing 'payment_transactions':", error.message);
        if (error.code === '42P01') {
            console.log("   -> This usually means the table DOES NOT EXIST.");
        }
    } else {
        console.log("✅ 'payment_transactions' table EXISTS.");
        console.log("   Sample data:", data);
    }

    console.log("\nChecking for 'user_configs' table...");
    const { data: userData, error: userError } = await supabase
        .from('user_configs')
        .select('*')
        .limit(1);
        
    if (userError) {
        console.error("❌ Error accessing 'user_configs':", userError.message);
    } else {
        console.log("✅ 'user_configs' table EXISTS. Sample:", userData);
    }

    console.log("\nChecking for 'deduct_credits_via_page' RPC function...");
    const { data: rpcData, error: rpcError } = await supabase.rpc('deduct_credits_via_page', { p_page_id: 'dummy_page_id' });
    
    if (rpcError) {
        if (rpcError.message.includes('Could not find the function')) {
             console.error("❌ RPC function 'deduct_credits_via_page' DOES NOT EXIST.");
        } else {
             // If it exists but returns false (because dummy page not found), that's fine.
             console.log("✅ RPC function 'deduct_credits_via_page' EXISTS (Called successfully, result: " + rpcData + ")");
        }
    } else {
        console.log("✅ RPC function 'deduct_credits_via_page' EXISTS.");
    }

    console.log("\nChecking 'page_access_token_message' for user_id...");
    const { data: pageData, error: pageError } = await supabase
        .from('page_access_token_message')
        .select('page_id, user_id, email')
        .limit(5);
        
    if (pageError) {
        console.error("❌ Error accessing 'page_access_token_message':", pageError.message);
    } else {
        console.log("✅ 'page_access_token_message' accessible. Sample:", pageData);
    }
}

checkTables();
