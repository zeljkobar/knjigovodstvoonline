CREATE TABLE otkazi_o_radu (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 agencija_id UUID NOT NULL REFERENCES agencije(id),
 firma_id UUID NOT NULL REFERENCES firme(id),
 radnik_id UUID NOT NULL REFERENCES plate_radnici(id),
 vrsta TEXT NOT NULL CHECK(vrsta IN ('SPORAZUMNI','ISTEK','RADNIK')),
 datum DATE NOT NULL, datum_prestanka DATE NOT NULL,
 snapshot JSONB NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_by UUID NOT NULL,
 CHECK(datum <= datum_prestanka)
);
CREATE INDEX otkazi_o_radu_agencija_id_firma_id_radnik_id_idx ON otkazi_o_radu(agencija_id,firma_id,radnik_id);
