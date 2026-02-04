-- Add model_used column to whatsapp_chats table if it doesn't exist
ALTER TABLE whatsapp_chats 
ADD COLUMN IF NOT EXISTS model_used TEXT;

-- Also verify fb_chats has it
ALTER TABLE fb_chats 
ADD COLUMN IF NOT EXISTS ai_model TEXT;
