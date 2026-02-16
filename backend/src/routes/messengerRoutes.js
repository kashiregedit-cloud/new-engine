const express = require('express');
const router = express.Router();
const dbService = require('../services/dbService');

// Get Messenger Pages (Merged with Team Permissions)
router.get('/pages', async (req, res) => {
    try {
        // 1. Auth Check
        const authHeader = req.headers.authorization;
        let userId = null;
        let userEmail = null;
        
        if (authHeader) {
            const token = authHeader.replace('Bearer ', '');
            const { data: { user }, error } = await dbService.supabase.auth.getUser(token);
            if (user) {
                userId = user.id;
                userEmail = user.email;
            }
        }

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // 2. Fetch User's Own Pages
        // We use Service Role via dbService to bypass RLS, but we filter by ownership
        const { data: myPages, error: myError } = await dbService.supabase
            .from('page_access_token_message')
            .select('*')
            .eq('email', userEmail); // Assuming email is the owner identifier

        if (myError) throw myError;

        // 3. Fetch Shared Pages (Team Members)
        let sharedPageIds = [];
        if (userEmail) {
            const { data: teamData, error: teamError } = await dbService.supabase
                .from('team_members')
                .select('permissions, owner_email')
                .eq('member_email', userEmail)
                .eq('status', 'active'); // Use 'active' as per schema (was 'accepted' in WAHA code, but schema says 'active')
            
            if (!teamError && teamData) {
                teamData.forEach(row => {
                    // Check permissions.fb_pages
                    if (row.permissions && row.permissions.fb_pages) {
                        const pages = row.permissions.fb_pages;
                        if (Array.isArray(pages)) {
                            // Convert all to string to be safe
                            sharedPageIds.push(...pages.map(id => String(id)));
                        }
                    }
                });
            }
        }

        let sharedPages = [];
        if (sharedPageIds.length > 0) {
            const { data: sharedData, error: sharedError } = await dbService.supabase
                .from('page_access_token_message')
                .select('*')
                .in('page_id', sharedPageIds);
            
            if (!sharedError && sharedData) {
                sharedPages = sharedData;
            }
        }

        // 4. Combine
        const allPages = [...(myPages || []), ...sharedPages];
        
        // Deduplicate by page_id
        const uniquePages = Array.from(new Map(allPages.map(item => [item.page_id, item])).values());

        // 5. Fetch Additional DB Info (fb_message_database)
        const allPageIds = uniquePages.map(p => p.page_id);
        let dbConfigs = [];
        
        if (allPageIds.length > 0) {
            const { data: dbData, error: dbError } = await dbService.supabase
                .from('fb_message_database')
                .select('*')
                .in('page_id', allPageIds);
            
            if (!dbError && dbData) {
                dbConfigs = dbData;
            }
        }

        // 6. Merge and Enhance
        const finalPages = uniquePages.map(p => {
            const dbInfo = dbConfigs.find(d => d.page_id === p.page_id);
            // Prioritize page info, merge dbInfo (which has text_prompt, etc.)
            // Note: dbInfo might overwrite some fields if names collide, but usually they are distinct enough
            // page_access_token_message has: page_id, name, email, etc.
            // fb_message_database has: id (pk), page_id, text_prompt
            return {
                ...p,
                ...(dbInfo || {}), // Merge DB info
                is_shared: p.email !== userEmail
            };
        });

        res.json(finalPages);

    } catch (error) {
        console.error("Error fetching Messenger pages:", error);
        res.status(500).json({ error: error.message });
    }
});

// Get Messenger Config (Owner or Team Member with Access)
router.get('/config/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error } = await dbService.supabase.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        const userEmail = user.email;

        const { data: configRow, error: cfgError } = await dbService.supabase
            .from('fb_message_database')
            .select('*')
            .eq('id', parseInt(id, 10))
            .single();

        if (cfgError || !configRow) {
            return res.status(404).json({ error: 'Config not found' });
        }

        const pageId = configRow.page_id;

        const { data: pageRow, error: pageError } = await dbService.supabase
            .from('page_access_token_message')
            .select('page_id, email')
            .eq('page_id', pageId)
            .maybeSingle();

        if (pageError) {
            return res.status(500).json({ error: pageError.message });
        }

        let allowed = false;

        if (pageRow && pageRow.email === userEmail) {
            allowed = true;
        }

        if (!allowed && userEmail) {
            const { data: teamData, error: teamError } = await dbService.supabase
                .from('team_members')
                .select('permissions')
                .eq('member_email', userEmail)
                .eq('status', 'active');

            if (!teamError && teamData) {
                for (const t of teamData) {
                    const pages = t.permissions && Array.isArray(t.permissions.fb_pages)
                        ? t.permissions.fb_pages
                        : [];
                    if (pages.map(String).includes(String(pageId))) {
                        allowed = true;
                        break;
                    }
                }
            }
        }

        if (!allowed) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        res.json(configRow);
    } catch (error) {
        console.error("Error fetching Messenger config:", error);
        res.status(500).json({ error: error.message });
    }
});

// Update Messenger Config (Owner or Team Member with Access)
router.put('/config/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error } = await dbService.supabase.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        const userEmail = user.email;

        const { data: configRow, error: cfgError } = await dbService.supabase
            .from('fb_message_database')
            .select('*')
            .eq('id', parseInt(id, 10))
            .single();

        if (cfgError || !configRow) {
            return res.status(404).json({ error: 'Config not found' });
        }

        const pageId = configRow.page_id;

        const { data: pageRow, error: pageError } = await dbService.supabase
            .from('page_access_token_message')
            .select('page_id, email')
            .eq('page_id', pageId)
            .maybeSingle();

        if (pageError) {
            return res.status(500).json({ error: pageError.message });
        }

        let allowed = false;

        if (pageRow && pageRow.email === userEmail) {
            allowed = true;
        }

        if (!allowed && userEmail) {
            const { data: teamData, error: teamError } = await dbService.supabase
                .from('team_members')
                .select('permissions')
                .eq('member_email', userEmail)
                .eq('status', 'active');

            if (!teamError && teamData) {
                for (const t of teamData) {
                    const pages = t.permissions && Array.isArray(t.permissions.fb_pages)
                        ? t.permissions.fb_pages
                        : [];
                    if (pages.map(String).includes(String(pageId))) {
                        allowed = true;
                        break;
                    }
                }
            }
        }

        if (!allowed) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const allowedKeys = [
            'reply_message',
            'swipe_reply',
            'image_detection',
            'image_send',
            'template',
            'order_tracking',
            'block_emoji',
            'unblock_emoji',
            'check_conversion',
            'text_prompt',
            'image_prompt'
        ];

        const updates = {};
        for (const key of allowedKeys) {
            if (Object.prototype.hasOwnProperty.call(req.body, key)) {
                updates[key] = req.body[key];
            }
        }

        const { data: updated, error: updateError } = await dbService.supabase
            .from('fb_message_database')
            .update(updates)
            .eq('id', parseInt(id, 10))
            .select()
            .single();

        if (updateError) {
            return res.status(500).json({ error: updateError.message });
        }

        res.json(updated);
    } catch (error) {
        console.error("Error updating Messenger config:", error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
