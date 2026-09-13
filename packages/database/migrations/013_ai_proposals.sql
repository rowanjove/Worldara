-- Reviewable AI proposals are durable workflow records, not Canon records.
-- They reference a world for tenant isolation but do not update its revision.
CREATE TABLE IF NOT EXISTS ai_proposals (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  base_revision bigint NOT NULL CHECK (base_revision >= 0),
  request text NOT NULL CHECK (length(trim(request)) > 0),
  at_tick bigint NULL,
  status text NOT NULL CHECK (status IN ('draft', 'accepted', 'rejected', 'stale')),
  provider text NOT NULL,
  citations_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  unknowns jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS ai_proposals_world_created_idx ON ai_proposals(world_id, created_at DESC, id);

CREATE TABLE IF NOT EXISTS ai_proposal_changes (
  proposal_id uuid NOT NULL REFERENCES ai_proposals(id) ON DELETE CASCADE,
  id text NOT NULL,
  command text NOT NULL,
  payload_json jsonb NOT NULL,
  depends_on text[] NOT NULL DEFAULT '{}',
  evidence_refs text[] NOT NULL DEFAULT '{}',
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  user_decision text NOT NULL CHECK (user_decision IN ('pending', 'accepted', 'rejected')),
  PRIMARY KEY (proposal_id, id)
);

CREATE INDEX IF NOT EXISTS ai_proposal_changes_proposal_idx ON ai_proposal_changes(proposal_id);
