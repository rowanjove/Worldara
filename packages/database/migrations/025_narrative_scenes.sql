CREATE TABLE IF NOT EXISTS works (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  type varchar(32) NOT NULL DEFAULT 'novel' CHECK (type IN ('novel', 'screenplay', 'game', 'campaign', 'comic', 'other')),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS works_world_idx ON works(world_id);

CREATE TABLE IF NOT EXISTS chapters (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  order_index integer NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chapters_work_idx ON chapters(work_id, order_index);

CREATE TABLE IF NOT EXISTS scenes (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  chapter_id uuid NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL DEFAULT '',
  order_index integer NOT NULL DEFAULT 0,
  scene_tick bigint NULL,
  pov_character_id uuid NULL REFERENCES entities(id) ON DELETE SET NULL,
  location_entity_id uuid NULL REFERENCES entities(id) ON DELETE SET NULL,
  participant_entity_ids uuid[] NOT NULL DEFAULT '{}',
  prose_text text NOT NULL DEFAULT '',
  status varchar(32) NOT NULL DEFAULT 'draft' CHECK (status IN ('outline', 'draft', 'revised', 'final')),
  canon_revision bigint NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS scenes_chapter_idx ON scenes(chapter_id, order_index);
CREATE INDEX IF NOT EXISTS scenes_world_work_idx ON scenes(world_id, work_id);
CREATE INDEX IF NOT EXISTS scenes_tick_idx ON scenes(world_id, scene_tick) WHERE scene_tick IS NOT NULL;
