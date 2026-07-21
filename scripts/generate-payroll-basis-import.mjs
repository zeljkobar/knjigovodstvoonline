import fs from "node:fs";
import path from "node:path";
import xlsx from "xlsx";

const repoRoot = process.cwd();
const sourcePath = "zadaci/plate/specifikacija-osnova-za-obracun-oktobar-2024-novine-pio-i-od-01012025.xls";
const outputPath = "prisma/migrations/20260719133000_plate_osnove_full_import/migration.sql";
const workbook = xlsx.readFile(path.join(repoRoot, sourcePath));
const worksheet = workbook.Sheets["Kontrole poreza i doprinosa"];
const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: "" }).slice(2);

function normalize(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function sql(value) {
  if (value === null || value === undefined || value === "") {
    return "NULL";
  }

  return `'${String(value).replace(/'/g, "''")}'`;
}

function jsonSql(value) {
  return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
}

function decimal(value) {
  return Number.isFinite(value) ? value.toFixed(6) : "NULL";
}

function parseBasisCell(value) {
  const raw = normalize(value);
  const match = raw.match(/^(\d{3})\s*[-–]\s*(.+)$/);

  if (!match) {
    return null;
  }

  return {
    sifra: match[1],
    naziv: match[2].replace(/[;.]?\s*$/, "")
  };
}

function categoryFor(name) {
  const lower = name.toLocaleLowerCase("sr-Latn");

  if (lower.includes("zakup") || lower.includes("imovine")) {
    return "ZAKUP";
  }

  if (lower.includes("ugovor") || lower.includes("naknada")) {
    return "UGOVORI";
  }

  if (lower.includes("zarada") || lower.includes("zaposlen")) {
    return "REDOVAN_RAD";
  }

  return "OSTALO";
}

function baseType(rawValue) {
  const raw = normalize(rawValue).toLocaleLowerCase("sr-Latn");

  if (!raw) {
    return null;
  }

  if (raw.includes("70%") && raw.includes("bruto")) {
    return "PROCENAT_BRUTO";
  }

  if (raw.includes("bruto")) {
    return "BRUTO";
  }

  if (raw.includes("neto")) {
    return "NETO";
  }

  return "OPISNO";
}

function basePercent(rawValue) {
  const raw = normalize(rawValue);
  const match = raw.match(/(\d+(?:[,.]\d+)?)\s*%/);

  if (!match) {
    return 100;
  }

  const parsed = Number(match[1].replace(",", "."));

  return Number.isFinite(parsed) ? parsed : 100;
}

function parseRate(rawValue) {
  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return rawValue;
  }

  const raw = normalize(rawValue).toLocaleLowerCase("sr-Latn");

  if (!raw || raw.includes("poreska skala")) {
    return null;
  }

  const matches = [...raw.matchAll(/(\d+(?:[,.]\d+)?)\s*%/g)];

  if (matches.length === 0) {
    return null;
  }

  const lastMatch = matches[matches.length - 1];
  const beforeLastPercent = raw.slice(0, lastMatch.index ?? 0);
  const afterLastPercent = raw.slice((lastMatch.index ?? 0) + lastMatch[0].length);

  if (raw.includes("zaključno") && !beforeLastPercent.includes("od ") && !afterLastPercent.includes("od ")) {
    return null;
  }

  const parsed = Number(lastMatch[1].replace(",", "."));

  return Number.isFinite(parsed) ? parsed / 100 : null;
}

function rateRows(sifra, row) {
  const specs = [
    ["PIO", "ZAPOSLENI", row[17]],
    ["RFZO", "ZAPOSLENI", row[18]],
    ["ZZZ", "ZAPOSLENI", row[19]],
    ["POREZ", "POREZ", row[20]],
    ["PIO", "POSLODAVAC", row[21]],
    ["RFZO", "POSLODAVAC", row[22]],
    ["ZZZ", "POSLODAVAC", row[23]],
    ["FOND_RADA", "POSLODAVAC", row[24]]
  ];

  return specs
    .map(([tip, teret, rawValue]) => ({
      sifra,
      tip,
      teret,
      stopa: parseRate(rawValue),
      napomena: normalize(rawValue)
    }))
    .filter((item) => item.stopa !== null);
}

const data = rows
  .map((row) => {
    const basis = parseBasisCell(row[0]);

    if (!basis) {
      return null;
    }

    return {
      sifra: basis.sifra,
      naziv: basis.naziv,
      kategorija: categoryFor(basis.naziv),
      pio_osnovica: normalize(row[1]),
      pio_min: normalize(row[2]),
      pio_max: normalize(row[3]),
      pio_rok: normalize(row[4]),
      rfzo_osnovica: normalize(row[5]),
      rfzo_min: normalize(row[6]),
      rfzo_max: normalize(row[7]),
      rfzo_rok: normalize(row[8]),
      zzz_osnovica: normalize(row[9]),
      zzz_min: normalize(row[10]),
      zzz_max: normalize(row[11]),
      zzz_rok: normalize(row[12]),
      porez_osnovica: normalize(row[13]),
      porez_min: normalize(row[14]),
      porez_max: normalize(row[15]),
      porez_rok: normalize(row[16]),
      pio_tip: baseType(row[1]),
      pio_proc: basePercent(row[1]),
      rfzo_tip: baseType(row[5]),
      rfzo_proc: basePercent(row[5]),
      zzz_tip: baseType(row[9]),
      zzz_proc: basePercent(row[9]),
      porez_tip: baseType(row[13]),
      porez_proc: basePercent(row[13]),
      izvorni_podaci: {
        sifra: basis.sifra,
        naziv: basis.naziv,
        osnovica_pio: {
          osnovica: normalize(row[1]),
          min: normalize(row[2]),
          max: normalize(row[3]),
          rok: normalize(row[4])
        },
        osnovica_rfzo: {
          osnovica: normalize(row[5]),
          min: normalize(row[6]),
          max: normalize(row[7]),
          rok: normalize(row[8])
        },
        osnovica_zzz: {
          osnovica: normalize(row[9]),
          min: normalize(row[10]),
          max: normalize(row[11]),
          rok: normalize(row[12])
        },
        osnovica_porez: {
          osnovica: normalize(row[13]),
          min: normalize(row[14]),
          max: normalize(row[15]),
          rok: normalize(row[16])
        },
        stope: {
          zaposleni_pio: normalize(row[17]),
          zaposleni_rfzo: normalize(row[18]),
          zaposleni_zzz: normalize(row[19]),
          porez: normalize(row[20]),
          poslodavac_pio: normalize(row[21]),
          poslodavac_rfzo: normalize(row[22]),
          poslodavac_zzz: normalize(row[23]),
          fond_rada: normalize(row[24])
        }
      },
      rates: rateRows(basis.sifra, row)
    };
  })
  .filter(Boolean);

const basisValues = data
  .map(
    (item) => `(
  ${sql(item.sifra)},
  ${sql(item.naziv)},
  ${sql(item.kategorija)},
  ${sql(item.pio_osnovica)},
  ${sql(item.pio_min)},
  ${sql(item.pio_max)},
  ${sql(item.pio_rok)},
  ${sql(item.rfzo_osnovica)},
  ${sql(item.rfzo_min)},
  ${sql(item.rfzo_max)},
  ${sql(item.rfzo_rok)},
  ${sql(item.zzz_osnovica)},
  ${sql(item.zzz_min)},
  ${sql(item.zzz_max)},
  ${sql(item.zzz_rok)},
  ${sql(item.porez_osnovica)},
  ${sql(item.porez_min)},
  ${sql(item.porez_max)},
  ${sql(item.porez_rok)},
  ${sql(item.pio_tip)},
  ${item.pio_proc.toFixed(2)},
  ${sql(item.rfzo_tip)},
  ${item.rfzo_proc.toFixed(2)},
  ${sql(item.zzz_tip)},
  ${item.zzz_proc.toFixed(2)},
  ${sql(item.porez_tip)},
  ${item.porez_proc.toFixed(2)},
  ${jsonSql(item.izvorni_podaci)}
)`
  )
  .join(",\n");

const rateValues = data
  .flatMap((item) => item.rates)
  .map(
    (item) => `(
  ${sql(item.sifra)},
  ${sql(item.tip)},
  ${sql(item.teret)},
  ${decimal(item.stopa)},
  ${sql(item.napomena)}
)`
  )
  .join(",\n");

const migration = `ALTER TABLE "plate_osnova_pravila"
  ADD COLUMN IF NOT EXISTS "izvorni_podaci" jsonb;

CREATE TEMP TABLE "_plate_osnove_import" (
  "sifra" text NOT NULL,
  "naziv" text NOT NULL,
  "kategorija" text,
  "pio_osnovica" text,
  "pio_min" text,
  "pio_max" text,
  "pio_rok" text,
  "rfzo_osnovica" text,
  "rfzo_min" text,
  "rfzo_max" text,
  "rfzo_rok" text,
  "zzz_osnovica" text,
  "zzz_min" text,
  "zzz_max" text,
  "zzz_rok" text,
  "porez_osnovica" text,
  "porez_min" text,
  "porez_max" text,
  "porez_rok" text,
  "pio_tip" text,
  "pio_proc" decimal(8,2),
  "rfzo_tip" text,
  "rfzo_proc" decimal(8,2),
  "zzz_tip" text,
  "zzz_proc" decimal(8,2),
  "porez_tip" text,
  "porez_proc" decimal(8,2),
  "izvorni_podaci" jsonb NOT NULL
);

INSERT INTO "_plate_osnove_import" (
  "sifra",
  "naziv",
  "kategorija",
  "pio_osnovica",
  "pio_min",
  "pio_max",
  "pio_rok",
  "rfzo_osnovica",
  "rfzo_min",
  "rfzo_max",
  "rfzo_rok",
  "zzz_osnovica",
  "zzz_min",
  "zzz_max",
  "zzz_rok",
  "porez_osnovica",
  "porez_min",
  "porez_max",
  "porez_rok",
  "pio_tip",
  "pio_proc",
  "rfzo_tip",
  "rfzo_proc",
  "zzz_tip",
  "zzz_proc",
  "porez_tip",
  "porez_proc",
  "izvorni_podaci"
)
VALUES
${basisValues};

CREATE TEMP TABLE "_plate_osnove_stope_import" (
  "sifra" text NOT NULL,
  "tip" text NOT NULL,
  "teret" text NOT NULL,
  "stopa" decimal(8,6) NOT NULL,
  "napomena" text
);

${rateValues ? `INSERT INTO "_plate_osnove_stope_import" ("sifra", "tip", "teret", "stopa", "napomena")
VALUES
${rateValues};` : ""}

INSERT INTO "plate_osnove_obracuna" (
  "sifra",
  "naziv",
  "opis",
  "kategorija",
  "source",
  "valid_from"
)
SELECT
  i."sifra",
  i."naziv",
  NULL,
  i."kategorija",
  '${sourcePath}',
  DATE '2025-01-01'
FROM "_plate_osnove_import" i
WHERE NOT EXISTS (
  SELECT 1
  FROM "plate_osnove_obracuna" o
  WHERE o."sifra" = i."sifra"
);

UPDATE "plate_osnove_obracuna" o
SET
  "naziv" = i."naziv",
  "opis" = NULL,
  "kategorija" = i."kategorija",
  "source" = '${sourcePath}',
  "aktivan" = true
FROM "_plate_osnove_import" i
WHERE o."sifra" = i."sifra";

WITH latest_rules AS (
  SELECT DISTINCT ON (o."sifra")
    o."sifra",
    p."id"
  FROM "plate_osnove_obracuna" o
  JOIN "plate_osnova_pravila" p ON p."osnova_id" = o."id"
  JOIN "_plate_osnove_import" i ON i."sifra" = o."sifra"
  ORDER BY o."sifra", p."valid_from" DESC, p."created_at" DESC
)
UPDATE "plate_osnova_pravila" p
SET
  "valid_from" = DATE '2025-01-01',
  "osnovica_pio_tip" = i."pio_tip",
  "osnovica_pio_proc" = i."pio_proc",
  "pio_min_tip" = i."pio_min",
  "pio_max_tip" = i."pio_max",
  "pio_rok" = i."pio_rok",
  "osnovica_rfzo_tip" = i."rfzo_tip",
  "osnovica_rfzo_proc" = i."rfzo_proc",
  "rfzo_min_tip" = i."rfzo_min",
  "rfzo_max_tip" = i."rfzo_max",
  "rfzo_rok" = i."rfzo_rok",
  "osnovica_zzz_tip" = i."zzz_tip",
  "osnovica_zzz_proc" = i."zzz_proc",
  "zzz_min_tip" = i."zzz_min",
  "zzz_max_tip" = i."zzz_max",
  "zzz_rok" = i."zzz_rok",
  "osnovica_porez_tip" = i."porez_tip",
  "osnovica_porez_proc" = i."porez_proc",
  "porez_min_tip" = i."porez_min",
  "porez_max_tip" = i."porez_max",
  "porez_rok" = i."porez_rok",
  "napomena" = concat_ws(E'\\n',
    nullif('PIO osnovica: ' || i."pio_osnovica", 'PIO osnovica: '),
    nullif('RFZO osnovica: ' || i."rfzo_osnovica", 'RFZO osnovica: '),
    nullif('ZZZ osnovica: ' || i."zzz_osnovica", 'ZZZ osnovica: '),
    nullif('Porez osnovica: ' || i."porez_osnovica", 'Porez osnovica: ')
  ),
  "izvorni_podaci" = i."izvorni_podaci",
  "aktivan" = true
FROM latest_rules lr
JOIN "_plate_osnove_import" i ON i."sifra" = lr."sifra"
WHERE p."id" = lr."id";

INSERT INTO "plate_osnova_pravila" (
  "osnova_id",
  "valid_from",
  "osnovica_pio_tip",
  "osnovica_pio_proc",
  "pio_min_tip",
  "pio_max_tip",
  "pio_rok",
  "osnovica_rfzo_tip",
  "osnovica_rfzo_proc",
  "rfzo_min_tip",
  "rfzo_max_tip",
  "rfzo_rok",
  "osnovica_zzz_tip",
  "osnovica_zzz_proc",
  "zzz_min_tip",
  "zzz_max_tip",
  "zzz_rok",
  "osnovica_porez_tip",
  "osnovica_porez_proc",
  "porez_min_tip",
  "porez_max_tip",
  "porez_rok",
  "napomena",
  "izvorni_podaci"
)
SELECT
  o."id",
  DATE '2025-01-01',
  i."pio_tip",
  i."pio_proc",
  i."pio_min",
  i."pio_max",
  i."pio_rok",
  i."rfzo_tip",
  i."rfzo_proc",
  i."rfzo_min",
  i."rfzo_max",
  i."rfzo_rok",
  i."zzz_tip",
  i."zzz_proc",
  i."zzz_min",
  i."zzz_max",
  i."zzz_rok",
  i."porez_tip",
  i."porez_proc",
  i."porez_min",
  i."porez_max",
  i."porez_rok",
  concat_ws(E'\\n',
    nullif('PIO osnovica: ' || i."pio_osnovica", 'PIO osnovica: '),
    nullif('RFZO osnovica: ' || i."rfzo_osnovica", 'RFZO osnovica: '),
    nullif('ZZZ osnovica: ' || i."zzz_osnovica", 'ZZZ osnovica: '),
    nullif('Porez osnovica: ' || i."porez_osnovica", 'Porez osnovica: ')
  ),
  i."izvorni_podaci"
FROM "_plate_osnove_import" i
JOIN "plate_osnove_obracuna" o ON o."sifra" = i."sifra"
WHERE NOT EXISTS (
  SELECT 1
  FROM "plate_osnova_pravila" p
  WHERE p."osnova_id" = o."id"
);

WITH latest_rules AS (
  SELECT DISTINCT ON (o."sifra")
    o."sifra",
    p."id"
  FROM "plate_osnove_obracuna" o
  JOIN "plate_osnova_pravila" p ON p."osnova_id" = o."id"
  JOIN "_plate_osnove_import" i ON i."sifra" = o."sifra"
  ORDER BY o."sifra", p."valid_from" DESC, p."created_at" DESC
)
DELETE FROM "plate_osnova_stope" s
USING latest_rules lr
WHERE s."pravilo_id" = lr."id";

WITH latest_rules AS (
  SELECT DISTINCT ON (o."sifra")
    o."sifra",
    p."id"
  FROM "plate_osnove_obracuna" o
  JOIN "plate_osnova_pravila" p ON p."osnova_id" = o."id"
  JOIN "_plate_osnove_import" i ON i."sifra" = o."sifra"
  ORDER BY o."sifra", p."valid_from" DESC, p."created_at" DESC
)
INSERT INTO "plate_osnova_stope" (
  "pravilo_id",
  "tip",
  "teret",
  "stopa",
  "osnovica_tip",
  "valid_from",
  "napomena"
)
SELECT
  lr."id",
  r."tip",
  r."teret",
  r."stopa",
  CASE WHEN r."tip" = 'POREZ' THEN 'OSNOVICA_POREZ' ELSE 'BRUTO' END,
  DATE '2025-01-01',
  r."napomena"
FROM "_plate_osnove_stope_import" r
JOIN latest_rules lr ON lr."sifra" = r."sifra";

UPDATE "plate_sifre_primanja" sp
SET "osnova_obracuna_id" = o."id"
FROM "plate_osnove_obracuna" o
WHERE sp."sifra" = o."sifra"
  AND sp."osnova_obracuna_id" IS NULL;

DROP TABLE "_plate_osnove_stope_import";
DROP TABLE "_plate_osnove_import";
`;

fs.writeFileSync(path.join(repoRoot, outputPath), migration);
console.log(`Generated ${data.length} payroll bases -> ${outputPath}`);
