
-- Add permissions column to team_members for granular access control
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'team_members' AND column_name = 'permissions') THEN
        ALTER TABLE team_members ADD COLUMN permissions JSONB DEFAULT NULL;
    END IF;
END $$;
