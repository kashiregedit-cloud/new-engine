-- Fix Missing User Linkage for Pages
-- This assigns all currently unlinked pages to the user with 10k credits (xbluewhalebd@gmail.com)
-- This is required for credit deduction to work.

UPDATE public.page_access_token_message
SET 
  user_id = 'f3cc8cff-fded-49c1-8850-c49b402ef489',
  email = 'xbluewhalebd@gmail.com'
WHERE user_id IS NULL;
