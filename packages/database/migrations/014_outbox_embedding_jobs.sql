-- Durable asynchronous work queue. Domain writes enqueue one event in the same
-- transaction as the revision so workers never observe a half-committed world.
CREATE TABLE IF NOT EXISTS outbox_events (
  id uuid PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  revision_id uuid NULL,
  event_type text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz NULL,
  processed_at timestamptz NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbox_events_ready_idx ON outbox_events(available_at, created_at, id) WHERE processed_at IS NULL;

CREATE TABLE IF NOT EXISTS embedding_jobs (
  id uuid PRIMARY KEY,
  outbox_event_id uuid NOT NULL REFERENCES outbox_events(id) ON DELETE CASCADE,
  world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  source_kind text NOT NULL,
  source_id uuid NOT NULL,
  content_text text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')) DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL,
  last_error text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_id)
);

CREATE INDEX IF NOT EXISTS embedding_jobs_ready_idx ON embedding_jobs(status, available_at, created_at, id);
