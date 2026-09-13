ALTER TABLE entity_types ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1;
ALTER TABLE entity_types ADD COLUMN IF NOT EXISTS created_revision bigint NOT NULL DEFAULT 1;
ALTER TABLE entity_types ADD COLUMN IF NOT EXISTS updated_revision bigint NOT NULL DEFAULT 1;
