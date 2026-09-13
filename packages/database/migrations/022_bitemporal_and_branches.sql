CREATE TABLE IF NOT EXISTS timeline_branches (
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  parent_branch_id uuid NULL,
  fork_tick bigint NULL,
  fork_revision bigint NULL,
  status text NOT NULL DEFAULT 'main' CHECK (status IN ('main', 'sandbox', 'alternate', 'archived')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (world_id, id),
  UNIQUE (world_id, name),
  FOREIGN KEY (world_id, parent_branch_id) REFERENCES timeline_branches(world_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS timeline_branches_world_idx ON timeline_branches(world_id);

INSERT INTO timeline_branches (id, world_id, name, description, parent_branch_id, fork_tick, fork_revision, status, created_at, updated_at)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  id,
  'main',
  'Default main branch',
  NULL,
  NULL,
  0,
  'main',
  created_at,
  updated_at
FROM worlds
ON CONFLICT (world_id, id) DO NOTHING;

-- Facts
ALTER TABLE facts ADD COLUMN IF NOT EXISTS branch_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE facts ADD COLUMN IF NOT EXISTS revision_from bigint;
ALTER TABLE facts ADD COLUMN IF NOT EXISTS revision_to bigint;

UPDATE facts SET revision_from = created_revision WHERE revision_from IS NULL;
UPDATE facts SET revision_to = retconned_revision WHERE revision_to IS NULL AND retconned_revision IS NOT NULL;

ALTER TABLE facts ALTER COLUMN revision_from SET NOT NULL;
ALTER TABLE facts ALTER COLUMN revision_from SET DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'facts_branch_fk'
  ) THEN
    ALTER TABLE facts ADD CONSTRAINT facts_branch_fk FOREIGN KEY (world_id, branch_id) REFERENCES timeline_branches(world_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE facts DROP CONSTRAINT IF EXISTS facts_single_canon_temporal_value;
ALTER TABLE facts ADD CONSTRAINT facts_single_canon_temporal_value EXCLUDE USING gist (world_id WITH =, branch_id WITH =, subject_entity_id WITH =, predicate_key WITH =, valid_range WITH &&) WHERE (canon_status = 'canon');

CREATE INDEX IF NOT EXISTS facts_branch_revision_idx ON facts(world_id, branch_id, revision_from, revision_to);

-- Relations
ALTER TABLE relations ADD COLUMN IF NOT EXISTS branch_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE relations ADD COLUMN IF NOT EXISTS revision_from bigint;
ALTER TABLE relations ADD COLUMN IF NOT EXISTS revision_to bigint;

UPDATE relations SET revision_from = created_revision WHERE revision_from IS NULL;
UPDATE relations SET revision_to = retconned_revision WHERE revision_to IS NULL AND retconned_revision IS NOT NULL;

ALTER TABLE relations ALTER COLUMN revision_from SET NOT NULL;
ALTER TABLE relations ALTER COLUMN revision_from SET DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'relations_branch_fk'
  ) THEN
    ALTER TABLE relations ADD CONSTRAINT relations_branch_fk FOREIGN KEY (world_id, branch_id) REFERENCES timeline_branches(world_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS relations_branch_revision_idx ON relations(world_id, branch_id, revision_from, revision_to);

-- Events
ALTER TABLE events ADD COLUMN IF NOT EXISTS branch_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_branch_fk'
  ) THEN
    ALTER TABLE events ADD CONSTRAINT events_branch_fk FOREIGN KEY (world_id, branch_id) REFERENCES timeline_branches(world_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS events_branch_idx ON events(world_id, branch_id);

-- Map Features
ALTER TABLE map_features ADD COLUMN IF NOT EXISTS branch_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE map_features ADD COLUMN IF NOT EXISTS revision_from bigint;
ALTER TABLE map_features ADD COLUMN IF NOT EXISTS revision_to bigint;

UPDATE map_features SET revision_from = created_revision WHERE revision_from IS NULL;
UPDATE map_features SET revision_to = retconned_revision WHERE revision_to IS NULL AND retconned_revision IS NOT NULL;

ALTER TABLE map_features ALTER COLUMN revision_from SET NOT NULL;
ALTER TABLE map_features ALTER COLUMN revision_from SET DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'map_features_branch_fk'
  ) THEN
    ALTER TABLE map_features ADD CONSTRAINT map_features_branch_fk FOREIGN KEY (world_id, branch_id) REFERENCES timeline_branches(world_id, id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS map_features_branch_revision_idx ON map_features(world_id, branch_id, revision_from, revision_to);
