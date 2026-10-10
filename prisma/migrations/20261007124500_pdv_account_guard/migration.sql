-- Shared by posting actions and database guards. Liability settlements stay available.
CREATE FUNCTION pdv_account_protected(f uuid, a uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM pdv_podesavanja_pravila q JOIN pdv_podesavanja p ON p.id=q.pdv_podesavanja_id
               WHERE p.firma_id=f AND q.konto_id=a AND q.polje_sifra NOT IN ('VAT_PAYABLE','VAT_CREDIT'))
 OR (EXISTS(SELECT 1 FROM firma_konta WHERE id=a AND (sifra LIKE '27%' OR sifra LIKE '47%'))
     AND NOT EXISTS(SELECT 1 FROM pdv_podesavanja_pravila q JOIN pdv_podesavanja p ON p.id=q.pdv_podesavanja_id
                    WHERE p.firma_id=f AND q.konto_id=a AND q.polje_sifra IN ('VAT_PAYABLE','VAT_CREDIT')));
$$;
CREATE OR REPLACE FUNCTION pdv_guard_record(t text, r jsonb) RETURNS void LANGUAGE plpgsql AS $$
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
   IF pdv_account_protected(j.firma_id,a) THEN
    PERFORM pdv_assert_open(j.firma_id,j.poslovna_godina_id,j.datum);
   END IF;
  END LOOP;
 END IF;
END $$;
