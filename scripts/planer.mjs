// Planer: tekstualni izvor (CSV po listu) <-> Excel
//
// Upotreba:
//   node scripts/planer.mjs dump    # Excel  -> zadaci/planer/*.csv (+ manifest.json)
//   node scripts/planer.mjs build   # CSV    -> Excel (regeneracija .xlsx)
//
// CSV fajlovi u zadaci/planer/ su "source of truth" koji agenti uredjuju.
// Excel se regenerise iz njih (napomena: stilovi/boje se NE cuvaju jer
// besplatni SheetJS ne pise stilove).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const XLSX_PATH = path.join(
  ROOT,
  "zadaci",
  "Planer_Racunovodstveni_Program_AZURIRAN_M1-M3.xlsx"
);
const PLANER_DIR = path.join(ROOT, "zadaci", "planer");
const MANIFEST_PATH = path.join(PLANER_DIR, "manifest.json");

function sanitizeFileName(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

function dump() {
  if (!fs.existsSync(XLSX_PATH)) {
    console.error(`Nema Excel fajla: ${XLSX_PATH}`);
    process.exit(1);
  }

  fs.mkdirSync(PLANER_DIR, { recursive: true });

  const wb = XLSX.readFile(XLSX_PATH);
  const manifest = [];
  const used = new Set();

  for (const sheet of wb.SheetNames) {
    let base = sanitizeFileName(sheet);
    let file = `${base}.csv`;
    let i = 2;
    while (used.has(file.toLowerCase())) {
      file = `${base} (${i})`.concat(".csv");
      i += 1;
    }
    used.add(file.toLowerCase());

    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheet], { forceQuotes: false });
    fs.writeFileSync(path.join(PLANER_DIR, file), csv, "utf8");
    manifest.push({ sheet, file });
  }

  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Dump: ${manifest.length} listova -> ${path.relative(ROOT, PLANER_DIR)}/`);
}

function build() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Nema manifesta: ${MANIFEST_PATH}. Pokreni prvo "dump".`);
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const wb = XLSX.utils.book_new();

  for (const { sheet, file } of manifest) {
    const csvPath = path.join(PLANER_DIR, file);
    if (!fs.existsSync(csvPath)) {
      console.error(`Nedostaje CSV: ${csvPath}`);
      process.exit(1);
    }
    const csv = fs.readFileSync(csvPath, "utf8");
    const tmp = XLSX.read(csv, { type: "string", FS: "," });
    const ws = tmp.Sheets[tmp.SheetNames[0]];
    // Excel ime lista je max 31 znak
    XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 31));
  }

  XLSX.writeFile(wb, XLSX_PATH);
  console.log(`Build: ${manifest.length} listova -> ${path.relative(ROOT, XLSX_PATH)}`);
}

const cmd = process.argv[2];
if (cmd === "dump") {
  dump();
} else if (cmd === "build") {
  build();
} else {
  console.error('Upotreba: node scripts/planer.mjs <dump|build>');
  process.exit(1);
}
