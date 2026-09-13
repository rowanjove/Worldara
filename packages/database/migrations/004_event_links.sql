CREATE TABLE IF NOT EXISTS event_links (
  world_id uuid NOT NULL,
  event_id uuid NOT NULL,
  linked_event_id uuid NOT NULL,
  link_kind text NOT NULL CHECK (link_kind IN ('cause', 'result')),
  PRIMARY KEY (world_id, event_id, linked_event_id, link_kind),
  FOREIGN KEY (world_id, event_id) REFERENCES events(world_id, id) ON DELETE CASCADE,
  FOREIGN KEY (world_id, linked_event_id) REFERENCES events(world_id, id) ON DELETE CASCADE,
  CHECK (event_id <> linked_event_id)
);

CREATE INDEX IF NOT EXISTS event_links_target_idx ON event_links(world_id, linked_event_id, link_kind);
