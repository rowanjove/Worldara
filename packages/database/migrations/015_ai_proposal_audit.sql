ALTER TABLE ai_proposals ADD COLUMN IF NOT EXISTS model text NULL;
ALTER TABLE ai_proposals ADD COLUMN IF NOT EXISTS prompt_version text NOT NULL DEFAULT 'canon-context-v1';
ALTER TABLE ai_proposals ADD COLUMN IF NOT EXISTS context_refs jsonb NOT NULL DEFAULT '[]'::jsonb;
