CREATE TABLE IF NOT EXISTS operation_idempotency_keys (
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  response_json jsonb NOT NULL,
  status_code integer NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

CREATE INDEX IF NOT EXISTS operation_idempotency_created_at_idx ON operation_idempotency_keys(created_at);
