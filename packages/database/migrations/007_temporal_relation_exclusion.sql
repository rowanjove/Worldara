CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE relations DROP CONSTRAINT IF EXISTS relations_single_canon_temporal_value;
ALTER TABLE relations ADD CONSTRAINT relations_single_canon_temporal_value
  EXCLUDE USING gist (
    world_id WITH =,
    source_entity_id WITH =,
    target_entity_id WITH =,
    relation_type_id WITH =,
    valid_range WITH &&
  ) WHERE (canon_status = 'canon');
