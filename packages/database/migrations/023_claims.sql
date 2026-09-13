CREATE TABLE IF NOT EXISTS claims (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  branch_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  subject_entity_id uuid NULL REFERENCES entities(id) ON DELETE SET NULL,
  predicate_key varchar(200) NOT NULL,
  object_kind varchar(32) NOT NULL CHECK (object_kind IN ('scalar', 'entity', 'json')),
  value jsonb NULL,
  object_entity_id uuid NULL REFERENCES entities(id) ON DELETE SET NULL,
  asserted_by_entity_id uuid NULL REFERENCES entities(id) ON DELETE SET NULL,
  known_by_entity_ids uuid[] NOT NULL DEFAULT '{}',
  valid_from_tick bigint NULL,
  valid_to_tick bigint NULL,
  truth_status varchar(32) NOT NULL DEFAULT 'unknown' CHECK (truth_status IN ('true', 'false', 'disputed', 'unknown', 'author_undecided')),
  claim_kind varchar(32) NOT NULL DEFAULT 'belief' CHECK (claim_kind IN ('belief', 'rumor', 'official_record', 'testimony', 'prophecy', 'legend', 'secret', 'hypothesis')),
  confidence double precision NULL,
  source_refs text[] NOT NULL DEFAULT '{}',
  canon_status varchar(32) NOT NULL DEFAULT 'draft' CHECK (canon_status IN ('draft', 'pending', 'canon', 'retconned')),
  created_revision bigint NOT NULL DEFAULT 1,
  retconned_revision bigint NULL,
  revision_from bigint NOT NULL DEFAULT 1,
  revision_to bigint NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  FOREIGN KEY (world_id, branch_id) REFERENCES timeline_branches(world_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS claims_world_branch_idx ON claims(world_id, branch_id);
CREATE INDEX IF NOT EXISTS claims_subject_entity_idx ON claims(world_id, subject_entity_id);
CREATE INDEX IF NOT EXISTS claims_asserted_by_idx ON claims(world_id, asserted_by_entity_id);
CREATE INDEX IF NOT EXISTS claims_truth_status_idx ON claims(world_id, truth_status);
CREATE INDEX IF NOT EXISTS claims_claim_kind_idx ON claims(world_id, claim_kind);
CREATE INDEX IF NOT EXISTS claims_canon_status_idx ON claims(world_id, canon_status);
CREATE INDEX IF NOT EXISTS claims_revision_idx ON claims(world_id, branch_id, revision_from, revision_to);
