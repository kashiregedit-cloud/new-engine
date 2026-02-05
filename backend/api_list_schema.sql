-- Create api_list table for Multi-Key Management
CREATE TABLE IF NOT EXISTS public.api_list (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL PRIMARY KEY,
  provider text NOT NULL, -- 'google', 'openai', 'gemini'
  api text NOT NULL, -- The API Key
  model text DEFAULT 'openrouter/auto',
  usage_count bigint DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

-- Enable Row Level Security (Optional, but good practice)
ALTER TABLE public.api_list ENABLE ROW LEVEL SECURITY;

-- Policy: Allow read access to authenticated users (or service role)
CREATE POLICY "Enable read access for all users" ON public.api_list FOR SELECT USING (true);

-- Insert some sample/placeholder data (User needs to replace these with real keys)
-- INSERT INTO public.api_list (provider, api, model) VALUES 
-- ('google', 'YOUR_GEMINI_API_KEY_1', 'openrouter/auto'),
-- ('google', 'YOUR_GEMINI_API_KEY_2', 'openrouter/auto');
