-- KUF evidence keeps its source-document posting mode for supplier credit notes.
ALTER TABLE kuf_entries DROP CONSTRAINT kuf_entries_source_type_check;
ALTER TABLE kuf_entries ADD CONSTRAINT kuf_entries_source_type_check
  CHECK (source_type IN ('KUF', 'CALCULATION', 'SUPPLIER_RETURN'));

-- One active supplier credit document per company/supplier/number/year.
CREATE UNIQUE INDEX povrat_aktivno_odobrenje_key
  ON povrati_dobavljacu(firma_id, poslovna_godina_id, dobavljac_id, broj_odobrenja)
  WHERE is_deleted = false;

-- No child tables added. Existing purge removes returns before referenced KUF rows.
