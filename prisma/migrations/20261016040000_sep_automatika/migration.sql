ALTER TABLE kif_entries ADD COLUMN fiscal_iic TEXT, ADD COLUMN fiscal_source_url TEXT, ADD COLUMN sep_automation BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX kif_entries_agencija_id_firma_id_fiscal_iic_idx ON kif_entries(agencija_id, firma_id, fiscal_iic);
CREATE UNIQUE INDEX kif_entries_active_ikof_key ON kif_entries(agencija_id, firma_id, fiscal_iic) WHERE is_deleted=false AND fiscal_iic IS NOT NULL;
-- Existing source-document KIF rows can be linked without guessing from text/amounts.
UPDATE kif_entries k SET fiscal_iic=upper(f.iic), fiscal_source_url=f.qr_code_data
FROM fiskalni_izlazni_racuni f WHERE f.kif_entry_id=k.id AND upper(f.iic) IS NOT NULL AND f.firma_id=k.firma_id AND f.agencija_id=k.agencija_id
AND NOT EXISTS (SELECT 1 FROM fiskalni_izlazni_racuni f2 JOIN kif_entries k2 ON k2.id=f2.kif_entry_id
 WHERE k2.id<>k.id AND NOT k2.is_deleted AND k2.firma_id=k.firma_id AND upper(f2.iic)=upper(f.iic));
CREATE TABLE sep_automatika_podesavanja (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agencija_id UUID NOT NULL REFERENCES agencije(id) ON DELETE RESTRICT,
 firma_id UUID NOT NULL UNIQUE REFERENCES firme(id) ON DELETE RESTRICT,
 sertifikat_id UUID NOT NULL REFERENCES agencija_sep_sertifikati(id) ON DELETE RESTRICT,
 racun_vrsta_id UUID NOT NULL REFERENCES racun_vrste(id) ON DELETE RESTRICT,
 aktivna BOOLEAN NOT NULL DEFAULT false, revizija INTEGER NOT NULL DEFAULT 1,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX sep_automatika_podesavanja_agencija_id_aktivna_idx ON sep_automatika_podesavanja(agencija_id,aktivna);
CREATE TABLE sep_automatika_obrade (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agencija_id UUID NOT NULL REFERENCES agencije(id) ON DELETE RESTRICT,
 firma_id UUID NOT NULL REFERENCES firme(id) ON DELETE RESTRICT, dan DATE NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','DONE','REVIEW')),
 pokusaji INTEGER NOT NULL DEFAULT 0, pocetak TIMESTAMP(3), kraj TIMESTAMP(3), rezultat JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(firma_id,dan)
);
CREATE INDEX sep_automatika_obrade_agencija_id_dan_idx ON sep_automatika_obrade(agencija_id,dan);
