BEGIN;
-- Keep historical test entries intact; short accounts are grouping accounts only.
UPDATE konta SET tip_konta = 'sinteticko', updated_at = NOW() WHERE length(btrim(sifra)) < 4;
UPDATE agencija_konta SET tip_konta = 'sinteticko', updated_at = NOW() WHERE length(btrim(sifra)) < 4;
UPDATE firma_konta SET tip_konta = 'sinteticko', updated_at = NOW() WHERE length(btrim(sifra)) < 4;

-- Explicit analytic accounts for the two built-in payroll defaults.
INSERT INTO konta (id, sifra, naziv, klasa, tip_konta, analitika_obavezna, sinteticki_konto, normalni_saldo, koristi_radnu_jedinicu, aktivan, created_at, updated_at)
SELECT gen_random_uuid(), sifra || '0', naziv, klasa, 'analiticko', analitika_obavezna, sifra, normalni_saldo, koristi_radnu_jedinicu, aktivan, NOW(), NOW()
FROM konta WHERE sifra IN ('522', '525')
ON CONFLICT (sifra) DO NOTHING;

ALTER TABLE konta ADD CONSTRAINT konta_analytic_min_length CHECK (tip_konta <> 'analiticko' OR length(btrim(sifra)) >= 4);
ALTER TABLE agencija_konta ADD CONSTRAINT agencija_konta_analytic_min_length CHECK (tip_konta <> 'analiticko' OR length(btrim(sifra)) >= 4);
ALTER TABLE firma_konta ADD CONSTRAINT firma_konta_analytic_min_length CHECK (tip_konta <> 'analiticko' OR length(btrim(sifra)) >= 4);

-- Covers every writer, including automatic POSTED journals and appended lines.
CREATE FUNCTION enforce_journal_account_length() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM firma_konta WHERE id = NEW.konto_id AND length(btrim(sifra)) < 4) THEN
    RAISE EXCEPTION 'Knjiženje zahtijeva analitički konto sa najmanje 4 cifre.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER journal_line_account_length BEFORE INSERT OR UPDATE OF konto_id, nalog_id, duguje, potrazuje ON stavke_naloga
FOR EACH ROW EXECUTE FUNCTION enforce_journal_account_length();

-- Existing drafts must also pass the rule when posted.
CREATE FUNCTION enforce_posted_journal_account_length() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'POSTED' AND EXISTS (
    SELECT 1 FROM stavke_naloga s JOIN firma_konta k ON k.id = s.konto_id
    WHERE s.nalog_id = NEW.id AND length(btrim(k.sifra)) < 4
  ) THEN
    RAISE EXCEPTION 'Knjiženje zahtijeva analitički konto sa najmanje 4 cifre.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER journal_post_account_length BEFORE UPDATE OF status ON nalozi
FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status) EXECUTE FUNCTION enforce_posted_journal_account_length();
COMMIT;
