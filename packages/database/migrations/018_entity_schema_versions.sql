ALTER TABLE entities ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1;
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_schema_version_positive;
ALTER TABLE entities ADD CONSTRAINT entities_schema_version_positive CHECK (schema_version > 0);
