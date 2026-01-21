-- 1. Add missing columns to whatsapp_sessions if they don't exist
DO $$ 
BEGIN 
    -- Check and add user_id
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'whatsapp_sessions' AND column_name = 'user_id') THEN
        ALTER TABLE whatsapp_sessions ADD COLUMN user_id text;
    END IF;

    -- Check and add qr_code
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'whatsapp_sessions' AND column_name = 'qr_code') THEN
        ALTER TABLE whatsapp_sessions ADD COLUMN qr_code text;
    END IF;

    -- Check and add status
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'whatsapp_sessions' AND column_name = 'status') THEN
        ALTER TABLE whatsapp_sessions ADD COLUMN status text DEFAULT 'stopped';
    END IF;

    -- Check and add updated_at
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'whatsapp_sessions' AND column_name = 'updated_at') THEN
        ALTER TABLE whatsapp_sessions ADD COLUMN updated_at timestamp with time zone DEFAULT now();
    END IF;

    -- Check and add created_at
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'whatsapp_sessions' AND column_name = 'created_at') THEN
        ALTER TABLE whatsapp_sessions ADD COLUMN created_at timestamp with time zone DEFAULT now();
    END IF;

    -- Check and add plan_days
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'whatsapp_sessions' AND column_name = 'plan_days') THEN
        ALTER TABLE whatsapp_sessions ADD COLUMN plan_days int;
    END IF;

    -- Drop NOT NULL from user_email if it exists (to prevent crashes when email is missing)
    ALTER TABLE whatsapp_sessions ALTER COLUMN user_email DROP NOT NULL;
END $$;

-- 2. Create the session_qr_link table (User Requested)
create table if not exists session_qr_link (
  id bigint generated always as identity not null,
  qr_link text not null,
  session_name text null,
  session_used boolean null default false,
  created_at timestamp with time zone default now(),
  constraint session_qr_link_pkey primary key (id)
) TABLESPACE pg_default;

-- 3. Add Unique Constraint to session_name if not exists (Required for Upsert logic)
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_sessions_session_name_key') THEN
        ALTER TABLE whatsapp_sessions ADD CONSTRAINT whatsapp_sessions_session_name_key UNIQUE (session_name);
    END IF;
END $$;
