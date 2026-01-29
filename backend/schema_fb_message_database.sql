CREATE TABLE IF NOT EXISTS public.fb_message_database (
  id bigint NOT NULL,
  reply_message boolean NOT NULL DEFAULT false,
  swipe_reply boolean NOT NULL DEFAULT false,
  image_detection boolean NOT NULL DEFAULT false,
  image_send boolean NOT NULL DEFAULT false,
  template boolean NOT NULL DEFAULT false,
  order_tracking boolean NOT NULL DEFAULT false,
  text_prompt text NULL,
  image_prompt text NULL,
  template_prompt_x1 text NULL,
  template_prompt_x2 text NULL,
  page_id text NULL,
  verified boolean NULL,
  block_emoji text NULL,
  unblock_emoji text NULL,
  check_conversion bigint NULL,
  CONSTRAINT fb_message_database_pkey PRIMARY KEY (id)
) TABLESPACE pg_default;
