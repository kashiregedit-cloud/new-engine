-- Create index for faster date filtering on fb_chats
CREATE INDEX IF NOT EXISTS idx_fb_chats_page_id_created_at ON fb_chats(page_id, created_at);

-- Create a function to get page stats efficiently
CREATE OR REPLACE FUNCTION get_page_stats(p_page_id text)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_tokens bigint;
  v_bot_replies bigint;
BEGIN
  -- Calculate total tokens
  SELECT COALESCE(SUM(token), 0)
  INTO v_total_tokens
  FROM fb_chats
  WHERE page_id = p_page_id;

  -- Calculate total bot replies
  SELECT COUNT(*)
  INTO v_bot_replies
  FROM fb_chats
  WHERE page_id = p_page_id
  AND reply_by = 'bot';

  RETURN json_build_object(
    'total_tokens', v_total_tokens,
    'bot_replies', v_bot_replies
  );
END;
$$;
