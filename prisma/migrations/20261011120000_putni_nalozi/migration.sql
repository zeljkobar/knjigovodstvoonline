CREATE TABLE putni_nalozi (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agencija_id uuid NOT NULL REFERENCES agencije(id),
 firma_id uuid NOT NULL REFERENCES firme(id), poslovna_godina_id uuid NOT NULL REFERENCES poslovne_godine(id),
 broj text NOT NULL, datum date NOT NULL, status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','COMPLETED')),
 podaci jsonb NOT NULL, is_deleted boolean NOT NULL DEFAULT false, deleted_at timestamp(3), deleted_by uuid,
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamp(3) NOT NULL,
 created_by uuid NOT NULL, updated_by uuid NOT NULL,
 UNIQUE(firma_id,poslovna_godina_id,broj)
);
CREATE INDEX putni_nalozi_scope_idx ON putni_nalozi(agencija_id,firma_id,poslovna_godina_id);
CREATE TABLE putne_relacije (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agencija_id uuid NOT NULL REFERENCES agencije(id),
 kljuc text NOT NULL, polazak text NOT NULL, odrediste text NOT NULL,
 km decimal(10,2) NOT NULL CHECK(km>0), updated_at timestamp(3) NOT NULL,
 UNIQUE(agencija_id,kljuc)
);
CREATE TABLE putni_podesavanja (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agencija_id uuid NOT NULL REFERENCES agencije(id),
 firma_id uuid NOT NULL UNIQUE REFERENCES firme(id), podaci jsonb NOT NULL, updated_at timestamp(3) NOT NULL
);
