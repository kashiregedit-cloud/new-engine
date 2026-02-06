-- Fix for missing emoji lock columns in whatsapp_message_database
-- Run this in Supabase SQL Editor to fix the "Unknown error" when saving settings

ALTER TABLE public.whatsapp_message_database 
ADD COLUMN IF NOT EXISTS lock_emojis text DEFAULT '',
ADD COLUMN IF NOT EXISTS unlock_emojis text DEFAULT '';
