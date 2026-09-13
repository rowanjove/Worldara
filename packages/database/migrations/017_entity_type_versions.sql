CREATE TABLE IF NOT EXISTS entity_type_versions (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL,
  entity_type_id uuid NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  schema_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_revision bigint NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (world_id, id),
  UNIQUE (world_id, entity_type_id, schema_version),
  FOREIGN KEY (world_id, entity_type_id) REFERENCES entity_types(world_id, id) ON DELETE CASCADE
);

INSERT INTO entity_type_versions (id, world_id, entity_type_id, schema_version, schema_json, created_revision, created_at)
SELECT gen_random_uuid(), world_id, id, schema_version, schema_json, COALESCE(updated_revision, 1), updated_at
FROM entity_types
ON CONFLICT (world_id, entity_type_id, schema_version) DO NOTHING;

CREATE INDEX IF NOT EXISTS entity_type_versions_lookup_idx
  ON entity_type_versions(world_id, entity_type_id, schema_version);
