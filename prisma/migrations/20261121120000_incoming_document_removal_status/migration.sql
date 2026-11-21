-- Keep every existing status; allow durable cloud deletion intent and soft removal.
ALTER TABLE "primljeni_dokumenti"
  DROP CONSTRAINT "primljeni_dokumenti_status_check";
ALTER TABLE "primljeni_dokumenti"
  ADD CONSTRAINT "primljeni_dokumenti_status_check"
  CHECK ("status" IN ('UPLOAD', 'PRIMLJENO', 'DOPUNA', 'ARHIVIRANO', 'BRISANJE', 'UKLONJENO'));
