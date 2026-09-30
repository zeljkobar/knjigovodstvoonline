CREATE TABLE os_poreske_godine (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 agencija_id UUID NOT NULL REFERENCES agencije(id), firma_id UUID NOT NULL REFERENCES firme(id),
 poslovna_godina_id UUID NOT NULL UNIQUE REFERENCES poslovne_godine(id),
 verzija INTEGER NOT NULL DEFAULT 1 CHECK(verzija>0), ulazi JSONB NOT NULL,
 prethodni_obracun_id UUID,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by UUID NOT NULL,
 updated_at TIMESTAMP(3) NOT NULL, updated_by UUID NOT NULL
);
CREATE INDEX os_poreske_godine_agencija_id_firma_id_idx ON os_poreske_godine(agencija_id,firma_id);
CREATE TABLE os_poreski_obracuni (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 agencija_id UUID NOT NULL REFERENCES agencije(id), firma_id UUID NOT NULL REFERENCES firme(id),
 poslovna_godina_id UUID NOT NULL REFERENCES poslovne_godine(id),
 poreska_godina_id UUID NOT NULL REFERENCES os_poreske_godine(id),
 revizija INTEGER NOT NULL CHECK(revizija>0), status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','CONFIRMED')),
 ulazni_hash TEXT NOT NULL, snapshot JSONB NOT NULL,
 ukupna_amortizacija DECIMAL(14,2) NOT NULL CHECK(ukupna_amortizacija>=0),
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by UUID NOT NULL,
 potvrdjen_at TIMESTAMP(3), potvrdjen_by UUID,
 CHECK((status='CONFIRMED')=(potvrdjen_at IS NOT NULL AND potvrdjen_by IS NOT NULL)),
 UNIQUE(poslovna_godina_id,revizija)
);
CREATE UNIQUE INDEX os_poreski_obracuni_potvrdjen ON os_poreski_obracuni(poslovna_godina_id) WHERE status='CONFIRMED';
CREATE INDEX os_poreski_obracuni_agencija_id_firma_id_poslovna_godina_id_idx ON os_poreski_obracuni(agencija_id,firma_id,poslovna_godina_id);
ALTER TABLE os_poreske_godine ADD CONSTRAINT os_poreske_godine_prethodni_obracun_id_fkey FOREIGN KEY(prethodni_obracun_id) REFERENCES os_poreski_obracuni(id);
