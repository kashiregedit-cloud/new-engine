-- Add cheap_engine column to page_access_token_message table
ALTER TABLE page_access_token_message 
ADD COLUMN IF NOT EXISTS cheap_engine BOOLEAN DEFAULT TRUE;

-- Update existing records to have cheap_engine = TRUE by default (Zero Cost Vision)
-- Or FALSE? User said "eta jodi true take tobe... zero cost".
-- Since the project is "Zero Cost AI", defaulting to TRUE makes sense for existing users who might not have keys.
UPDATE page_access_token_message SET cheap_engine = TRUE WHERE cheap_engine IS NULL;
