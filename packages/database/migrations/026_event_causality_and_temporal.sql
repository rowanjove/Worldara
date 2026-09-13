-- Migration 026: Event Causality Graph & Temporal System 2.0
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS causal_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS temporal_expression JSONB NULL;

ALTER TABLE event_links
  ADD COLUMN IF NOT EXISTS description TEXT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_links_link_kind_check'
  ) THEN
    ALTER TABLE event_links DROP CONSTRAINT event_links_link_kind_check;
  END IF;
END $$;

ALTER TABLE event_links
  ADD CONSTRAINT event_links_link_kind_check
  CHECK (link_kind IN ('cause', 'result', 'causes', 'triggers', 'enables', 'prevents', 'results_in', 'contradicts'));

CREATE INDEX IF NOT EXISTS events_causal_links_gin_idx ON events USING gin (causal_links);
CREATE INDEX IF NOT EXISTS events_temporal_expr_gin_idx ON events USING gin (temporal_expression);
CREATE INDEX IF NOT EXISTS event_links_source_kind_idx ON event_links(world_id, event_id, link_kind);

ALTER TABLE scenes
  ADD COLUMN IF NOT EXISTS temporal_expression JSONB NULL;
