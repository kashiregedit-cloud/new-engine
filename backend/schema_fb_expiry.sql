
-- Add expires_at column to page_access_token_message for auto-deletion
ALTER TABLE public.page_access_token_message 
ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone;

-- Ensure other columns exist just in case
ALTER TABLE public.page_access_token_message 
ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'inactive',
ADD COLUMN IF NOT EXISTS subscription_plan text;
