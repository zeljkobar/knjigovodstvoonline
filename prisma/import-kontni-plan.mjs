import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const sourcePath = resolve("zadaci/kontni_plan_GK_KontP.csv");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(value);
      if (row.some((cell) => cell !== "")) {
        rows.push(row);
      }
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function readRows() {
  const text = readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, "");
  const [headers, ...rows] = parseCsv(text);

  return rows.map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]))
  );
}

function parentAccount(code, allCodes) {
  for (let length = code.length - 1; length > 0; length -= 1) {
    const candidate = code.slice(0, length);
    if (allCodes.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

function hasChildren(code, allCodes) {
  return Array.from(allCodes).some(
    (candidate) => candidate !== code && candidate.startsWith(code)
  );
}

function normalBalanceForAccountCode(code) {
  const accountClass = code.trim().slice(0, 1);

  if (["0", "1", "2", "5"].includes(accountClass)) {
    return "D";
  }

  if (["3", "4", "6"].includes(accountClass)) {
    return "P";
  }

  return null;
}

async function main() {
  const rawRows = readRows();
  const rows = rawRows
    .map((row) => ({
      sifra: String(row.Konto ?? "").trim(),
      naziv: String(row.NAZ150 || row.Naziv || "").trim(),
      stat: String(row.Stat ?? "").trim(),
      koristiRadnuJedinicu: String(row.unosRJ ?? "").trim().toLowerCase() === "true"
    }))
    .filter((row) => row.sifra && row.naziv);

  const seen = new Set();
  const duplicates = [];
  for (const row of rows) {
    if (seen.has(row.sifra)) {
      duplicates.push(row.sifra);
    }
    seen.add(row.sifra);
  }

  if (duplicates.length > 0) {
    throw new Error(`CSV ima duplikate konta: ${duplicates.slice(0, 20).join(", ")}`);
  }

  const allCodes = new Set(rows.map((row) => row.sifra));
  let imported = 0;

  for (const row of rows) {
    const tipKonta = hasChildren(row.sifra, allCodes) ? "sinteticko" : "analiticko";

    await prisma.konto.upsert({
      where: {
        sifra: row.sifra
      },
      create: {
        sifra: row.sifra,
        naziv: row.naziv,
        klasa: row.sifra.slice(0, 1),
        tip_konta: tipKonta,
        analitika_obavezna: row.stat === "AK",
        sinteticki_konto: parentAccount(row.sifra, allCodes),
        normalni_saldo: normalBalanceForAccountCode(row.sifra),
        koristi_radnu_jedinicu: row.koristiRadnuJedinicu,
        aktivan: true
      },
      update: {
        naziv: row.naziv,
        klasa: row.sifra.slice(0, 1),
        tip_konta: tipKonta,
        analitika_obavezna: row.stat === "AK",
        sinteticki_konto: parentAccount(row.sifra, allCodes),
        normalni_saldo: normalBalanceForAccountCode(row.sifra),
        koristi_radnu_jedinicu: row.koristiRadnuJedinicu,
        aktivan: true
      }
    });

    imported += 1;
  }

  const importedCodes = rows.map((row) => row.sifra);
  const deactivated = await prisma.konto.updateMany({
    where: {
      sifra: {
        notIn: importedCodes
      }
    },
    data: {
      aktivan: false
    }
  });

  console.log(`Importovan kontni plan: ${imported} konta iz ${sourcePath}`);
  console.log(`Deaktivirana konta van CSV-a: ${deactivated.count}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
