import "server-only";
import { unstable_cache } from "next/cache";
import { driveChildren, driveItemPath, graph, oneDriveAccess, type DriveItem } from "./dokumentacija-onedrive";
import { inspectBankStatementFile, importBankStatementFromCloud } from "./bank-statement-service";
import { statementIdentity } from "./bank-statement-identity";
import { normalizeStatementAccount, supportedStatementAttachment } from "./mail-import-policy";
import { prisma } from "./prisma";
import type { DokumentaScope } from "./dokumentacija";

const maxBytes = 20 * 1024 * 1024;
type Mapping = Awaited<ReturnType<typeof statementCloudFolders>>[number];
type StatementInfo = NonNullable<Awaited<ReturnType<typeof inspectBankStatementFile>>>;
export type CloudRow = { id: string; name: string; version?: string; number?: string; status: "NEW" | "IMPORTED" | "POSTED" | "REVIEW"; reason?: string };

export function statementCloudFolders(scope: DokumentaScope) {
  return prisma.bankStatementArchiveFolder.findMany({
    where: { ...scope, bankovni_racun: { agencija_id: scope.agencija_id, firma_id: scope.firma_id, aktivan: true, is_deleted: false } },
    include: { bankovni_racun: true }, orderBy: { bankovni_racun: { naziv_banke: "asc" } }
  });
}

async function cloudFile(token: string, mapping: Mapping, id: string, version?: string) {
  const item = await graph<DriveItem & { "@microsoft.graph.downloadUrl"?: string }>(token, driveItemPath(mapping.drive_id, id));
  const address = item["@microsoft.graph.downloadUrl"];
  if (!item.file || !supportedStatementAttachment(item.name) || !item.size || item.size > maxBytes ||
      item.parentReference?.id !== mapping.folder_id || item.parentReference?.driveId !== mapping.drive_id ||
      (version && item.eTag !== version) || !address || new URL(address).protocol !== "https:") {
    throw new Error("Fajl više nije dostupan u povezanom folderu ili prelazi 20 MB.");
  }
  const response = await fetch(address, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok || !response.body) throw new Error("OneDrive preuzimanje nije uspjelo.");
  const reader = response.body.getReader();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("Fajl prelazi 20 MB.");
      }
      parts.push(new Uint8Array(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (size !== item.size) throw new Error("OneDrive fajl je izmijenjen tokom preuzimanja.");
  return new File(parts, item.name, { type: item.file.mimeType });
}

export async function scanStatementCloud(scope: DokumentaScope, year: number, mappings: Mapping[]) {
  const access = await oneDriveAccess(scope.agencija_id);
  const statements = await prisma.bankStatement.findMany({
    where: { ...scope },
    select: { statement_number: true, statement_date: true, sadrzaj_hash: true, company_bank_account_id: true,
      status: true, is_deleted: true, opening_balance: true, closing_balance: true,
      total_inflow: true, total_outflow: true, journal: { select: { status: true, is_deleted: true } } }
  });
  const groups = [];
  for (const mapping of mappings) {
    if (mapping.drive_id !== access.driveId) throw new Error("OneDrive folder je vezan za drugi disk.");
    const items = (await driveChildren(access.token, access.driveId, mapping.folder_id))
      .filter(item => item.file && supportedStatementAttachment(item.name));
    const rows: CloudRow[] = [];
    const verified = new Map<string, { row: CloudRow; info: StatementInfo }>();
    const stored = new Map<string, typeof statements>();
    for (const statement of statements) {
      if (statement.company_bank_account_id !== mapping.bankovni_racun_id) continue;
      const key = statementIdentity(statement.statement_number, year);
      const matches = stored.get(key) ?? [];
      matches.push(statement);
      stored.set(key, matches);
    }

    for (let offset = 0; offset < items.length; offset += 6) {
      const batch = await Promise.all(items.slice(offset, offset + 6).map(async item => {
        const read = async () => inspectBankStatementFile(
          await cloudFile(access.token, mapping, item.id, item.eTag), mapping.bankovni_racun.naziv_banke
        );
        try {
          const info = item.eTag ? await unstable_cache(read, ["bank-cloud-v1", scope.agencija_id, scope.firma_id,
            scope.poslovna_godina_id, mapping.bankovni_racun_id, mapping.drive_id, mapping.folder_id, item.id, item.eTag,
            mapping.bankovni_racun.naziv_banke], { revalidate: 86400 })() : await read();
          return { item, info };
        } catch {
          return { item, info: null };
        }
      }));
      for (const { item, info } of batch) {
        const row: CloudRow = { id: item.id, name: item.name, version: item.eTag, number: info?.number, status: "REVIEW" };
        rows.push(row);
        if (!info || info.account !== normalizeStatementAccount(mapping.bankovni_racun.broj_racuna) ||
            !info.account || Number(info.date.slice(0, 4)) !== year) {
          row.reason = "Fajl je nedostupan ili broj izvoda, račun i godina nijesu potvrđeni.";
          continue;
        }
        const key = statementIdentity(info.number, year);
        const matches = stored.get(key) ?? [];
        const match = matches[0];
        const compatible = !match || (!match.is_deleted && match.statement_date.toISOString().slice(0, 10) === info.date &&
          Math.round(Number(match.opening_balance) * 100) === info.openingBalance &&
          Math.round(Number(match.closing_balance) * 100) === info.closingBalance &&
          Math.round(Number(match.total_inflow) * 100) === info.inflow && Math.round(Number(match.total_outflow) * 100) === info.outflow);
        if (matches.length > 1 || !compatible) {
          row.reason = "Izvod sa ovim brojem postoji, ali zahtijeva provjeru.";
          continue;
        }
        const prior = verified.get(key);
        if (prior && prior.info.hash !== info.hash) {
          prior.row.status = "REVIEW";
          prior.row.reason = row.reason = "Više različitih fajlova ima isti broj izvoda.";
          continue;
        }
        if (prior) rows.pop();
        else {
          row.status = match ? match.status === "POSTED" && match.journal?.status === "POSTED" && !match.journal.is_deleted ? "POSTED" : "IMPORTED" : "NEW";
          verified.set(key, { row, info });
        }
      }
    }
    groups.push({ bankId: mapping.bankovni_racun_id,
      bankLabel: `${mapping.bankovni_racun.naziv_banke} · ${mapping.bankovni_racun.broj_racuna}`, rows });
  }
  return groups;
}

export async function importCloudStatement(scope: DokumentaScope, bankId: string, itemId: string, version?: string) {
  const mapping = (await statementCloudFolders(scope)).find(folder => folder.bankovni_racun_id === bankId);
  if (!mapping) throw new Error("Povezani folder nije dostupan.");
  const { token, driveId } = await oneDriveAccess(scope.agencija_id);
  if (driveId !== mapping.drive_id) throw new Error("Povezani folder nije dostupan.");
  const file = await cloudFile(token, mapping, itemId, version);
  return importBankStatementFromCloud(file, { firmaId: scope.firma_id, yearId: scope.poslovna_godina_id, bankId });
}
