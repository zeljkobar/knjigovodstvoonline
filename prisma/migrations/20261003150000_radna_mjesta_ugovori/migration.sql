CREATE TABLE radna_mjesta (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agencija_id UUID REFERENCES agencije(id),
 globalno_id UUID REFERENCES radna_mjesta(id), naziv TEXT NOT NULL, opis_poslova TEXT NOT NULL,
 aktivno BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT radna_mjesta_override_scope CHECK(globalno_id IS NULL OR agencija_id IS NOT NULL),
 UNIQUE(agencija_id,globalno_id)
);
CREATE INDEX radna_mjesta_agencija_id_aktivno_idx ON radna_mjesta(agencija_id,aktivno);
ALTER TABLE plate_radnici ADD COLUMN radno_mjesto_id UUID REFERENCES radna_mjesta(id),
 ADD COLUMN tip_ugovora TEXT, ADD COLUMN ugovoreni_istek DATE, ADD COLUMN mjesto_rada TEXT;
ALTER TABLE plate_radnici ADD CONSTRAINT plate_radnici_tip_ugovora_check CHECK(tip_ugovora IS NULL OR tip_ugovora IN ('ODREDJENO','NEODREDJENO'));
-- Existing percentages are retained exactly; custom percentages remain legacy until explicitly changed.
UPDATE plate_radnici SET vrsta_radnog_vremena = CASE procenat_radnog_vremena
 WHEN 100 THEN 'PUNO_8' WHEN 75 THEN 'SKRACENO_6' WHEN 50 THEN 'SKRACENO_4'
 WHEN 25 THEN 'SKRACENO_2' WHEN 12.5 THEN 'SKRACENO_1' ELSE vrsta_radnog_vremena END;
CREATE TABLE ugovori_o_radu (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), agencija_id UUID NOT NULL REFERENCES agencije(id),
 firma_id UUID NOT NULL REFERENCES firme(id), radnik_id UUID NOT NULL REFERENCES plate_radnici(id),
 broj TEXT NOT NULL, datum DATE NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT',
 snapshot JSONB NOT NULL, verzija_predloska TEXT NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by UUID NOT NULL,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by UUID NOT NULL,
 UNIQUE(firma_id,broj), CHECK(status IN ('DRAFT','CONCLUDED','CANCELLED'))
);
CREATE INDEX ugovori_o_radu_agencija_id_firma_id_radnik_id_idx ON ugovori_o_radu(agencija_id,firma_id,radnik_id);
INSERT INTO radna_mjesta(naziv,opis_poslova) VALUES
 ('Knjigovođa','Priprema i obrada računovodstvene dokumentacije, vođenje poslovnih evidencija i priprema izvještaja u okviru dodijeljenih poslova.'),
 ('Administrativni radnik','Vođenje administrativnih evidencija, obrada dokumentacije, poslovna korespondencija i organizacija kancelarijskih poslova.'),
 ('Prodavac','Usluživanje kupaca, prodaja robe, prijem i izlaganje robe i održavanje urednosti prodajnog prostora.'),
 ('Vozač','Prevoz putnika ili robe prema radnim zadacima, vođenje prateće dokumentacije i provjera stanja vozila.'),
 ('Konobar','Prijem porudžbina, posluživanje gostiju, naplata usluga i održavanje urednosti prostora za posluživanje.');
