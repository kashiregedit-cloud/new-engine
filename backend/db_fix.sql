
-- 1. Create the table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id text,
    session_name text UNIQUE,
    user_email text,
    user_id text,
    plan_days integer DEFAULT 30,
    qr_code text,
    status text DEFAULT 'created',
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- 2. Force refresh schema cache (by notifying PostgREST)
NOTIFY pgrst, 'reload schema';

-- 3. Grant permissions to ensure API can access it
GRANT ALL ON TABLE public.whatsapp_sessions TO anon, authenticated, service_role;

-- 4. Enable RLS (Optional, good for security)
ALTER TABLE public.whatsapp_sessions ENABLE ROW LEVEL SECURITY;

-- 5. Create a policy to allow all operations (Adjust this for production!)
-- This ensures that even without a valid user token, the backend can insert/update
CREATE POLICY "Enable all access for all users" ON public.whatsapp_sessions
    FOR ALL USING (true) WITH CHECK (true);
