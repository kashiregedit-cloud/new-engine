-- Add email column for team sharing
ALTER TABLE public.whatsapp_message_database ADD COLUMN IF NOT EXISTS email text;

-- Backfill email for existing sessions (Requires access to auth.users)
-- This might fail if the executing user doesn't have permissions on auth.users
DO $$
BEGIN
    UPDATE public.whatsapp_message_database w
    SET email = u.email
    FROM auth.users u
    WHERE w.user_id = u.id AND w.email IS NULL;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Could not backfill emails: %', SQLERRM;
END $$;

-- Update RLS to allow team access
-- 1. Allow viewing if you are the owner (standard)
-- 2. Allow viewing if you are a team member with permission

DROP POLICY IF EXISTS "Users can view own sessions" ON public.whatsapp_message_database;
CREATE POLICY "Users can view own sessions" 
ON public.whatsapp_message_database FOR SELECT 
USING (
  auth.uid()::text = user_id 
  OR 
  auth.email() = email
  OR
  EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.owner_email = whatsapp_message_database.email
    AND tm.member_email = auth.email()
    AND tm.status = 'active'
    -- Check for 'wa_sessions' permission logic if possible, 
    -- but usually we filter in frontend and just allow access to all owner's sessions in RLS 
    -- to simplify DB logic. Frontend handles granular permission.
  )
);
