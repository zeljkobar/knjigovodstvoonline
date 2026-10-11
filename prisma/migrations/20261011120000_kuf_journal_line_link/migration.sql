-- Older postings remain unlinked: never infer ownership from invoice text/amounts.
ALTER TABLE stavke_naloga ADD COLUMN kuf_entry_id UUID;
CREATE INDEX stavke_naloga_kuf_entry_id_idx ON stavke_naloga(kuf_entry_id);
ALTER TABLE stavke_naloga ADD CONSTRAINT stavke_naloga_kuf_entry_id_fkey
  FOREIGN KEY (kuf_entry_id) REFERENCES kuf_entries(id) ON DELETE RESTRICT ON UPDATE CASCADE;
