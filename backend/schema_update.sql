
-- Add balance to user_configs
ALTER TABLE public.user_configs 
ADD COLUMN IF NOT EXISTS balance NUMERIC DEFAULT 0;

-- Create payment transactions table
CREATE TABLE IF NOT EXISTS public.payment_transactions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id),
  amount NUMERIC NOT NULL,
  type TEXT NOT NULL, -- 'credit', 'debit'
  method TEXT,        -- 'bkash', 'nagad', 'manual', 'system'
  status TEXT DEFAULT 'completed', -- 'pending', 'completed', 'failed'
  transaction_id TEXT, -- For manual verification (TrxID)
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS Policies (Optional but good practice)
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own transactions" 
ON public.payment_transactions FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert deposit requests" 
ON public.payment_transactions FOR INSERT 
WITH CHECK (auth.uid() = user_id AND type = 'credit' AND status = 'pending');
