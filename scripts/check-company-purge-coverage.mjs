import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schema = readFileSync(resolve(root, "prisma/schema.prisma"), "utf8");
const purgeSource = readFileSync(resolve(root, "src/lib/company-purge.ts"), "utf8");

const companyTables = new Set();
const modelPattern = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;

for (const match of schema.matchAll(modelPattern)) {
  const [, modelName, body] = match;
  if (!/^\s*firma_id\s+/m.test(body)) continue;

  const mappedTable = body.match(/@@map\("([^"]+)"\)/)?.[1];
  if (!mappedTable) {
    console.error(`Model ${modelName} ima firma_id, ali nema @@map naziv tabele.`);
    process.exitCode = 1;
    continue;
  }

  companyTables.add(mappedTable);
}

const coveredTables = new Set(
  [...purgeSource.matchAll(/await\s+izvrsi\(\s*"([^"]+)"/g)].map(
    (match) => match[1]
  )
);

const missingTables = [...companyTables]
  .filter((table) => !coveredTables.has(table))
  .sort();

if (missingTables.length > 0) {
  console.error("Trajno brisanje firme nije uskladjeno sa Prisma semom.");
  console.error("Nedostaju tabele sa firma_id:");
  for (const table of missingTables) console.error(`- ${table}`);
  console.error(
    "Dopunite src/lib/company-purge.ts i rucno provjerite sve podredjene FK tabele."
  );
  process.exit(1);
}

console.log(
  `Purge pokriva svih ${companyTables.size} tabela koje imaju direktni firma_id.`
);
console.log(
  "Napomena: podredjene tabele bez firma_id moraju se provjeriti rucno po FK vezama."
);
