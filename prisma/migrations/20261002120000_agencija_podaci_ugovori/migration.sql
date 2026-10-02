ALTER TABLE agencije ADD COLUMN pdv_broj TEXT,
  ADD COLUMN zastupnik_ime TEXT, ADD COLUMN zastupnik_funkcija TEXT;
CREATE TABLE agencija_bankovni_racuni (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agencija_id UUID NOT NULL REFERENCES agencije(id),
  naziv_banke TEXT NOT NULL, broj_racuna TEXT NOT NULL,
  glavni BOOLEAN NOT NULL DEFAULT false, is_deleted BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMP(3), deleted_by UUID,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by UUID,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_by UUID
);
CREATE INDEX agencija_bankovni_racuni_agencija_id_is_deleted_idx ON agencija_bankovni_racuni(agencija_id,is_deleted);
CREATE UNIQUE INDEX agencija_bankovni_racuni_aktivan_broj_key ON agencija_bankovni_racuni(agencija_id,broj_racuna) WHERE NOT is_deleted;
CREATE UNIQUE INDEX agencija_bankovni_racuni_jedan_glavni_key ON agencija_bankovni_racuni(agencija_id) WHERE glavni AND NOT is_deleted;
ALTER TABLE firma_ugovori ADD COLUMN agencija_snapshot JSONB, ADD COLUMN klijent_snapshot JSONB;
-- Preserve the information currently used to print existing contracts.
-- Historical versions preceding this migration cannot be reconstructed.
UPDATE firma_ugovori u SET agencija_snapshot=jsonb_build_object(
  'naziv',a.naziv,'pib',a.pib,'pdv_broj',a.pdv_broj,'adresa',a.adresa,'grad',a.grad,
  'telefon',a.telefon,'email',a.email,'zastupnik_ime',a.zastupnik_ime,
  'zastupnik_funkcija',a.zastupnik_funkcija,'banka',NULL,'racun',NULL
), klijent_snapshot=jsonb_build_object(
  'naziv',f.naziv,'pib',f.pib,'pdv_broj',f.pdv_broj,'adresa',f.adresa,
  'grad',f.grad,'opstina',f.opstina,'telefon',f.telefon,'email',f.email
)
FROM agencije a, firme f WHERE a.id=u.agencija_id AND f.id=u.firma_id;
