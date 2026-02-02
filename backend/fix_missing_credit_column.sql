
-- Run this in your Supabase SQL Editor to fix the "missing column" error
ALTER TABLE public.user_configs 
ADD COLUMN IF NOT EXISTS message_credit numeric DEFAULT 0;
