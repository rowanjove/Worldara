ALTER TABLE worlds ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;
CREATE INDEX IF NOT EXISTS worlds_archived_updated_idx ON worlds(archived_at, updated_at DESC, id);
