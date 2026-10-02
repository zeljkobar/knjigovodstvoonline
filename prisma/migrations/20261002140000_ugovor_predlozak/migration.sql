-- Do not invent signing dates, payment days or jurisdiction for existing contracts.
ALTER TABLE firma_ugovori
  ADD COLUMN datum_zakljucenja DATE,
  ADD COLUMN dan_placanja INTEGER,
  ADD COLUMN nadlezni_sud TEXT,
  ADD CONSTRAINT firma_ugovori_dan_placanja_check CHECK (dan_placanja BETWEEN 1 AND 31);
-- Existing snapshots intentionally remain untouched. An explicit refresh captures
-- the client's current director; migration cannot recover the historical signer.
