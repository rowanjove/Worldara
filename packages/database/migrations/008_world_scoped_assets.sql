-- A map must never reference an asset owned by another world.  The original
-- asset_id-only foreign key enforced existence, but not the world boundary.
-- Add the composite key and replace it with a world-scoped foreign key.
ALTER TABLE assets
  ADD CONSTRAINT assets_world_id_id_key UNIQUE (world_id, id);

ALTER TABLE maps
  DROP CONSTRAINT IF EXISTS maps_asset_id_fkey;

ALTER TABLE maps
  ADD CONSTRAINT maps_world_asset_fk
  FOREIGN KEY (world_id, asset_id)
  REFERENCES assets (world_id, id)
  ON DELETE SET NULL (asset_id);
