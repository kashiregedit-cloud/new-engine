# Coolify Domain Setup Guide

## Problem
You have set up `https://www.salesmanchatbot.online` but `https://salesmanchatbot.online` (without www) is not working.

## Solution

1. **Login to Coolify**
   - Go to your Coolify Dashboard.
   - Select your Project -> Select the Resource (the Application/Service for your website).

2. **Update Domains Configuration**
   - Find the **Domains** (or "URL") field in the "General" or "Configuration" tab.
   - Currently, it probably looks like this:
     ```
     https://www.salesmanchatbot.online
     ```
   - Change it to include BOTH domains (separated by a comma):
     ```
     https://salesmanchatbot.online,https://www.salesmanchatbot.online
     ```
   - Click **Save**.
   - Click **Redeploy** (or Restart) to apply the changes.

3. **Check DNS (Cloudflare/Namecheap/Godaddy)**
   - Ensure you have an **A Record** for `@` (root) pointing to your Coolify Server IP.
   - (You likely already have the CNAME/A record for `www`, just make sure the root `@` is also pointing to the same IP).

## Shared Credit Logic Update (Database)

To enable "One Credit Balance for All Pages" (Gmail Account Deduction), you must run the following SQL in your **Supabase SQL Editor**:

1. Open Supabase Dashboard.
2. Go to **SQL Editor**.
3. Create a new query.
4. Copy-paste the content of the file: `backend/schema_deduct_credits.sql`
5. Click **Run**.

Once run, the system will automatically deduct credits from your main Account Balance instead of individual Page Balances.
