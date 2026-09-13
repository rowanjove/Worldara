CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worlds (
  id uuid PRIMARY KEY,
  owner_id uuid NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9一-鿿]+(?:-[a-z0-9一-鿿]+)*$'),
  description text NOT NULL DEFAULT '',
  genre text NOT NULL DEFAULT 'Custom',
  canon_strategy text NOT NULL DEFAULT 'strict' CHECK (canon_strategy IN ('strict', 'lenient')),
  current_tick bigint NOT NULL DEFAULT 0,
  revision_seq bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS entity_types (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  type_key text NOT NULL,
  label text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  schema_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision bigint NOT NULL DEFAULT 1,
  created_revision bigint NOT NULL DEFAULT 1,
  updated_revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (world_id, id),
  UNIQUE (world_id, type_key)
);

CREATE TABLE IF NOT EXISTS entities (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL,
  type_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  subtitle text NOT NULL DEFAULT '',
  parent_entity_id uuid NULL,
  document_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  document_text text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  canon_status text NOT NULL DEFAULT 'draft' CHECK (canon_status IN ('draft', 'pending', 'canon', 'retconned', 'archived')),
  revision bigint NOT NULL DEFAULT 1,
  created_revision bigint NOT NULL,
  updated_revision bigint NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (world_id, id),
  FOREIGN KEY (world_id, type_id) REFERENCES entity_types(world_id, id),
  FOREIGN KEY (world_id, parent_entity_id) REFERENCES entities(world_id, id)
);

CREATE TABLE IF NOT EXISTS revisions (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL,
  sequence bigint NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('user', 'ai', 'import', 'system')),
  source_kind text NOT NULL,
  reason text NOT NULL DEFAULT '',
  change_set_hash text NOT NULL,
  recorded_at timestamptz NOT NULL,
  UNIQUE (world_id, id),
  UNIQUE (world_id, sequence),
  FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS change_records (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('create', 'update', 'delete', 'retcon')),
  patch_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (world_id, revision_id) REFERENCES revisions(world_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  world_id uuid NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, key),
  FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS entities_world_type_status_idx ON entities(world_id, type_id, canon_status);
CREATE INDEX IF NOT EXISTS entities_world_updated_idx ON entities(world_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS entities_world_parent_idx ON entities(world_id, parent_entity_id);
CREATE INDEX IF NOT EXISTS revisions_world_sequence_idx ON revisions(world_id, sequence DESC);

INSERT INTO schema_migrations(version)
VALUES ('001_initial')
ON CONFLICT (version) DO NOTHING;
