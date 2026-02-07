-- Add user_access_token column to page_access_token_message for auto-token refresh
ALTER TABLE public.page_access_token_message 
ADD COLUMN IF NOT EXISTS user_access_token text;
