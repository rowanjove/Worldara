ALTER TABLE assets ADD COLUMN IF NOT EXISTS scan_status text NOT NULL DEFAULT 'passed' CHECK (scan_status IN ('passed', 'rejected'));
ALTER TABLE assets ADD COLUMN IF NOT EXISTS scan_message text NOT NULL DEFAULT '';
