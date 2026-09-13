CREATE TABLE IF NOT EXISTS plotlines (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  summary text NOT NULL DEFAULT '',
  status varchar(32) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved', 'abandoned')),
  current_stage varchar(32) NOT NULL DEFAULT 'setup' CHECK (current_stage IN ('setup', 'development', 'climax', 'resolution', 'unresolved')),
  character_entity_ids uuid[] NOT NULL DEFAULT '{}',
  event_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS plotlines_world_idx ON plotlines(world_id);

CREATE TABLE IF NOT EXISTS foreshadowings (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  description text NOT NULL DEFAULT '',
  setup_scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
  setup_tick bigint NULL,
  payoff_scene_id uuid NULL REFERENCES scenes(id) ON DELETE SET NULL,
  payoff_tick bigint NULL,
  related_entity_ids uuid[] NOT NULL DEFAULT '{}',
  plotline_id uuid NULL REFERENCES plotlines(id) ON DELETE SET NULL,
  status varchar(32) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'abandoned')),
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS foreshadowings_world_idx ON foreshadowings(world_id);
CREATE INDEX IF NOT EXISTS foreshadowings_plotline_idx ON foreshadowings(world_id, plotline_id);
CREATE INDEX IF NOT EXISTS foreshadowings_setup_scene_idx ON foreshadowings(setup_scene_id);
CREATE INDEX IF NOT EXISTS foreshadowings_payoff_scene_idx ON foreshadowings(payoff_scene_id);

ALTER TABLE scenes ADD COLUMN IF NOT EXISTS plotline_ids uuid[] NOT NULL DEFAULT '{}';
