
-- Fix Team Access RLS Policies for Messenger

-- 1. page_access_token_message (The list of connected pages)
ALTER TABLE public.page_access_token_message ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own pages" ON public.page_access_token_message;
DROP POLICY IF EXISTS "Team members can view owner pages" ON public.page_access_token_message;
DROP POLICY IF EXISTS "Users can view own and team pages" ON public.page_access_token_message;

CREATE POLICY "Users can view own and team pages" 
ON public.page_access_token_message FOR SELECT 
USING (
  email = auth.email() -- Owner
  OR
  EXISTS ( -- Team Member
    SELECT 1 FROM team_members tm
    WHERE tm.owner_email = page_access_token_message.email
    AND tm.member_email = auth.email()
    AND tm.status = 'active'
  )
);

-- 2. fb_message_database (Database configuration for pages)
ALTER TABLE public.fb_message_database ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own fb_db" ON public.fb_message_database;
DROP POLICY IF EXISTS "Users can view own and team fb_db" ON public.fb_message_database;

CREATE POLICY "Users can view own and team fb_db" 
ON public.fb_message_database FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM page_access_token_message pat
    WHERE pat.page_id = fb_message_database.page_id
    AND (
       pat.email = auth.email() -- Owner
       OR
       EXISTS ( -- Team Member
          SELECT 1 FROM team_members tm
          WHERE tm.owner_email = pat.email
          AND tm.member_email = auth.email()
          AND tm.status = 'active'
       )
    )
  )
);

-- 3. fb_chats (Chat History)
ALTER TABLE public.fb_chats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own fb_chats" ON public.fb_chats;
DROP POLICY IF EXISTS "Users can view own and team fb_chats" ON public.fb_chats;

CREATE POLICY "Users can view own and team fb_chats" 
ON public.fb_chats FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM page_access_token_message pat
    WHERE pat.page_id = fb_chats.page_id
    AND (
       pat.email = auth.email() -- Owner
       OR
       EXISTS ( -- Team Member
          SELECT 1 FROM team_members tm
          WHERE tm.owner_email = pat.email
          AND tm.member_email = auth.email()
          AND tm.status = 'active'
       )
    )
  )
);
