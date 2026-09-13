-- Dual-timeline exclusion: Canon facts/relations may share a valid_range
-- across different author revisions, but not at the same revision on one branch.

ALTER TABLE facts DROP CONSTRAINT IF EXISTS facts_single_canon_temporal_value;
ALTER TABLE facts ADD CONSTRAINT facts_single_canon_temporal_value EXCLUDE USING gist (
  world_id WITH =,
  branch_id WITH =,
  subject_entity_id WITH =,
  predicate_key WITH =,
  valid_range WITH &&,
  int8range(revision_from, COALESCE(revision_to, '9223372036854775807'::bigint), '[)' ) WITH &&
) WHERE (canon_status = 'canon');

ALTER TABLE relations DROP CONSTRAINT IF EXISTS relations_single_canon_temporal_value;
ALTER TABLE relations ADD CONSTRAINT relations_single_canon_temporal_value EXCLUDE USING gist (
  world_id WITH =,
  branch_id WITH =,
  source_entity_id WITH =,
  target_entity_id WITH =,
  relation_type_id WITH =,
  valid_range WITH &&,
  int8range(revision_from, COALESCE(revision_to, '9223372036854775807'::bigint), '[)' ) WITH &&
) WHERE (canon_status = 'canon');
