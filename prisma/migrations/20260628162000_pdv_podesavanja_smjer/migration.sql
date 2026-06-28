ALTER TABLE "pdv_podesavanja"
  ADD COLUMN "izlazni_pdv_smjer" text NOT NULL DEFAULT 'D',
  ADD COLUMN "ulazni_pdv_smjer" text NOT NULL DEFAULT 'P',
  ADD COLUMN "obaveza_pdv_smjer" text NOT NULL DEFAULT 'P',
  ADD COLUMN "pdv_kredit_smjer" text NOT NULL DEFAULT 'D',
  ADD COLUMN "neodbitni_pdv_smjer" text NOT NULL DEFAULT 'D';

ALTER TABLE "pdv_podesavanja"
  ADD CONSTRAINT "pdv_podesavanja_izlazni_pdv_smjer_check" CHECK ("izlazni_pdv_smjer" IN ('D', 'P')),
  ADD CONSTRAINT "pdv_podesavanja_ulazni_pdv_smjer_check" CHECK ("ulazni_pdv_smjer" IN ('D', 'P')),
  ADD CONSTRAINT "pdv_podesavanja_obaveza_pdv_smjer_check" CHECK ("obaveza_pdv_smjer" IN ('D', 'P')),
  ADD CONSTRAINT "pdv_podesavanja_pdv_kredit_smjer_check" CHECK ("pdv_kredit_smjer" IN ('D', 'P')),
  ADD CONSTRAINT "pdv_podesavanja_neodbitni_pdv_smjer_check" CHECK ("neodbitni_pdv_smjer" IN ('D', 'P'));
