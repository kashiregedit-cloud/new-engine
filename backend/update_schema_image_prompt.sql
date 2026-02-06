-- Add image_prompt column to fb_message_database if it doesn't exist
ALTER TABLE public.fb_message_database 
ADD COLUMN IF NOT EXISTS image_prompt text;
