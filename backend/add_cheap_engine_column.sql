
-- Add cheap_engine column to distinguish between Managed (True) and Own API (False)
ALTER TABLE public.page_access_token_message 
ADD COLUMN IF NOT EXISTS cheap_engine boolean DEFAULT true;
