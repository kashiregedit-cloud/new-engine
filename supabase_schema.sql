-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Table for WhatsApp Sessions (Managed by WAHA)
create table if not exists whatsapp_sessions (
  id uuid default uuid_generate_v4() primary key,
  session_id text not null unique,
  session_name text,
  user_email text,
  user_id text, -- Supabase Auth User ID
  plan_days int,
  qr_code text,
  status text default 'stopped',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 2. Table for User Configurations (AI Providers, API Keys)
create table if not exists user_configs (
  id uuid default uuid_generate_v4() primary key,
  user_id text not null unique, -- Supabase Auth User ID or Email
  ai_provider text default 'openrouter', -- 'openai', 'gemini', 'openrouter', 'groq'
  api_key text,
  model_name text default 'xiaomi/mimo-v2-flash:free',
  system_prompt text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- 3. Table for Debounce (Production-Grade Queueing)
create table if not exists wpp_debounce (
  id uuid default uuid_generate_v4() primary key,
  debounce_key text not null unique, -- e.g., 'pageId_senderId'
  last_message_at timestamp with time zone default now(),
  is_processing boolean default false
);

-- 4. Update wp_chats to support Media
alter table wp_chats add column if not exists media_type text default 'text'; -- 'text', 'image', 'audio'
alter table wp_chats add column if not exists media_url text;

-- Indexes for performance
create index if not exists idx_wp_chats_sender_page_status on wp_chats(sender_id, page_id, status);
create index if not exists idx_wpp_debounce_key on wpp_debounce(debounce_key);

-- Update user_configs for Control Page settings
alter table user_configs add column if not exists auto_reply boolean default true;
alter table user_configs add column if not exists ai_enabled boolean default true;
alter table user_configs add column if not exists media_enabled boolean default true;
alter table user_configs add column if not exists response_language text default 'bn';
-- 5. Table for Session QR Links (User Requested)
create table if not exists session_qr_link ( 
   id bigint generated always as identity not null, 
   qr_link text not null, 
   session_name text null, 
   session_used boolean null default false, 
   constraint session_qr_link_pkey primary key (id) 
 ) TABLESPACE pg_default;

-- 6. Fix for existing whatsapp_sessions table
alter table whatsapp_sessions add column if not exists user_id text;
alter table whatsapp_sessions add column if not exists qr_code text;

