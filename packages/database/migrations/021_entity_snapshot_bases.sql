CREATE TABLE IF NOT EXISTS entity_snapshot_bases (
  world_id uuid NOT NULL,
  id uuid NOT NULL,
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
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (world_id, id),
  FOREIGN KEY (world_id, id) REFERENCES entities(world_id, id) ON DELETE CASCADE
);

INSERT INTO entity_snapshot_bases(world_id,id,type_id,schema_version,name,subtitle,parent_entity_id,document_json,document_text,tags,canon_status,revision,created_at,updated_at)
SELECT world_id,id,type_id,schema_version,name,subtitle,parent_entity_id,document_json,document_text,tags,canon_status,revision,created_at,updated_at FROM entities
ON CONFLICT (world_id,id) DO NOTHING;
