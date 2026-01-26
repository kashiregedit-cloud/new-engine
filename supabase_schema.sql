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
alter table whatsapp_sessions add column if not exists status text default 'stopped';
alter table whatsapp_sessions add column if not exists updated_at timestamp with time zone default now();
alter table whatsapp_sessions add column if not exists created_at timestamp with time zone default now();

-- 7. Add Unique Constraint to session_name (Required for Upsert)
alter table whatsapp_sessions drop constraint if exists whatsapp_sessions_session_name_key;
alter table whatsapp_sessions add constraint whatsapp_sessions_session_name_key unique (session_name);

-- 8. Facebook Page Integration Tables
create table if not exists page_access_token_message (
  page_id text primary key,
  name text,
  page_access_token text,
  data_sheet text,
  secret_key text,
  found_id text,
  email text,
  ai text default 'openrouter',
  api_key text,
  chat_model text default 'xiaomi/mimo-v2-flash:free',
  subscription_status text default 'inactive', -- active, inactive, trial
  subscription_plan text, -- free, basic, pro, etc.
  subscription_expiry timestamp with time zone,
  message_credit numeric default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Ensure columns exist for page_access_token_message (if table already existed)
alter table page_access_token_message add column if not exists ai text default 'openrouter';
alter table page_access_token_message add column if not exists api_key text;
alter table page_access_token_message add column if not exists chat_model text default 'xiaomi/mimo-v2-flash:free';
alter table page_access_token_message add column if not exists subscription_status text default 'inactive';
alter table page_access_token_message add column if not exists subscription_plan text;
alter table page_access_token_message add column if not exists subscription_expiry timestamp with time zone;
alter table page_access_token_message add column if not exists message_credit numeric default 0;

create table if not exists fb_message_database (
  id bigint generated always as identity primary key,
  page_id text references page_access_token_message(page_id),
  text_prompt text,
  reply_message boolean default false,
  swipe_reply boolean default false,
  image_detection boolean default false,
  image_send boolean default false,
  template boolean default false,
  order_tracking boolean default false,
  template_prompt_x1 text,
  template_prompt_x2 text,
  verified boolean default true,
  created_at timestamp with time zone default now()
);

-- 9. Payment Transactions (for record keeping)
create table if not exists payment_transactions (
  id bigint generated always as identity primary key,
  user_email text,
  amount numeric,
  method text, -- 'bkash', 'nagad', 'stripe', 'balance_deduction'
  trx_id text,
  sender_number text,
  status text default 'pending', -- 'pending', 'completed', 'failed'
  created_at timestamp with time zone default now()
);
