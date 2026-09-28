-- Existing records retain the original daily algorithm without changing their inputs.
ALTER TABLE os_parametri
  DROP CONSTRAINT os_parametri_metoda_check,
  ALTER COLUMN korisni_vijek_mjeseci DROP NOT NULL,
  ADD COLUMN algoritam TEXT NOT NULL DEFAULT 'ACTUAL_DAYS_LIFE_V1',
  ADD COLUMN godisnja_stopa DECIMAL(9,6),
  ADD COLUMN osnovica DECIMAL(14,2),
  ADD COLUMN jedinica_ucinka TEXT,
  ADD COLUMN ocekivani_ucinak DECIMAL(20,6),
  ADD COLUMN prethodni_ucinak DECIMAL(20,6),
  ADD COLUMN stopa_po_jedinici DECIMAL(20,6),
  ADD COLUMN izvor_stope TEXT,
  ADD CONSTRAINT os_parametri_metoda_check CHECK (metoda IN ('LINEAR','DEGRESSIVE','UNITS_OF_PRODUCTION','NONE')),
  ADD CONSTRAINT os_parametri_stopa_check CHECK (godisnja_stopa > 0 AND godisnja_stopa <= 100),
  ADD CONSTRAINT os_parametri_novi_check CHECK (
    algoritam = 'ACTUAL_DAYS_LIFE_V1' AND metoda = 'LINEAR' AND korisni_vijek_mjeseci IS NOT NULL
    OR algoritam = 'MONTHLY_RATE_V2' AND (
      metoda = 'NONE' OR osnovica IS NOT NULL AND osnovica >= 0 AND (
        metoda IN ('LINEAR','DEGRESSIVE') AND godisnja_stopa IS NOT NULL AND (metoda <> 'DEGRESSIVE' OR korisni_vijek_mjeseci BETWEEN 1 AND 1200)
        OR metoda = 'UNITS_OF_PRODUCTION' AND jedinica_ucinka IS NOT NULL AND ocekivani_ucinak IS NOT NULL AND ocekivani_ucinak > 0 AND prethodni_ucinak IS NOT NULL AND prethodni_ucinak >= 0 AND prethodni_ucinak <= ocekivani_ucinak AND izvor_stope IN ('DERIVED','MANUAL') AND (izvor_stope = 'DERIVED' OR stopa_po_jedinici IS NOT NULL AND stopa_po_jedinici > 0)
      )
    )
  );
CREATE TABLE os_ucinci (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 agencija_id UUID NOT NULL REFERENCES agencije(id),
 firma_id UUID NOT NULL REFERENCES firme(id),
 poslovna_godina_id UUID NOT NULL REFERENCES poslovne_godine(id),
 sredstvo_id UUID NOT NULL REFERENCES osnovna_sredstva(id),
 parametar_id UUID NOT NULL REFERENCES os_parametri(id),
 datum_od DATE NOT NULL, datum_do DATE NOT NULL,
 kolicina DECIMAL(20,6) NOT NULL CHECK (kolicina >= 0),
 razlog TEXT NOT NULL, verzija INTEGER NOT NULL DEFAULT 1,
 is_deleted BOOLEAN NOT NULL DEFAULT false, deleted_at TIMESTAMP(3), deleted_by UUID,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by UUID NOT NULL,
 updated_at TIMESTAMP(3) NOT NULL, updated_by UUID NOT NULL,
 CONSTRAINT os_ucinci_datumi_check CHECK (datum_od <= datum_do AND date_trunc('month',datum_od) = date_trunc('month',datum_do))
);
CREATE INDEX os_ucinci_agencija_id_firma_id_sredstvo_id_datum_od_idx ON os_ucinci(agencija_id,firma_id,sredstvo_id,datum_od);
-- All application writers also lock the asset and validate interval overlaps.
CREATE UNIQUE INDEX os_ucinci_aktivni_period_key ON os_ucinci(sredstvo_id,datum_od,datum_do) WHERE NOT is_deleted;
