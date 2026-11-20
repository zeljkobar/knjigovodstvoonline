CREATE TABLE fiskalni_kontakti (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agencija_id uuid NOT NULL REFERENCES agencije(id), firma_id uuid NOT NULL REFERENCES firme(id),
 partner_key text NOT NULL DEFAULT 'FIRMA', naziv text NOT NULL, email text NOT NULL, podrazumijevan boolean NOT NULL DEFAULT false,
 is_deleted boolean NOT NULL DEFAULT false, deleted_at timestamp(3), created_by uuid NOT NULL, updated_by uuid NOT NULL,
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamp(3) NOT NULL
);
CREATE INDEX fiskalni_kontakti_agencija_id_firma_id_partner_key_idx ON fiskalni_kontakti(agencija_id,firma_id,partner_key);
CREATE UNIQUE INDEX fiskalni_kontakti_default_idx ON fiskalni_kontakti(firma_id,partner_key) WHERE podrazumijevan AND NOT is_deleted;
CREATE TABLE fiskalne_dostave (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agencija_id uuid NOT NULL REFERENCES agencije(id), firma_id uuid NOT NULL REFERENCES firme(id),
 poslovna_godina_id uuid NOT NULL, korisnik_id uuid NOT NULL, povrsina text NOT NULL, izvor jsonb NOT NULL,
 naziv text NOT NULL, mime text NOT NULL, prilog bytea, sha256 text NOT NULL, velicina integer NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT', primalac text, kopija text, naslov text, poruka text, message_id text, greska text,
 queued_at timestamp(3), started_at timestamp(3), accepted_at timestamp(3), expires_at timestamp(3) NOT NULL,
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamp(3) NOT NULL,
 CONSTRAINT fiskalne_dostave_status CHECK(status IN ('DRAFT','QUEUED','SENDING','ACCEPTED','FAILED','UNKNOWN','BLOCKED')),
 CONSTRAINT fiskalne_dostave_size CHECK(velicina BETWEEN 1 AND 10485760)
);
CREATE INDEX fiskalne_dostave_status_queued_at_idx ON fiskalne_dostave(status,queued_at);
CREATE INDEX fiskalne_dostave_agencija_id_firma_id_created_at_idx ON fiskalne_dostave(agencija_id,firma_id,created_at);
