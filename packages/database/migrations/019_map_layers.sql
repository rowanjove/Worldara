CREATE TABLE IF NOT EXISTS map_layers (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL,
  map_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  kind text NOT NULL CHECK (kind IN ('base', 'overlay', 'annotation')),
  sort_order integer NOT NULL DEFAULT 0,
  visible boolean NOT NULL DEFAULT true,
  opacity numeric NOT NULL DEFAULT 1 CHECK (opacity >= 0 AND opacity <= 1),
  style_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (world_id, id),
  UNIQUE (world_id, map_id, name),
  FOREIGN KEY (world_id, map_id) REFERENCES maps(world_id, id) ON DELETE CASCADE
);

-- Preserve the invariant that every map has a base layer, including maps
-- created before this migration was applied.
INSERT INTO map_layers (id, world_id, map_id, name, kind, sort_order, visible, opacity, style_json, created_at, updated_at)
SELECT gen_random_uuid(),
       m.world_id, m.id, 'Default', 'base', 0, true, 1, '{}', m.created_at, m.updated_at
FROM maps AS m
WHERE NOT EXISTS (
  SELECT 1 FROM map_layers AS existing
  WHERE existing.world_id = m.world_id AND existing.map_id = m.id
);

ALTER TABLE map_features ADD COLUMN IF NOT EXISTS layer_id uuid;
ALTER TABLE map_features DROP CONSTRAINT IF EXISTS map_features_layer_fk;
ALTER TABLE map_features ADD CONSTRAINT map_features_layer_fk
  FOREIGN KEY (world_id, layer_id) REFERENCES map_layers(world_id, id) ON DELETE SET NULL (layer_id);

CREATE INDEX IF NOT EXISTS map_layers_map_order_idx ON map_layers(world_id, map_id, sort_order, id);
CREATE INDEX IF NOT EXISTS map_features_layer_idx ON map_features(world_id, layer_id);
