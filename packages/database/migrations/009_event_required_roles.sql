ALTER TABLE events ADD COLUMN IF NOT EXISTS required_roles text[] NOT NULL DEFAULT '{}';
