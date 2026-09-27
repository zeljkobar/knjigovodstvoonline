ALTER TABLE bank_statements ADD COLUMN sadrzaj_hash TEXT;
CREATE UNIQUE INDEX bank_statements_firma_id_sadrzaj_hash_key ON bank_statements(firma_id,sadrzaj_hash);
CREATE TABLE mail_izvod_obrade (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 agencija_id UUID NOT NULL REFERENCES agencije(id),
 firma_id UUID NOT NULL REFERENCES firme(id),
 poslovna_godina_id UUID NOT NULL REFERENCES poslovne_godine(id),
 kljuc TEXT NOT NULL, poruka_kljuc TEXT NOT NULL, naziv_priloga TEXT NOT NULL,
 sadrzaj_hash TEXT, status TEXT NOT NULL CHECK(status IN ('IMPORTED','DUPLICATE','REVIEW','ERROR','SKIPPED')),
 razlog TEXT, izvod_id UUID REFERENCES bank_statements(id) ON DELETE SET NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_by UUID NOT NULL,
 UNIQUE(firma_id,poslovna_godina_id,kljuc)
);
CREATE INDEX mail_izvod_obrade_scope_idx ON mail_izvod_obrade(agencija_id,firma_id,poslovna_godina_id,poruka_kljuc);
