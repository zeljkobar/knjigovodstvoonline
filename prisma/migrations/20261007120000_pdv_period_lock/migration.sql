ALTER TABLE pdv_periodi ADD COLUMN reopened_at timestamp(3), ADD COLUMN reopened_by uuid, ADD COLUMN reopen_reason text;
ALTER TABLE pdv_prijave ADD COLUMN izvor_hash text;
CREATE TABLE pdv_verzije (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), pdv_period_id uuid NOT NULL REFERENCES pdv_periodi(id) ON DELETE CASCADE,
 broj integer NOT NULL, snapshot jsonb NOT NULL, created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_by uuid NOT NULL, korisnik_ime text NOT NULL, UNIQUE(pdv_period_id,broj)
);

-- Every protected writer takes the same year lock as period closing, including inserts
-- into a month for which the period did not exist when the request began.
CREATE FUNCTION pdv_assert_open(f uuid, y uuid, d date) RETURNS void LANGUAGE plpgsql AS $$
DECLARE closed boolean;
BEGIN
 IF current_setting('app.purge_company',true)=f::text THEN RETURN; END IF;
 SELECT zakljucena INTO closed FROM poslovne_godine WHERE id=y AND firma_id=f FOR UPDATE;
 IF closed THEN RAISE EXCEPTION 'Poslovna godina je zaključana.' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM pdv_periodi WHERE firma_id=f AND d BETWEEN datum_od AND datum_do AND status='LOCKED') THEN
  RAISE EXCEPTION 'PDV period je zaključan. Potrebno je kontrolisano otključavanje.' USING ERRCODE='23514';
 END IF;
END $$;

CREATE FUNCTION pdv_guard_record(t text, r jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b record; j record; a uuid;
BEGIN
 IF r IS NULL THEN RETURN; END IF;
 IF t IN ('kif_books','kuf_books') THEN
  PERFORM pdv_assert_open((r->>'firma_id')::uuid,(r->>'poslovna_godina_id')::uuid,COALESCE(r->>'kif_date',r->>'kuf_date')::date);
 ELSIF t IN ('kif_entries','kuf_entries') THEN
  IF t='kif_entries' THEN SELECT firma_id,poslovna_godina_id,kif_date AS d INTO b FROM kif_books WHERE id=(r->>'kif_book_id')::uuid;
  ELSE SELECT firma_id,poslovna_godina_id,kuf_date AS d INTO b FROM kuf_books WHERE id=(r->>'kuf_book_id')::uuid; END IF;
  PERFORM pdv_assert_open((r->>'firma_id')::uuid,(r->>'poslovna_godina_id')::uuid,COALESCE(b.d,(r->>'invoice_date')::date));
 ELSIF t IN ('kif_entry_tax_lines','kif_pazar_payments') THEN
  SELECT to_jsonb(e) AS data INTO b FROM kif_entries e WHERE id=(r->>'kif_entry_id')::uuid;
  PERFORM pdv_guard_record('kif_entries',b.data);
 ELSIF t='kuf_entry_tax_lines' THEN
  SELECT to_jsonb(e) AS data INTO b FROM kuf_entries e WHERE id=(r->>'kuf_entry_id')::uuid;
  PERFORM pdv_guard_record('kuf_entries',b.data);
 ELSIF t='pdv_prijave' THEN
  SELECT * INTO b FROM pdv_periodi WHERE id=(r->>'pdv_period_id')::uuid;
  PERFORM pdv_assert_open(b.firma_id,b.poslovna_godina_id,b.datum_od);
 ELSIF t='pdv_prijava_stavke' THEN
  SELECT to_jsonb(p) AS data INTO b FROM pdv_prijave p WHERE id=(r->>'pdv_prijava_id')::uuid;
  PERFORM pdv_guard_record('pdv_prijave',b.data);
 ELSIF t IN ('nalozi','stavke_naloga') THEN
  IF t='nalozi' THEN SELECT (r->>'id')::uuid AS id,(r->>'firma_id')::uuid AS firma_id,(r->>'poslovna_godina_id')::uuid AS poslovna_godina_id,(r->>'datum')::date AS datum INTO j;
  ELSE SELECT id,firma_id,poslovna_godina_id,datum INTO j FROM nalozi WHERE id=(r->>'nalog_id')::uuid; END IF;
  FOR b IN SELECT to_jsonb(e) AS data,'kif_entries' AS t FROM kif_entries e WHERE journal_id=j.id
           UNION ALL SELECT to_jsonb(e),'kuf_entries' FROM kuf_entries e WHERE journal_id=j.id LOOP
   PERFORM pdv_guard_record(b.t,b.data);
  END LOOP;
  FOR b IN SELECT p.* FROM pdv_periodi p JOIN pdv_prijave v ON v.pdv_period_id=p.id WHERE v.journal_id=j.id LOOP
   PERFORM pdv_assert_open(b.firma_id,b.poslovna_godina_id,b.datum_od);
  END LOOP;
  -- Only input/output VAT accounts: paying the VAT liability remains possible.
  FOR a IN SELECT konto_id FROM stavke_naloga WHERE nalog_id=j.id
           UNION SELECT (r->>'konto_id')::uuid WHERE t='stavke_naloga' LOOP
   IF EXISTS(SELECT 1 FROM pdv_podesavanja_pravila q JOIN pdv_podesavanja p ON p.id=q.pdv_podesavanja_id
             WHERE p.firma_id=j.firma_id AND q.konto_id=a AND q.polje_sifra NOT IN ('VAT_PAYABLE','VAT_CREDIT'))
      OR EXISTS(SELECT 1 FROM firma_konta WHERE id=a AND (sifra LIKE '27%' OR sifra LIKE '47%')) THEN
    PERFORM pdv_assert_open(j.firma_id,j.poslovna_godina_id,j.datum);
   END IF;
  END LOOP;
 END IF;
END $$;
CREATE FUNCTION pdv_guard_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Export timestamp does not alter the return, even in a locked year.
 IF TG_TABLE_NAME='pdv_prijave' AND TG_OP='UPDATE' AND
   (to_jsonb(NEW)-'xml_generated_at'-'updated_at')=(to_jsonb(OLD)-'xml_generated_at'-'updated_at') THEN RETURN NEW; END IF;
 IF TG_OP<>'INSERT' THEN PERFORM pdv_guard_record(TG_TABLE_NAME,to_jsonb(OLD)); END IF;
 IF TG_OP<>'DELETE' THEN PERFORM pdv_guard_record(TG_TABLE_NAME,to_jsonb(NEW)); RETURN NEW; END IF;
 RETURN OLD;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['kif_books','kuf_books','kif_entries','kuf_entries','kif_entry_tax_lines','kuf_entry_tax_lines','kif_pazar_payments','pdv_prijave','pdv_prijava_stavke','nalozi','stavke_naloga'] LOOP
  EXECUTE format('CREATE TRIGGER pdv_period_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION pdv_guard_write()',t);
 END LOOP;
END $$;
