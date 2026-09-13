-- Preserve the provenance required by Snapshot/MCP responses.  Existing rows
-- remain valid with conservative defaults; event materialization fills the
-- source reference and creation revision for derived records.
ALTER TABLE facts ADD COLUMN IF NOT EXISTS source_ref_id uuid NULL;
ALTER TABLE facts ADD COLUMN IF NOT EXISTS retconned_revision bigint NULL;

ALTER TABLE relations ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'manual';
ALTER TABLE relations ADD COLUMN IF NOT EXISTS source_ref_id uuid NULL;
ALTER TABLE relations ADD COLUMN IF NOT EXISTS retconned_revision bigint NULL;
ALTER TABLE relations DROP CONSTRAINT IF EXISTS relations_source_kind_check;
ALTER TABLE relations ADD CONSTRAINT relations_source_kind_check CHECK (source_kind IN ('manual', 'ai', 'import', 'event'));

ALTER TABLE map_features ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'manual';
ALTER TABLE map_features ADD COLUMN IF NOT EXISTS source_ref_id uuid NULL;
ALTER TABLE map_features ADD COLUMN IF NOT EXISTS created_revision bigint NOT NULL DEFAULT 1;
ALTER TABLE map_features ADD COLUMN IF NOT EXISTS retconned_revision bigint NULL;
ALTER TABLE map_features DROP CONSTRAINT IF EXISTS map_features_source_kind_check;
ALTER TABLE map_features ADD CONSTRAINT map_features_source_kind_check CHECK (source_kind IN ('manual', 'ai', 'import', 'event'));

ALTER TABLE facts DROP CONSTRAINT IF EXISTS facts_source_event_fk;
ALTER TABLE facts ADD CONSTRAINT facts_source_event_fk
  FOREIGN KEY (world_id, source_ref_id)
  REFERENCES events(world_id, id)
  ON DELETE SET NULL (source_ref_id);

ALTER TABLE relations DROP CONSTRAINT IF EXISTS relations_source_event_fk;
ALTER TABLE relations ADD CONSTRAINT relations_source_event_fk
  FOREIGN KEY (world_id, source_ref_id)
  REFERENCES events(world_id, id)
  ON DELETE SET NULL (source_ref_id);

ALTER TABLE map_features DROP CONSTRAINT IF EXISTS map_features_source_event_fk;
ALTER TABLE map_features ADD CONSTRAINT map_features_source_event_fk
  FOREIGN KEY (world_id, source_ref_id)
  REFERENCES events(world_id, id)
  ON DELETE SET NULL (source_ref_id);

CREATE INDEX IF NOT EXISTS facts_source_revision_idx ON facts(world_id, created_revision, source_ref_id);
CREATE INDEX IF NOT EXISTS relations_source_revision_idx ON relations(world_id, created_revision, source_ref_id);
CREATE INDEX IF NOT EXISTS map_features_source_revision_idx ON map_features(world_id, created_revision, source_ref_id);
