-- Sačuvaj pristup korisnika koji su još koristili isključivo stara zbirna prava.
-- Ako za korisnika i firmu postoji makar jedan red u novoj matrici, matrica je
-- već podešena i ne smije se dopunjavati iz starih polja (nečekirano pravo je
-- namjerna zabrana, iako se u bazi predstavlja odsustvom reda).
--
-- Provjera postojanja kolone čini migraciju bezbjednom i u razvojnoj bazi u
-- kojoj je migracija uklanjanja kolona već bila primijenjena prije backfilla.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'korisnik_firma'
      AND column_name = 'moze_da_gleda'
  ) THEN
    EXECUTE $migration$
      WITH legacy_assignments AS (
        SELECT
          k."agencija_id",
          kf."korisnik_id",
          kf."firma_id",
          kf."moze_da_gleda",
          kf."moze_da_unosi",
          kf."moze_da_mijenja",
          kf."moze_da_brise"
        FROM "korisnik_firma" AS kf
        JOIN "korisnici" AS k ON k."id" = kf."korisnik_id"
        WHERE k."agencija_id" IS NOT NULL
          AND kf."is_deleted" = false
          AND NOT EXISTS (
            SELECT 1
            FROM "korisnik_prava" AS existing
            WHERE existing."agencija_id" = k."agencija_id"
              AND existing."korisnik_id" = kf."korisnik_id"
              AND existing."firma_id" = kf."firma_id"
          )
      )
      INSERT INTO "korisnik_prava" (
        "id",
        "agencija_id",
        "korisnik_id",
        "firma_id",
        "modul",
        "akcija",
        "dozvoljeno",
        "created_at",
        "updated_at"
      )
      SELECT
        gen_random_uuid(),
        assignment."agencija_id",
        assignment."korisnik_id",
        assignment."firma_id",
        module."modul",
        permission."akcija",
        true,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM legacy_assignments AS assignment
      CROSS JOIN (
        VALUES
          ('pos'),
          ('nalozi'),
          ('robno'),
          ('kalkulacije'),
          ('izlazni_racuni'),
          ('ulazni_racuni'),
          ('izvodi'),
          ('plate'),
          ('pdv'),
          ('zavrsni_racun'),
          ('izvjestaji')
      ) AS module("modul")
      CROSS JOIN LATERAL (
        VALUES
          ('view', assignment."moze_da_gleda"),
          ('create', assignment."moze_da_unosi"),
          ('update', assignment."moze_da_mijenja"),
          ('delete', assignment."moze_da_brise")
      ) AS permission("akcija", "dozvoljeno")
      WHERE permission."dozvoljeno" = true
      ON CONFLICT (
        "agencija_id",
        "korisnik_id",
        "firma_id",
        "modul",
        "akcija"
      ) DO NOTHING
    $migration$;
  END IF;
END $$;
