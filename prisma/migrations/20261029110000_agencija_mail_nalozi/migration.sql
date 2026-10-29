CREATE TABLE agencija_mail_nalozi (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 agencija_id UUID NOT NULL REFERENCES agencije(id),
 naziv TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 993 CHECK (port = 993),
 korisnicko_ime TEXT NOT NULL, lozinka_sifrovana TEXT NOT NULL,
 aktivan BOOLEAN NOT NULL DEFAULT TRUE, is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
 deleted_at TIMESTAMP(3), deleted_by UUID, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by UUID, updated_by UUID,
 UNIQUE (agencija_id,id), UNIQUE (agencija_id,host,korisnicko_ime)
);
CREATE INDEX agencija_mail_nalozi_agencija_id_aktivan_is_deleted_idx ON agencija_mail_nalozi(agencija_id,aktivan,is_deleted);
ALTER TABLE firma_mail_podesavanja ADD COLUMN mail_nalog_id UUID;
ALTER TABLE firma_mail_podesavanja ADD CONSTRAINT firma_mail_nalog_scope_fk FOREIGN KEY (agencija_id,mail_nalog_id) REFERENCES agencija_mail_nalozi(agencija_id,id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE mail_izvod_obrade ADD COLUMN mail_nalog_id UUID;
ALTER TABLE mail_izvod_obrade ADD CONSTRAINT mail_obrada_nalog_scope_fk FOREIGN KEY (agencija_id,mail_nalog_id) REFERENCES agencija_mail_nalozi(agencija_id,id) ON DELETE RESTRICT ON UPDATE CASCADE;
