
-- ==========================================
--  1. Create user_configs table if it doesn't exist
-- ==========================================
CREATE TABLE IF NOT EXISTS public.user_configs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id text NOT NULL, -- Storing as text to match potential varied auth sources
  balance numeric DEFAULT 0,
  ai_provider text,
  api_key text,
  model_name text,
  system_prompt text,
  auto_reply boolean DEFAULT true,
  ai_enabled boolean DEFAULT true,
  media_enabled boolean DEFAULT true,
  response_language text,
  response_tone text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- ==========================================
--  2. Add balance column if table existed but column didn't
-- ==========================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'user_configs' 
        AND column_name = 'balance'
    ) THEN
        ALTER TABLE public.user_configs ADD COLUMN balance NUMERIC DEFAULT 0;
    END IF;
END $$;


-- ==========================================
--  3. Create payment transactions table (New Schema)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_email text NOT NULL,
  amount numeric NOT NULL,
  method text NOT NULL, -- 'bkash', 'nagad', 'manual', 'system' (for debits)
  trx_id text NOT NULL, -- For debits, use generated ID
  sender_number text NOT NULL, -- For debits, use 'System'
  status text NULL DEFAULT 'pending'::text,
  created_at timestamp with time zone NULL DEFAULT now()
);

-- RLS Policies (Optional but good practice)
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own transactions" ON public.payment_transactions;
CREATE POLICY "Users can view own transactions" 
ON public.payment_transactions FOR SELECT 
USING (auth.email() = user_email);

DROP POLICY IF EXISTS "Users can insert deposit requests" ON public.payment_transactions;
CREATE POLICY "Users can insert deposit requests" 
ON public.payment_transactions FOR INSERT 
WITH CHECK (true); 

DROP POLICY IF EXISTS "Allow public read for admin panel" ON public.payment_transactions;
CREATE POLICY "Allow public read for admin panel"
ON public.payment_transactions FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Allow public update for admin panel" ON public.payment_transactions;
CREATE POLICY "Allow public update for admin panel"
ON public.payment_transactions FOR UPDATE
USING (true);


-- ==========================================
--  4. RPC Function to Approve Deposit (Fixes Balance Issue)
-- ==========================================
CREATE OR REPLACE FUNCTION approve_deposit(txn_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER -- This allows the function to bypass RLS and update user_configs
AS $$
DECLARE
    v_amount numeric;
    v_user_email text;
    v_user_id uuid;
    v_current_balance numeric;
    v_txn_status text;
BEGIN
    -- 1. Get transaction details
    SELECT amount, user_email, status INTO v_amount, v_user_email, v_txn_status
    FROM public.payment_transactions
    WHERE id = txn_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Transaction not found';
    END IF;

    IF v_txn_status = 'completed' THEN
        RAISE EXCEPTION 'Transaction already completed';
    END IF;

    -- 2. Find user_id from auth.users (Reliable)
    SELECT id INTO v_user_id
    FROM auth.users
    WHERE email = v_user_email;

    IF v_user_id IS NULL THEN
        -- Fallback: Try to find in whatsapp_sessions if auth lookup fails
        -- (This handles cases where email casing might differ or auth table is restricted)
        BEGIN
            SELECT user_id::uuid INTO v_user_id
            FROM public.whatsapp_sessions
            WHERE user_email = v_user_email
            LIMIT 1;
        EXCEPTION WHEN OTHERS THEN
            v_user_id := NULL;
        END;
    END IF;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User ID not found for email: %. User must be registered.', v_user_email;
    END IF;

    -- 3. Update Balance (user_configs)
    -- Check if config exists
    SELECT balance INTO v_current_balance
    FROM public.user_configs
    WHERE user_id = v_user_id::text;

    IF v_current_balance IS NULL THEN
        -- Create config if missing
        INSERT INTO public.user_configs (user_id, balance)
        VALUES (v_user_id::text, v_amount);
    ELSE
        -- Update existing balance
        UPDATE public.user_configs
        SET balance = v_current_balance + v_amount
        WHERE user_id = v_user_id::text;
    END IF;

    -- 4. Mark transaction as completed
    UPDATE public.payment_transactions
    SET status = 'completed'
    WHERE id = txn_id;

END;
$$;

-- ==========================================
--  5. User Configs RLS (Ensure users can see their balance)
-- ==========================================
ALTER TABLE public.user_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own config" ON public.user_configs;
CREATE POLICY "Users can view own config" 
ON public.user_configs FOR SELECT 
USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can update own config" ON public.user_configs;
CREATE POLICY "Users can update own config" 
ON public.user_configs FOR UPDATE
USING (auth.uid()::text = user_id);

-- ==========================================
--  6. WhatsApp Sessions Updates (Expiry)
-- ==========================================
-- NOTE: Table name is 'whatsapp_message_database', NOT 'whatsapp_sessions'
ALTER TABLE public.whatsapp_message_database 
ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS plan_days integer DEFAULT 30,
ADD COLUMN IF NOT EXISTS email text;

-- Ensure RLS allows insert/update/delete for backend (or users if needed)
ALTER TABLE public.whatsapp_message_database ENABLE ROW LEVEL SECURITY;

-- Allow users to view their own sessions
DROP POLICY IF EXISTS "Users can view own sessions" ON public.whatsapp_message_database;
CREATE POLICY "Users can view own sessions" 
ON public.whatsapp_message_database FOR SELECT 
USING (auth.uid()::text = user_id OR auth.email() = (select email from auth.users where id = auth.uid())); -- Simplified RLS

-- Allow users/backend to insert/update their own sessions
DROP POLICY IF EXISTS "Users can insert own sessions" ON public.whatsapp_message_database;
CREATE POLICY "Users can insert own sessions" 
ON public.whatsapp_message_database FOR INSERT 
WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can update own sessions" ON public.whatsapp_message_database;
CREATE POLICY "Users can update own sessions" 
ON public.whatsapp_message_database FOR UPDATE
USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS "Users can delete own sessions" ON public.whatsapp_message_database;
CREATE POLICY "Users can delete own sessions" 
ON public.whatsapp_message_database FOR DELETE
USING (auth.uid()::text = user_id);
