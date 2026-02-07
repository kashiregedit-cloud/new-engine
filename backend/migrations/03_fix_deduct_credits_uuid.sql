-- Fix for deduct_credits_via_page function to handle UUID casting correctly
-- Run this in Supabase SQL Editor

CREATE OR REPLACE FUNCTION deduct_credits_via_page(p_page_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_owner_id uuid;
  v_owner_email text;
  v_current_credit numeric;
BEGIN
  -- 1. Get Page Owner ID and Email
  -- Cast user_id to UUID if it's stored as UUID in page_access_token_message (it should be)
  -- If it's stored as text, we cast to UUID for consistency with user_configs
  SELECT user_id, email 
  INTO v_owner_id, v_owner_email
  FROM public.page_access_token_message
  WHERE page_id = p_page_id;

  IF v_owner_id IS NULL THEN
    -- Page not found or no owner
    RETURN false;
  END IF;

  -- 2. Check Balance
  -- user_configs.user_id is UUID
  SELECT message_credit INTO v_current_credit
  FROM public.user_configs
  WHERE user_id = v_owner_id;

  IF v_current_credit IS NULL OR v_current_credit <= 0 THEN
    RETURN false; -- Insufficient credits
  END IF;

  -- 3. Deduct Credit
  UPDATE public.user_configs
  SET message_credit = message_credit - 1
  WHERE user_id = v_owner_id;

  -- 4. Log Transaction (Visible in Payment History)
  INSERT INTO public.payment_transactions (
    user_email, 
    amount, 
    method, 
    trx_id, 
    sender_number, 
    status,
    created_at
  ) VALUES (
    v_owner_email,
    1,
    'balance_deduction',
    'DED_' || floor(extract(epoch from now()) * 1000)::text,
    'SYSTEM',
    'completed',
    now()
  );

  RETURN true;
END;
$$;
