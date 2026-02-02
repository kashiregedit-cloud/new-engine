
-- Function to handle secure credit purchase by Owner or Team Member
-- Logic: 
-- 1. Deducts cost from the BUYER'S balance (Current Logged-in User)
-- 2. Adds message credits to the PAGE OWNER'S account
-- 3. Logs the transaction

CREATE OR REPLACE FUNCTION purchase_credits(
  p_page_id text,
  p_credit_amount int,
  p_cost numeric
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_owner_id text;
  v_buyer_id uuid;
  v_buyer_email text;
  v_buyer_balance numeric;
BEGIN
  -- 1. Get Page Owner ID
  SELECT user_id INTO v_owner_id
  FROM public.page_access_token_message
  WHERE page_id = p_page_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Page not found or owner missing';
  END IF;

  -- 2. Get Buyer (Current User)
  v_buyer_id := auth.uid();
  IF v_buyer_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  SELECT email INTO v_buyer_email FROM auth.users WHERE id = v_buyer_id;

  -- 3. Check Buyer Balance
  SELECT balance INTO v_buyer_balance
  FROM public.user_configs
  WHERE user_id = v_buyer_id::text;

  IF v_buyer_balance IS NULL OR v_buyer_balance < p_cost THEN
    RAISE EXCEPTION 'Insufficient balance. Required: %, Available: %', p_cost, COALESCE(v_buyer_balance, 0);
  END IF;

  -- 4. Deduct from Buyer
  UPDATE public.user_configs
  SET balance = balance - p_cost
  WHERE user_id = v_buyer_id::text;

  -- 5. Add Credits to Owner
  -- Try update first
  UPDATE public.user_configs
  SET message_credit = COALESCE(message_credit, 0) + p_credit_amount
  WHERE user_id = v_owner_id;
  
  -- If owner config doesn't exist (rare), insert it
  IF NOT FOUND THEN
    INSERT INTO public.user_configs (user_id, message_credit, balance)
    VALUES (v_owner_id, p_credit_amount, 0);
  END IF;

  -- 6. Log Transaction
  INSERT INTO public.payment_transactions (
    user_email,
    amount,
    method,
    trx_id,
    sender_number,
    status
  ) VALUES (
    v_buyer_email,
    p_cost,
    'credit_purchase',
    'SYS_' || floor(extract(epoch from now())),
    'SYSTEM',
    'completed'
  );

  RETURN json_build_object(
    'success', true, 
    'message', 'Successfully purchased ' || p_credit_amount || ' credits.'
  );
END;
$$;
