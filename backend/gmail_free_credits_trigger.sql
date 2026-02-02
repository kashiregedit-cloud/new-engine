-- ==========================================
--  Trigger: Give 100 Free Credits to New Gmail Users
-- ==========================================

-- 1. Create the Function
CREATE OR REPLACE FUNCTION public.handle_new_gmail_user()
RETURNS trigger AS $$
BEGIN
  -- Check if the email ends with @gmail.com (Case Insensitive)
  IF NEW.email ILIKE '%@gmail.com' THEN
    -- Insert into user_configs with 100 message credits
    -- Uses ON CONFLICT to avoid errors if the row already exists (updates it instead)
    INSERT INTO public.user_configs (user_id, message_credit)
    VALUES (NEW.id, 100)
    ON CONFLICT (user_id) DO UPDATE
    SET message_credit = COALESCE(user_configs.message_credit, 0) + 100;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Create the Trigger on auth.users
-- First, drop if it exists to allow safe re-running of this script
DROP TRIGGER IF EXISTS on_auth_user_created_gmail_bonus ON auth.users;

CREATE TRIGGER on_auth_user_created_gmail_bonus
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_gmail_user();
