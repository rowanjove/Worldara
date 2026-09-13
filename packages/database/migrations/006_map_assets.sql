CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  storage_key text NOT NULL,
  media_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  sha256 text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  UNIQUE (world_id, storage_key),
  UNIQUE (world_id, sha256)
);

CREATE TABLE IF NOT EXISTS maps (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name text NOT NULL,
  crs text NOT NULL DEFAULT 'CRS.Simple',
  width numeric NOT NULL CHECK (width > 0),
  height numeric NOT NULL CHECK (height > 0),
  asset_id uuid NULL REFERENCES assets(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (world_id, id)
);

CREATE TABLE IF NOT EXISTS map_features (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL,
  map_id uuid NOT NULL,
  entity_id uuid NULL,
  kind text NOT NULL CHECK (kind IN ('marker', 'polygon', 'polyline', 'label')),
  geometry_json jsonb NOT NULL,
  properties_json jsonb NOT NULL DEFAULT '{}',
  valid_range int8range NOT NULL DEFAULT '[,)'::int8range,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (world_id, id),
  FOREIGN KEY (world_id, map_id) REFERENCES maps(world_id, id) ON DELETE CASCADE,
  FOREIGN KEY (world_id, entity_id) REFERENCES entities(world_id, id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS map_features_map_idx ON map_features(world_id, map_id);
ALTER TABLE map_features DROP CONSTRAINT IF EXISTS map_features_non_empty_range;
ALTER TABLE map_features ADD CONSTRAINT map_features_non_empty_range CHECK (valid_range <> 'empty'::int8range);
