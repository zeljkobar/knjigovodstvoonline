ALTER TABLE putni_nalozi ADD COLUMN nalog_id UUID;
CREATE UNIQUE INDEX putni_nalozi_nalog_id_key ON putni_nalozi(nalog_id);
ALTER TABLE putni_nalozi ADD CONSTRAINT putni_nalozi_nalog_id_fkey FOREIGN KEY(nalog_id) REFERENCES nalozi(id) ON DELETE RESTRICT ON UPDATE CASCADE;
