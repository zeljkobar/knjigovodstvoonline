-- SQL CHECK normally accepts UNKNOWN: reject incomplete method-specific inputs explicitly.
ALTER TABLE os_parametri DROP CONSTRAINT os_parametri_novi_check;
ALTER TABLE os_parametri ADD CONSTRAINT os_parametri_novi_check CHECK (COALESCE((
  algoritam = 'ACTUAL_DAYS_LIFE_V1' AND metoda = 'LINEAR' AND korisni_vijek_mjeseci IS NOT NULL
  OR algoritam = 'MONTHLY_RATE_V2' AND (
    metoda = 'NONE' AND godisnja_stopa IS NULL AND korisni_vijek_mjeseci IS NULL
    OR osnovica IS NOT NULL AND osnovica >= 0 AND (
      metoda IN ('LINEAR','DEGRESSIVE') AND godisnja_stopa IS NOT NULL
        AND (metoda = 'LINEAR' AND korisni_vijek_mjeseci IS NULL OR metoda = 'DEGRESSIVE' AND korisni_vijek_mjeseci BETWEEN 1 AND 1200)
        AND jedinica_ucinka IS NULL AND ocekivani_ucinak IS NULL AND prethodni_ucinak IS NULL AND stopa_po_jedinici IS NULL AND izvor_stope IS NULL
      OR metoda = 'UNITS_OF_PRODUCTION' AND godisnja_stopa IS NULL AND korisni_vijek_mjeseci IS NULL
        AND jedinica_ucinka IS NOT NULL AND length(trim(jedinica_ucinka)) > 0
        AND ocekivani_ucinak > 0 AND prethodni_ucinak >= 0 AND prethodni_ucinak <= ocekivani_ucinak
        AND (izvor_stope = 'DERIVED' AND stopa_po_jedinici IS NULL OR izvor_stope = 'MANUAL' AND stopa_po_jedinici > 0)
    )
  )
),false));
