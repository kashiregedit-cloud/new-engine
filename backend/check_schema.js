
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './backend/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function checkSchema() {
  const { data, error } = await supabase.from('user_configs').select('*').limit(1);
  if (error) {
      console.log('Error:', error);
  } else {
      console.log('User Configs Sample:', data);
  }
  
  // Check if a profiles or users table exists in public
  const { data: profiles, error: pError } = await supabase.from('profiles').select('*').limit(1);
  console.log('Profiles Table:', profiles, pError);
}

checkSchema();
