-- 1. Add email column to user_configs if it doesn't exist
ALTER TABLE public.user_configs ADD COLUMN IF NOT EXISTS email text;

-- 2. Populate email from auth.users (One-time sync)
UPDATE public.user_configs
SET email = (
    SELECT email 
    FROM auth.users 
    WHERE auth.users.id::text = public.user_configs.user_id
)
WHERE email IS NULL;

-- 3. Create Index for faster lookup
CREATE INDEX IF NOT EXISTS idx_user_configs_email ON public.user_configs(email);

-- 4. RPC Function to Deduct Credit via Page ID (Centralized Billing)
CREATE OR REPLACE FUNCTION deduct_credits_via_page(p_page_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_email text;
    v_user_id text;
    v_balance numeric;
BEGIN
    -- Get email from page (Owner)
    SELECT email INTO v_email
    FROM public.page_access_token_message
    WHERE page_id = p_page_id;

    IF v_email IS NULL THEN
        -- Page not found or no email linked
        RETURN false;
    END IF;

    -- Find User Config by Email (using the new column or joining auth.users)
    -- We prioritize the local email column if populated, otherwise fallback to auth.users
    SELECT user_id, balance INTO v_user_id, v_balance
    FROM public.user_configs
    WHERE email = v_email
    LIMIT 1;

    -- If not found in user_configs by email, try to find via auth.users lookup
    IF v_user_id IS NULL THEN
        SELECT id INTO v_user_id
        FROM auth.users
        WHERE email = v_email;

        IF v_user_id IS NOT NULL THEN
            -- Check balance for this user_id
            SELECT balance INTO v_balance
            FROM public.user_configs
            WHERE user_id = v_user_id::text;
        END IF;
    END IF;

    -- If still no user config or balance is 0/null
    IF v_balance IS NULL OR v_balance <= 0 THEN
        RETURN false;
    END IF;

    -- Deduct 1 Credit
    UPDATE public.user_configs
    SET balance = balance - 1
    WHERE user_id = v_user_id::text;

    RETURN true;
END;
$$;
