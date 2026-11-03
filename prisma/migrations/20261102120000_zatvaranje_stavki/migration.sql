CREATE TABLE zatvaranja_stavki (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), izvor_ref text UNIQUE, agencija_id uuid NOT NULL REFERENCES agencije(id),
 firma_id uuid NOT NULL REFERENCES firme(id), poslovna_godina_id uuid NOT NULL REFERENCES poslovne_godine(id),
 snimak jsonb, duguje_stavka_id uuid REFERENCES stavke_naloga(id) ON DELETE SET NULL,
 potrazuje_stavka_id uuid REFERENCES stavke_naloga(id) ON DELETE SET NULL,
 iznos decimal(14,2) NOT NULL CHECK(iznos>0), datum date NOT NULL, nacin text NOT NULL,
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, created_by uuid NOT NULL,
 is_deleted boolean NOT NULL DEFAULT false, deleted_at timestamp(3), deleted_by uuid,
 CHECK(duguje_stavka_id<>potrazuje_stavka_id), CHECK(is_deleted OR (duguje_stavka_id IS NOT NULL AND potrazuje_stavka_id IS NOT NULL))
);
CREATE INDEX ON zatvaranja_stavki(agencija_id,firma_id,poslovna_godina_id);
CREATE INDEX ON zatvaranja_stavki(duguje_stavka_id,is_deleted);
CREATE INDEX ON zatvaranja_stavki(potrazuje_stavka_id,is_deleted);
CREATE TABLE prenosi_otvorenih_stavki (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), agencija_id uuid NOT NULL REFERENCES agencije(id),
 firma_id uuid NOT NULL REFERENCES firme(id), poslovna_godina_id uuid NOT NULL REFERENCES poslovne_godine(id),
 nalog_id uuid NOT NULL REFERENCES nalozi(id) ON DELETE CASCADE,
 izvorna_stavka_id uuid NOT NULL REFERENCES stavke_naloga(id) ON DELETE RESTRICT,
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(nalog_id,izvorna_stavka_id)
);
CREATE INDEX ON prenosi_otvorenih_stavki(agencija_id,firma_id,poslovna_godina_id);
CREATE INDEX ON prenosi_otvorenih_stavki(izvorna_stavka_id);
-- Historical edges must survive reversal. Their source lines cannot silently be replaced.
CREATE FUNCTION zastiti_zatvorenu_stavku() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM zatvaranja_stavki WHERE NOT is_deleted AND (duguje_stavka_id=OLD.id OR potrazuje_stavka_id=OLD.id))
 OR EXISTS(SELECT 1 FROM prenosi_otvorenih_stavki WHERE izvorna_stavka_id=OLD.id) THEN
  IF TG_OP='DELETE' OR (NEW.nalog_id,NEW.konto_id,NEW.komitent_id,NEW.duguje,NEW.potrazuje,NEW.broj_dokumenta,NEW.datum_dokumenta)
    IS DISTINCT FROM (OLD.nalog_id,OLD.konto_id,OLD.komitent_id,OLD.duguje,OLD.potrazuje,OLD.broj_dokumenta,OLD.datum_dokumenta) THEN
   RAISE EXCEPTION 'Stavka ima istoriju zatvaranja ili prenos razrade; ispravite je posebnim korektivnim nalogom.';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER zastiti_zatvorenu_stavku BEFORE UPDATE OR DELETE ON stavke_naloga FOR EACH ROW EXECUTE FUNCTION zastiti_zatvorenu_stavku();
CREATE FUNCTION zastiti_zatvoreni_nalog() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.status,NEW.is_deleted,NEW.datum,NEW.firma_id,NEW.agencija_id,NEW.poslovna_godina_id)
 IS DISTINCT FROM (OLD.status,OLD.is_deleted,OLD.datum,OLD.firma_id,OLD.agencija_id,OLD.poslovna_godina_id)
 AND (EXISTS(SELECT 1 FROM prenosi_otvorenih_stavki p JOIN stavke_naloga s ON s.id=p.izvorna_stavka_id WHERE s.nalog_id=OLD.id)
 OR EXISTS(SELECT 1 FROM zatvaranja_stavki z JOIN stavke_naloga s ON s.id=z.duguje_stavka_id OR s.id=z.potrazuje_stavka_id WHERE s.nalog_id=OLD.id AND NOT z.is_deleted)) THEN
 RAISE EXCEPTION 'Prvo poništite zatvaranja. Prenesene izvorne stavke ispravljaju se korektivnim nalogom.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zastiti_zatvoreni_nalog BEFORE UPDATE ON nalozi FOR EACH ROW EXECUTE FUNCTION zastiti_zatvoreni_nalog();
