
-- Create referral_codes table
CREATE TABLE IF NOT EXISTS public.referral_codes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('balance', 'discount')),
  value NUMERIC NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS for referral_codes
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

-- Allow read access to everyone (so users can check codes)
CREATE POLICY "Anyone can read referral codes" 
ON public.referral_codes FOR SELECT 
USING (true);

-- Allow full access to admins (service_role) - handled by Supabase admin client usually, 
-- but for app logic we might need specific policies if using authenticated client for admin.
-- For now, we'll assume admin operations might bypass RLS or use a specific admin role.
-- But since we are using client-side admin panel, we need a policy for admin users.
-- For simplicity in this context, we might allow authenticated users to view, but only admin to edit.
-- However, we don't have a distinct 'admin' role in auth.users yet.
-- We will just leave it open for read for now, and write is restricted.
