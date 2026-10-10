-- Payment settlement is not a change to the VAT evidence. Its audit remains in bank actions.
CREATE OR REPLACE FUNCTION pdv_guard_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF TG_TABLE_NAME='pdv_prijave' AND
    (to_jsonb(NEW)-'xml_generated_at'-'updated_at')=(to_jsonb(OLD)-'xml_generated_at'-'updated_at') THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME IN ('kif_entries','kuf_entries') AND
    (to_jsonb(NEW)-'payment_status'-'updated_at'-'updated_by')=(to_jsonb(OLD)-'payment_status'-'updated_at'-'updated_by') THEN RETURN NEW; END IF;
 END IF;
 IF TG_OP<>'INSERT' THEN PERFORM pdv_guard_record(TG_TABLE_NAME,to_jsonb(OLD)); END IF;
 IF TG_OP<>'DELETE' THEN PERFORM pdv_guard_record(TG_TABLE_NAME,to_jsonb(NEW)); RETURN NEW; END IF;
 RETURN OLD;
END $$;
CREATE FUNCTION pdv_immutable_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f uuid;
BEGIN
 SELECT firma_id INTO f FROM pdv_periodi WHERE id=OLD.pdv_period_id;
 IF current_setting('app.purge_company',true)=f::text THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Arhivirana PDV verzija se ne može mijenjati ili brisati.' USING ERRCODE='23514';
END $$;
CREATE TRIGGER pdv_version_immutable BEFORE UPDATE OR DELETE ON pdv_verzije FOR EACH ROW EXECUTE FUNCTION pdv_immutable_version();
CREATE FUNCTION pdv_guard_period_dates() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='LOCKED' AND current_setting('app.purge_company',true) IS DISTINCT FROM OLD.firma_id::text THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Zaključani PDV period se ne može brisati.' USING ERRCODE='23514'; END IF;
  IF (OLD.firma_id,OLD.poslovna_godina_id,OLD.datum_od,OLD.datum_do,OLD.mjesec) IS DISTINCT FROM (NEW.firma_id,NEW.poslovna_godina_id,NEW.datum_od,NEW.datum_do,NEW.mjesec) THEN RAISE EXCEPTION 'Datumi zaključanog PDV perioda se ne mogu mijenjati.' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER pdv_period_dates_guard BEFORE UPDATE OR DELETE ON pdv_periodi FOR EACH ROW EXECUTE FUNCTION pdv_guard_period_dates();
