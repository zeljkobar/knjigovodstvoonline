import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DEFAULT_OLD_SITE_DIR = "/Users/summasummarum/Desktop/sajt/moj-sajt";
const OLD_SITE_DIR = process.env.OLD_SITE_DIR || DEFAULT_OLD_SITE_DIR;
const BATCH_SIZE = Number.parseInt(process.env.IMPORT_BATCH_SIZE || "1000", 10);

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const values = {};
  const text = readFileSync(filePath, "utf8");

  for (const line of text.split(/\r?\n/)) {
    const cleanLine = line.trim();
    if (!cleanLine || cleanLine.startsWith("#") || !cleanLine.includes("=")) {
      continue;
    }

    const [rawKey, ...rawValueParts] = cleanLine.split("=");
    const key = rawKey.trim();
    const rawValue = rawValueParts.join("=").trim();
    values[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }

  return values;
}

function loadMysql() {
  try {
    const localRequire = createRequire(import.meta.url);
    return localRequire("mysql2/promise");
  } catch {
    const oldSiteRequire = createRequire(resolve(OLD_SITE_DIR, "package.json"));
    return oldSiteRequire("mysql2/promise");
  }
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function nullableText(value) {
  const text = normalizeText(value);
  return text || null;
}

function normalizePib(value) {
  const digits = normalizeText(value).replace(/\D/g, "");
  if (!digits) {
    return "";
  }

  return digits.length === 7 ? `0${digits}` : digits;
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  const raw = normalizeText(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  }

  const dotFormat = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/);
  if (dotFormat) {
    const day = dotFormat[1].padStart(2, "0");
    const month = dotFormat[2].padStart(2, "0");
    return new Date(`${dotFormat[3]}-${month}-${day}T00:00:00.000Z`);
  }

  return null;
}

function normalizeActivityCode(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const match = text.match(/^(\d{2,6}(?:\.\d{1,2})?)/);
  return match?.[1] ?? text.split(",")[0].trim();
}

function mapRow(row) {
  const pib = normalizePib(row.pib);

  if (!/^\d{8}$/.test(pib)) {
    return null;
  }

  const naziv = normalizeText(row.naziv);
  if (!naziv) {
    return null;
  }

  return {
    naziv,
    scope: "GLOBAL",
    agencija_id: null,
    firma_id: null,
    pib,
    pravna_forma: nullableText(row.oblik_organizacije),
    sifra_djelatnosti: normalizeActivityCode(row.kd),
    datum_registracije: normalizeDate(row.datum_registracije),
    grad: nullableText(row.grad),
    drzava: "Crna Gora",
    telefon: nullableText(row.telefon),
    email: nullableText(row.email),
    web_sajt: nullableText(row.web),
    aktivan: true
  };
}

async function createMysqlPool() {
  const mysql = loadMysql();
  const env = loadEnvFile(resolve(OLD_SITE_DIR, ".env"));

  return mysql.createPool({
    host: process.env.OLD_MYSQL_HOST || env.DB_HOST || "localhost",
    port: Number(process.env.OLD_MYSQL_PORT || env.DB_PORT || 3306),
    user: process.env.OLD_MYSQL_USER || env.DB_USER || "root",
    password: process.env.OLD_MYSQL_PASSWORD || env.DB_PASSWORD || "",
    database: process.env.OLD_MYSQL_DATABASE || env.DB_NAME || "summasum_",
    waitForConnections: true,
    connectionLimit: 4,
    charset: "utf8mb4"
  });
}

async function countSourceRows(mysqlPool) {
  const [rows] = await mysqlPool.execute(
    "SELECT COUNT(*) AS total FROM emails WHERE pib IS NOT NULL AND TRIM(pib) REGEXP '^[0-9]{7,8}$' AND naziv IS NOT NULL AND TRIM(naziv) <> ''"
  );

  return Number(rows?.[0]?.total || 0);
}

async function readSourceBatch(mysqlPool, offset) {
  const [rows] = await mysqlPool.execute(
    `
      SELECT pib, naziv, oblik_organizacije, datum_registracije, grad, email, telefon, web, kd
      FROM emails
      WHERE pib IS NOT NULL
        AND TRIM(pib) REGEXP '^[0-9]{7,8}$'
        AND naziv IS NOT NULL
        AND TRIM(naziv) <> ''
      ORDER BY id
      LIMIT ? OFFSET ?
    `,
    [BATCH_SIZE, offset]
  );

  return rows;
}

async function importBatch(rows) {
  const mapped = rows.map(mapRow).filter(Boolean);
  const uniqueByPib = new Map(mapped.map((row) => [row.pib, row]));
  const records = Array.from(uniqueByPib.values());

  if (!records.length) {
    return { inserted: 0, updated: 0, skipped: rows.length };
  }

  const pibs = records.map((row) => row.pib);
  const existing = await prisma.komitent.findMany({
    where: {
      scope: "GLOBAL",
      pib: {
        in: pibs
      }
    },
    select: {
      id: true,
      pib: true
    }
  });
  const existingByPib = new Map(existing.map((row) => [row.pib, row.id]));

  const toCreate = records.filter((row) => !existingByPib.has(row.pib));
  const toUpdate = records.filter((row) => existingByPib.has(row.pib));

  if (toCreate.length) {
    await prisma.komitent.createMany({
      data: toCreate,
      skipDuplicates: true
    });
  }

  for (const row of toUpdate) {
    await prisma.komitent.updateMany({
      where: {
        scope: "GLOBAL",
        pib: row.pib
      },
      data: row
    });
  }

  return {
    inserted: toCreate.length,
    updated: toUpdate.length,
    skipped: rows.length - records.length
  };
}

async function main() {
  const mysqlPool = await createMysqlPool();
  try {
    const sourceTotal = await countSourceRows(mysqlPool);
    const summary = {
      sourceTotal,
      processed: 0,
      inserted: 0,
      updated: 0,
      skipped: 0
    };

    console.log(`Import globalnih partnera iz stare baze: ${sourceTotal} kandidata.`);

    for (let offset = 0; offset < sourceTotal; offset += BATCH_SIZE) {
      const rows = await readSourceBatch(mysqlPool, offset);
      const result = await importBatch(rows);

      summary.processed += rows.length;
      summary.inserted += result.inserted;
      summary.updated += result.updated;
      summary.skipped += result.skipped;

      console.log(
        `Obradjeno ${summary.processed}/${sourceTotal} | novo ${summary.inserted} | azurirano ${summary.updated} | preskoceno ${summary.skipped}`
      );
    }

    const globalCount = await prisma.komitent.count({
      where: {
        scope: "GLOBAL"
      }
    });

    console.log("Import zavrsen.");
    console.log(
      JSON.stringify(
        {
          ...summary,
          globalPartnersInNewDatabase: globalCount
        },
        null,
        2
      )
    );
  } finally {
    await mysqlPool.end();
  }
}

main()
  .catch((error) => {
    console.error("Import nije uspio:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
