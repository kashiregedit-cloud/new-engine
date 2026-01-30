-- Add page_id column to fb_order_tracking table
ALTER TABLE fb_order_tracking ADD COLUMN IF NOT EXISTS page_id text;

-- Create an index for faster filtering by page_id
CREATE INDEX IF NOT EXISTS idx_fb_order_tracking_page_id ON fb_order_tracking(page_id);
