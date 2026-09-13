CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS calendars (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name text NOT NULL,
  current_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (world_id, id)
);

CREATE TABLE IF NOT EXISTS calendar_versions (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL,
  calendar_id uuid NOT NULL,
  version integer NOT NULL,
  definition_json jsonb NOT NULL,
  created_revision bigint NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (world_id, id),
  UNIQUE (world_id, calendar_id, version),
  FOREIGN KEY (world_id, calendar_id) REFERENCES calendars(world_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS relation_types (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  forward_label text NOT NULL,
  inverse_label text NOT NULL,
  symmetric boolean NOT NULL DEFAULT false,
  source_type_ids uuid[] NOT NULL DEFAULT '{}',
  target_type_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (world_id, id)
);

CREATE TABLE IF NOT EXISTS facts (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL,
  subject_entity_id uuid NOT NULL,
  predicate_key text NOT NULL,
  object_kind text NOT NULL CHECK (object_kind IN ('scalar', 'entity', 'json')),
  value_json jsonb NULL,
  object_entity_id uuid NULL,
  valid_range int8range NOT NULL DEFAULT '[,)'::int8range,
  canon_status text NOT NULL DEFAULT 'draft' CHECK (canon_status IN ('draft', 'pending', 'canon', 'retconned', 'archived')),
  source_kind text NOT NULL CHECK (source_kind IN ('manual', 'ai', 'import', 'event')),
  created_revision bigint NOT NULL,
  retconned_revision bigint NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (world_id, id),
  FOREIGN KEY (world_id, subject_entity_id) REFERENCES entities(world_id, id) ON DELETE CASCADE,
  FOREIGN KEY (world_id, object_entity_id) REFERENCES entities(world_id, id),
  CHECK ((object_kind = 'entity' AND object_entity_id IS NOT NULL AND value_json IS NULL) OR (object_kind <> 'entity' AND object_entity_id IS NULL AND value_json IS NOT NULL))
);

ALTER TABLE facts DROP CONSTRAINT IF EXISTS facts_single_canon_temporal_value;
ALTER TABLE facts ADD CONSTRAINT facts_single_canon_temporal_value EXCLUDE USING gist (world_id WITH =, subject_entity_id WITH =, predicate_key WITH =, valid_range WITH &&) WHERE (canon_status = 'canon');

CREATE INDEX IF NOT EXISTS facts_subject_time_idx ON facts USING gist (world_id, subject_entity_id, valid_range);
CREATE INDEX IF NOT EXISTS facts_predicate_idx ON facts(world_id, predicate_key, canon_status);

CREATE TABLE IF NOT EXISTS relations (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL,
  source_entity_id uuid NOT NULL,
  target_entity_id uuid NOT NULL,
  relation_type_id uuid NOT NULL,
  valid_range int8range NOT NULL DEFAULT '[,)'::int8range,
  description text NOT NULL DEFAULT '',
  canon_status text NOT NULL DEFAULT 'draft' CHECK (canon_status IN ('draft', 'pending', 'canon', 'retconned', 'archived')),
  created_revision bigint NOT NULL,
  retconned_revision bigint NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (world_id, id),
  FOREIGN KEY (world_id, source_entity_id) REFERENCES entities(world_id, id) ON DELETE CASCADE,
  FOREIGN KEY (world_id, target_entity_id) REFERENCES entities(world_id, id) ON DELETE CASCADE,
  FOREIGN KEY (world_id, relation_type_id) REFERENCES relation_types(world_id, id) ON DELETE RESTRICT,
  CHECK (source_entity_id <> target_entity_id)
);

CREATE INDEX IF NOT EXISTS relations_source_idx ON relations(world_id, source_entity_id);
CREATE INDEX IF NOT EXISTS relations_target_idx ON relations(world_id, target_entity_id);
CREATE INDEX IF NOT EXISTS relations_time_idx ON relations USING gist (world_id, valid_range);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name text NOT NULL,
  event_type text NOT NULL,
  start_tick bigint NOT NULL,
  end_tick bigint NULL,
  description text NOT NULL DEFAULT '',
  importance text NOT NULL DEFAULT 'normal' CHECK (importance IN ('minor', 'normal', 'major', 'epochal')),
  canon_status text NOT NULL DEFAULT 'draft' CHECK (canon_status IN ('draft', 'pending', 'canon', 'retconned', 'archived')),
  created_revision bigint NOT NULL,
  created_at timestamptz NOT NULL,
  CHECK (end_tick IS NULL OR end_tick >= start_tick),
  UNIQUE (world_id, id)
);

CREATE TABLE IF NOT EXISTS event_participants (
  world_id uuid NOT NULL,
  event_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'participant',
  PRIMARY KEY (world_id, event_id, entity_id, role),
  FOREIGN KEY (world_id, event_id) REFERENCES events(world_id, id) ON DELETE CASCADE,
  FOREIGN KEY (world_id, entity_id) REFERENCES entities(world_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_locations (
  world_id uuid NOT NULL,
  event_id uuid NOT NULL,
  entity_id uuid NOT NULL,
  PRIMARY KEY (world_id, event_id, entity_id),
  FOREIGN KEY (world_id, event_id) REFERENCES events(world_id, id) ON DELETE CASCADE,
  FOREIGN KEY (world_id, entity_id) REFERENCES entities(world_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS event_effects (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL,
  event_id uuid NOT NULL,
  effect_type text NOT NULL,
  target_id uuid NULL,
  payload_json jsonb NOT NULL DEFAULT '{}',
  sequence integer NOT NULL,
  applied_revision bigint NULL,
  UNIQUE (world_id, id),
  UNIQUE (world_id, event_id, sequence),
  FOREIGN KEY (world_id, event_id) REFERENCES events(world_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS validation_runs (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  target_type text NOT NULL,
  target_id uuid NULL,
  candidate_hash text NOT NULL,
  ruleset_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'passed', 'failed')),
  created_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  UNIQUE (world_id, id)
);

CREATE TABLE IF NOT EXISTS validation_issues (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL,
  validation_run_id uuid NOT NULL,
  rule_code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'suggestion', 'warning', 'error', 'blocker')),
  subject_id uuid NULL,
  related_ids uuid[] NOT NULL DEFAULT '{}',
  event_id uuid NULL,
  message text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'waived', 'resolved')),
  FOREIGN KEY (world_id, validation_run_id) REFERENCES validation_runs(world_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS events_timeline_idx ON events(world_id, start_tick, end_tick);
