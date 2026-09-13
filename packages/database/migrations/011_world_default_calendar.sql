ALTER TABLE worlds ADD COLUMN IF NOT EXISTS default_calendar_version_id uuid NULL;

ALTER TABLE worlds DROP CONSTRAINT IF EXISTS worlds_default_calendar_version_fk;
ALTER TABLE worlds ADD CONSTRAINT worlds_default_calendar_version_fk
  FOREIGN KEY (id, default_calendar_version_id)
  REFERENCES calendar_versions(world_id, id)
  ON DELETE SET NULL (default_calendar_version_id);

CREATE INDEX IF NOT EXISTS worlds_default_calendar_version_idx
  ON worlds(default_calendar_version_id)
  WHERE default_calendar_version_id IS NOT NULL;

INSERT INTO schema_migrations(version)
VALUES ('011_world_default_calendar')
ON CONFLICT (version) DO NOTHING;
