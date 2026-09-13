CREATE TABLE IF NOT EXISTS validation_rules (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name varchar(200) NOT NULL,
  description text NOT NULL DEFAULT '',
  severity varchar(32) NOT NULL DEFAULT 'error' CHECK (severity IN ('info', 'suggestion', 'warning', 'error', 'blocker')),
  target varchar(32) NOT NULL DEFAULT 'entity' CHECK (target IN ('entity', 'fact', 'relation', 'event', 'world')),
  target_selector_json jsonb NULL,
  when_json jsonb NULL,
  assert_json jsonb NOT NULL,
  message varchar(500) NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_revision bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS validation_rules_world_idx ON validation_rules(world_id, enabled);
CREATE INDEX IF NOT EXISTS validation_rules_target_idx ON validation_rules(world_id, target);
