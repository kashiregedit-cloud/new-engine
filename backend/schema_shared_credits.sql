-- ==========================================
-- SHARED CREDIT SYSTEM (RPC Function)
-- ==========================================
-- This function allows multiple pages owned by the same user to share a single credit pool.
-- Run this in your Supabase SQL Editor.

CREATE OR REPLACE FUNCTION deduct_credits_via_page(p_page_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id uuid;
    v_user_credit int;
    v_page_credit int;
BEGIN
    -- 1. Find the owner (user_id) of the page
    SELECT user_id, message_credit INTO v_user_id, v_page_credit
    FROM public.page_access_token_message
    WHERE page_id = p_page_id;

    -- If page not found, return false
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- 2. Check User-Level Credit (Priority)
    IF v_user_id IS NOT NULL THEN
        SELECT message_credit INTO v_user_credit
        FROM public.user_configs
        WHERE user_id = v_user_id;

        -- If user has credit, deduct from user
        IF v_user_credit > 0 THEN
            UPDATE public.user_configs
            SET message_credit = v_user_credit - 1
            WHERE user_id = v_user_id;
            RETURN true;
        END IF;
    END IF;

    -- 3. Fallback: Check Page-Level Credit
    IF v_page_credit > 0 THEN
        UPDATE public.page_access_token_message
        SET message_credit = v_page_credit - 1
        WHERE page_id = p_page_id;
        RETURN true;
    END IF;

    -- 4. No credits available
    RETURN false;
END;
$$;
