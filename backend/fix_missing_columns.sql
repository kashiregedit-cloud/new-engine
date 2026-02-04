-- Fix for missing columns in whatsapp_message_database
-- Run this in Supabase SQL Editor to enable session expiry features

ALTER TABLE public.whatsapp_message_database 
ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone,
ADD COLUMN IF NOT EXISTS plan_days integer DEFAULT 30;
