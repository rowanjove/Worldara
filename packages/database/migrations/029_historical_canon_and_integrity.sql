-- Historical Canon state, event compensation data, atomic operation claims,
-- and world-scoped foreign-key defense in depth.

ALTER TABLE entities ADD COLUMN IF NOT EXISTS pending_revision bigint NULL;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS canon_revision bigint NULL;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS retconned_revision bigint NULL;
ALTER TABLE entities ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'manual';
ALTER TABLE entities ADD COLUMN IF NOT EXISTS source_ref_id uuid NULL;
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_source_kind_check;
ALTER TABLE entities ADD CONSTRAINT entities_source_kind_check CHECK (source_kind IN ('manual', 'ai', 'import', 'event'));
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_source_event_fk;
ALTER TABLE entities ADD CONSTRAINT entities_source_event_fk
  FOREIGN KEY (world_id, source_ref_id) REFERENCES events(world_id, id) ON DELETE SET NULL (source_ref_id);

ALTER TABLE facts ADD COLUMN IF NOT EXISTS pending_revision bigint NULL;
ALTER TABLE facts ADD COLUMN IF NOT EXISTS canon_revision bigint NULL;
ALTER TABLE relations ADD COLUMN IF NOT EXISTS pending_revision bigint NULL;
ALTER TABLE relations ADD COLUMN IF NOT EXISTS canon_revision bigint NULL;
ALTER TABLE map_features ADD COLUMN IF NOT EXISTS pending_revision bigint NULL;
ALTER TABLE map_features ADD COLUMN IF NOT EXISTS canon_revision bigint NULL;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS pending_revision bigint NULL;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS canon_revision bigint NULL;

ALTER TABLE events ADD COLUMN IF NOT EXISTS pending_revision bigint NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS canon_revision bigint NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS retconned_revision bigint NULL;

CREATE TABLE IF NOT EXISTS entity_snapshot_versions (
  world_id uuid NOT NULL,
  id uuid NOT NULL,
  revision_from bigint NOT NULL,
  revision_to bigint NULL,
  type_id uuid NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  name text NOT NULL,
  subtitle text NOT NULL DEFAULT '',
  parent_entity_id uuid NULL,
  document_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_text text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  canon_status text NOT NULL,
  revision bigint NOT NULL,
  created_revision bigint NULL,
  pending_revision bigint NULL,
  canon_revision bigint NULL,
  retconned_revision bigint NULL,
  source_kind text NOT NULL DEFAULT 'manual',
  source_ref_id uuid NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (world_id, id, revision_from),
  FOREIGN KEY (world_id, id) REFERENCES entities(world_id, id) ON DELETE CASCADE,
  FOREIGN KEY (world_id, type_id) REFERENCES entity_types(world_id, id),
  FOREIGN KEY (world_id, parent_entity_id) REFERENCES entities(world_id, id),
  FOREIGN KEY (world_id, source_ref_id) REFERENCES events(world_id, id) ON DELETE SET NULL (source_ref_id),
  CHECK (revision_to IS NULL OR revision_to > revision_from),
  CHECK (source_kind IN ('manual', 'ai', 'import', 'event'))
);
CREATE INDEX IF NOT EXISTS entity_snapshot_versions_lookup_idx
  ON entity_snapshot_versions(world_id, id, revision_from DESC, revision_to);

INSERT INTO entity_snapshot_versions(
  world_id,id,revision_from,revision_to,type_id,schema_version,name,subtitle,parent_entity_id,
  document_json,document_text,tags,canon_status,revision,created_revision,created_at,updated_at
)
SELECT
  world_id,id,GREATEST(revision,1),NULL,type_id,schema_version,name,subtitle,parent_entity_id,
  document_json,document_text,tags,canon_status,revision,revision,created_at,updated_at
FROM entity_snapshot_bases
ON CONFLICT (world_id,id,revision_from) DO NOTHING;

CREATE TABLE IF NOT EXISTS event_materialization_backups (
  world_id uuid NOT NULL,
  event_id uuid NOT NULL,
  entities_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  facts_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  relations_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  map_features_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, event_id),
  FOREIGN KEY (world_id, event_id) REFERENCES events(world_id, id) ON DELETE CASCADE
);

ALTER TABLE operation_idempotency_keys ALTER COLUMN response_json DROP NOT NULL;
ALTER TABLE operation_idempotency_keys ALTER COLUMN status_code DROP NOT NULL;
ALTER TABLE operation_idempotency_keys ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'completed';
ALTER TABLE operation_idempotency_keys ADD COLUMN IF NOT EXISTS lease_until timestamptz NULL;
ALTER TABLE operation_idempotency_keys DROP CONSTRAINT IF EXISTS operation_idempotency_state_check;
ALTER TABLE operation_idempotency_keys ADD CONSTRAINT operation_idempotency_state_check CHECK (state IN ('inflight', 'completed'));
CREATE INDEX IF NOT EXISTS operation_idempotency_lease_idx ON operation_idempotency_keys(state, lease_until);

-- Replace single-column narrative references with same-world composite keys.
ALTER TABLE works ADD CONSTRAINT works_world_id_key UNIQUE (world_id, id);
ALTER TABLE chapters ADD CONSTRAINT chapters_world_id_key UNIQUE (world_id, id);
ALTER TABLE plotlines ADD CONSTRAINT plotlines_world_id_key UNIQUE (world_id, id);
ALTER TABLE scenes ADD CONSTRAINT scenes_world_id_key UNIQUE (world_id, id);

ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_subject_entity_id_fkey;
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_object_entity_id_fkey;
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_asserted_by_entity_id_fkey;
ALTER TABLE claims ADD CONSTRAINT claims_subject_world_fk FOREIGN KEY (world_id, subject_entity_id) REFERENCES entities(world_id, id) ON DELETE SET NULL (subject_entity_id);
ALTER TABLE claims ADD CONSTRAINT claims_object_world_fk FOREIGN KEY (world_id, object_entity_id) REFERENCES entities(world_id, id) ON DELETE SET NULL (object_entity_id);
ALTER TABLE claims ADD CONSTRAINT claims_asserted_by_world_fk FOREIGN KEY (world_id, asserted_by_entity_id) REFERENCES entities(world_id, id) ON DELETE SET NULL (asserted_by_entity_id);

ALTER TABLE chapters DROP CONSTRAINT IF EXISTS chapters_work_id_fkey;
ALTER TABLE chapters ADD CONSTRAINT chapters_work_world_fk FOREIGN KEY (world_id, work_id) REFERENCES works(world_id, id) ON DELETE CASCADE;
ALTER TABLE scenes DROP CONSTRAINT IF EXISTS scenes_work_id_fkey;
ALTER TABLE scenes DROP CONSTRAINT IF EXISTS scenes_chapter_id_fkey;
ALTER TABLE scenes ADD CONSTRAINT scenes_work_world_fk FOREIGN KEY (world_id, work_id) REFERENCES works(world_id, id) ON DELETE CASCADE;
ALTER TABLE scenes ADD CONSTRAINT scenes_chapter_world_fk FOREIGN KEY (world_id, chapter_id) REFERENCES chapters(world_id, id) ON DELETE CASCADE;
ALTER TABLE scenes DROP CONSTRAINT IF EXISTS scenes_pov_character_id_fkey;
ALTER TABLE scenes DROP CONSTRAINT IF EXISTS scenes_location_entity_id_fkey;
ALTER TABLE scenes ADD CONSTRAINT scenes_pov_world_fk FOREIGN KEY (world_id, pov_character_id) REFERENCES entities(world_id, id) ON DELETE SET NULL (pov_character_id);
ALTER TABLE scenes ADD CONSTRAINT scenes_location_world_fk FOREIGN KEY (world_id, location_entity_id) REFERENCES entities(world_id, id) ON DELETE SET NULL (location_entity_id);

ALTER TABLE foreshadowings DROP CONSTRAINT IF EXISTS foreshadowings_setup_scene_id_fkey;
ALTER TABLE foreshadowings DROP CONSTRAINT IF EXISTS foreshadowings_payoff_scene_id_fkey;
ALTER TABLE foreshadowings DROP CONSTRAINT IF EXISTS foreshadowings_plotline_id_fkey;
ALTER TABLE foreshadowings ADD CONSTRAINT foreshadowings_setup_scene_world_fk FOREIGN KEY (world_id, setup_scene_id) REFERENCES scenes(world_id, id) ON DELETE CASCADE;
ALTER TABLE foreshadowings ADD CONSTRAINT foreshadowings_payoff_scene_world_fk FOREIGN KEY (world_id, payoff_scene_id) REFERENCES scenes(world_id, id) ON DELETE SET NULL (payoff_scene_id);
ALTER TABLE foreshadowings ADD CONSTRAINT foreshadowings_plotline_world_fk FOREIGN KEY (world_id, plotline_id) REFERENCES plotlines(world_id, id) ON DELETE SET NULL (plotline_id);

CREATE OR REPLACE FUNCTION world_codex_validate_reference_arrays() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'claims' AND EXISTS (
    SELECT 1 FROM unnest(NEW.known_by_entity_ids) AS ref(id)
    LEFT JOIN entities e ON e.world_id = NEW.world_id AND e.id = ref.id
    WHERE e.id IS NULL
  ) THEN RAISE EXCEPTION 'known_by_entity_ids must reference entities in the same world'; END IF;
  IF TG_TABLE_NAME = 'scenes' AND EXISTS (
    SELECT 1 FROM unnest(NEW.participant_entity_ids) AS ref(id)
    LEFT JOIN entities e ON e.world_id = NEW.world_id AND e.id = ref.id
    WHERE e.id IS NULL
  ) THEN RAISE EXCEPTION 'participant_entity_ids must reference entities in the same world'; END IF;
  IF TG_TABLE_NAME = 'scenes' AND EXISTS (
    SELECT 1 FROM unnest(NEW.plotline_ids) AS ref(id)
    LEFT JOIN plotlines p ON p.world_id = NEW.world_id AND p.id = ref.id
    WHERE p.id IS NULL
  ) THEN RAISE EXCEPTION 'plotline_ids must reference plotlines in the same world'; END IF;
  IF TG_TABLE_NAME = 'plotlines' AND EXISTS (
    SELECT 1 FROM unnest(NEW.character_entity_ids) AS ref(id)
    LEFT JOIN entities e ON e.world_id = NEW.world_id AND e.id = ref.id
    WHERE e.id IS NULL
  ) THEN RAISE EXCEPTION 'character_entity_ids must reference entities in the same world'; END IF;
  IF TG_TABLE_NAME = 'plotlines' AND EXISTS (
    SELECT 1 FROM unnest(NEW.event_ids) AS ref(id)
    LEFT JOIN events e ON e.world_id = NEW.world_id AND e.id = ref.id
    WHERE e.id IS NULL
  ) THEN RAISE EXCEPTION 'event_ids must reference events in the same world'; END IF;
  IF TG_TABLE_NAME = 'foreshadowings' AND EXISTS (
    SELECT 1 FROM unnest(NEW.related_entity_ids) AS ref(id)
    LEFT JOIN entities e ON e.world_id = NEW.world_id AND e.id = ref.id
    WHERE e.id IS NULL
  ) THEN RAISE EXCEPTION 'related_entity_ids must reference entities in the same world'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS claims_reference_arrays_trigger ON claims;
CREATE CONSTRAINT TRIGGER claims_reference_arrays_trigger AFTER INSERT OR UPDATE OF known_by_entity_ids,world_id ON claims DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION world_codex_validate_reference_arrays();
DROP TRIGGER IF EXISTS scenes_reference_arrays_trigger ON scenes;
CREATE CONSTRAINT TRIGGER scenes_reference_arrays_trigger AFTER INSERT OR UPDATE OF participant_entity_ids,plotline_ids,world_id ON scenes DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION world_codex_validate_reference_arrays();
DROP TRIGGER IF EXISTS plotlines_reference_arrays_trigger ON plotlines;
CREATE CONSTRAINT TRIGGER plotlines_reference_arrays_trigger AFTER INSERT OR UPDATE OF character_entity_ids,event_ids,world_id ON plotlines DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION world_codex_validate_reference_arrays();
DROP TRIGGER IF EXISTS foreshadowings_reference_arrays_trigger ON foreshadowings;
CREATE CONSTRAINT TRIGGER foreshadowings_reference_arrays_trigger AFTER INSERT OR UPDATE OF related_entity_ids,world_id ON foreshadowings DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION world_codex_validate_reference_arrays();
