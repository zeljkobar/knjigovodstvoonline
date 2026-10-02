CREATE TABLE firma_rok_planovi (
 firma_id UUID PRIMARY KEY REFERENCES firme(id), agencija_id UUID NOT NULL REFERENCES agencije(id),
 pdv BOOLEAN NOT NULL, plate BOOLEAN NOT NULL, zavrsni BOOLEAN NOT NULL DEFAULT true,
 od_mjeseca DATE NOT NULL, updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX firma_rok_planovi_agencija_id_idx ON firma_rok_planovi(agencija_id);
CREATE TABLE firma_rok_zadaci (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), firma_id UUID NOT NULL REFERENCES firme(id),
 agencija_id UUID NOT NULL REFERENCES agencije(id), vrsta TEXT NOT NULL CHECK(vrsta IN ('PDV','PLATE','ZAVRSNI')),
 godina_roka INTEGER NOT NULL CHECK(godina_roka BETWEEN 2000 AND 2100),
 mjesec_roka INTEGER NOT NULL CHECK(mjesec_roka BETWEEN 1 AND 12),
 zavrseno_at TIMESTAMP(3), zavrseno_by UUID, zavrseno_ime TEXT, napomena TEXT,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT firma_rok_zadaci_firma_id_vrsta_godina_roka_mjesec_roka_key UNIQUE(firma_id,vrsta,godina_roka,mjesec_roka),
 CHECK(vrsta <> 'ZAVRSNI' OR mjesec_roka = 3)
);
CREATE INDEX firma_rok_zadaci_agencija_id_godina_roka_mjesec_roka_idx ON firma_rok_zadaci(agencija_id,godina_roka,mjesec_roka);
-- Start existing companies now, not with artificial historical arrears.
INSERT INTO firma_rok_planovi(firma_id,agencija_id,pdv,plate,zavrsni,od_mjeseca)
SELECT f.id,f.agencija_id,f.pdv_obveznik,
 EXISTS(SELECT 1 FROM plate_radnici p WHERE p.firma_id=f.id AND p.agencija_id=f.agencija_id AND p.aktivan AND p.zaposlen AND NOT p.is_deleted),
 true,date_trunc('month',CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Podgorica')::date
FROM firme f WHERE NOT f.is_deleted;
