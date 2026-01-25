
-- 1. Drop existing table if exists (to change schema from UUID to BigInt if needed)
-- Warning: This will delete existing referral codes!
DROP TABLE IF EXISTS public.referral_codes;

-- 2. Create new table with 'message' type support
create table public.referral_codes ( 
  id bigint generated always as identity not null, 
  code text not null, 
  type text not null, 
  value numeric not null, 
  status text not null default 'active'::text, 
  created_at timestamp with time zone null default now(), 
  constraint referral_codes_pkey primary key (id), 
  constraint referral_codes_code_key unique (code), 
  constraint referral_codes_type_check check ( 
    ( 
      type = any (array['balance'::text, 'discount'::text, 'message'::text]) 
    ) 
  ) 
) TABLESPACE pg_default;

-- 3. Enable RLS
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

-- 4. Policies
CREATE POLICY "Anyone can read referral codes" ON public.referral_codes FOR SELECT USING (true);

-- 5. Add message_credit to user_configs (for tracking usage)
-- This is required for the 'message' type referral codes to work
ALTER TABLE public.user_configs ADD COLUMN IF NOT EXISTS message_credit INTEGER DEFAULT 0;
