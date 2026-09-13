CREATE INDEX IF NOT EXISTS entities_search_tsv_idx ON entities USING gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(subtitle,'') || ' ' || coalesce(document_text,'')));
CREATE INDEX IF NOT EXISTS events_search_tsv_idx ON events USING gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(description,'')));
