
-- Function to deduct credits from the centralized user_configs table via page_id
CREATE OR REPLACE FUNCTION deduct_credits_via_page(p_page_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_owner_id text;
  v_current_credit numeric;
BEGIN
  -- 1. Get Page Owner ID
  SELECT user_id INTO v_owner_id
  FROM public.page_access_token_message
  WHERE page_id = p_page_id;

  IF v_owner_id IS NULL THEN
    -- Page not found or no owner
    RETURN false;
  END IF;

  -- 2. Check and Deduct from User Configs
  SELECT message_credit INTO v_current_credit
  FROM public.user_configs
  WHERE user_id = v_owner_id;

  IF v_current_credit IS NULL OR v_current_credit <= 0 THEN
    RETURN false; -- Insufficient credits
  END IF;

  -- 3. Update Balance
  UPDATE public.user_configs
  SET message_credit = message_credit - 1
  WHERE user_id = v_owner_id;

  RETURN true;
END;
$$;
