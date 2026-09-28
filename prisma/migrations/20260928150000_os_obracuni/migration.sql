CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE os_obracuni (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 agencija_id UUID NOT NULL REFERENCES agencije(id), firma_id UUID NOT NULL REFERENCES firme(id),
 poslovna_godina_id UUID NOT NULL REFERENCES poslovne_godine(id),
 period_od DATE NOT NULL, period_do DATE NOT NULL,
 status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','POSTED')),
 revizija INTEGER NOT NULL DEFAULT 1, ulazni_hash TEXT NOT NULL,
 ukupna_amortizacija DECIMAL(14,2) NOT NULL CHECK(ukupna_amortizacija>=0), snapshot JSONB NOT NULL,
 nalog_id UUID UNIQUE REFERENCES nalozi(id), bez_naloga_razlog TEXT,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by UUID NOT NULL,
 updated_at TIMESTAMP(3) NOT NULL, updated_by UUID NOT NULL, proknjizen_at TIMESTAMP(3), proknjizen_by UUID,
 CHECK(period_od<=period_do),
 CHECK(status<>'POSTED' OR (ukupna_amortizacija>0 AND nalog_id IS NOT NULL) OR (ukupna_amortizacija=0 AND bez_naloga_razlog='ZERO_AMOUNT')),
 UNIQUE(firma_id,poslovna_godina_id,period_od,period_do)
);
CREATE INDEX os_obracuni_agencija_id_firma_id_poslovna_godina_id_idx ON os_obracuni(agencija_id,firma_id,poslovna_godina_id);
CREATE TABLE os_obracun_stavke (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 agencija_id UUID NOT NULL REFERENCES agencije(id), firma_id UUID NOT NULL REFERENCES firme(id),
 poslovna_godina_id UUID NOT NULL REFERENCES poslovne_godine(id),
 obracun_id UUID NOT NULL REFERENCES os_obracuni(id), sredstvo_id UUID NOT NULL REFERENCES osnovna_sredstva(id),
 period_od DATE NOT NULL, period_do DATE NOT NULL, iznos DECIMAL(14,2) NOT NULL CHECK(iznos>=0), snapshot JSONB NOT NULL,
 CHECK(period_od<=period_do)
);
CREATE INDEX os_obracun_stavke_firma_id_sredstvo_id_idx ON os_obracun_stavke(firma_id,sredstvo_id);
CREATE INDEX os_obracun_stavke_obracun_id_idx ON os_obracun_stavke(obracun_id);
CREATE TABLE os_obracun_pokrice (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 agencija_id UUID NOT NULL REFERENCES agencije(id), firma_id UUID NOT NULL REFERENCES firme(id),
 poslovna_godina_id UUID NOT NULL REFERENCES poslovne_godine(id),
 obracun_id UUID NOT NULL REFERENCES os_obracuni(id), sredstvo_id UUID NOT NULL REFERENCES osnovna_sredstva(id),
 period_od DATE NOT NULL, period_do DATE NOT NULL, aktivno BOOLEAN NOT NULL DEFAULT true,
 CHECK(period_od<=period_do),
 -- Inclusive dates permit separate partial-month batches, but never overlapping posting.
 EXCLUDE USING gist (sredstvo_id WITH =, daterange(period_od,period_do,'[]') WITH &&) WHERE (aktivno)
);
CREATE INDEX os_obracun_pokrice_firma_id_sredstvo_id_period_od_idx ON os_obracun_pokrice(firma_id,sredstvo_id,period_od);
CREATE INDEX os_obracun_pokrice_obracun_id_idx ON os_obracun_pokrice(obracun_id);
