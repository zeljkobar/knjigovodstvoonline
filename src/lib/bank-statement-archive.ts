import "server-only";
import { Prisma } from "@prisma/client";
import { auditLogInTransaction } from "./audit";
import { getCompanyMailConfigs } from "./company-mail-settings";
import { driveItemPath, graph, GraphError, oneDriveAccess, type DriveItem } from "./dokumentacija-onedrive";
import { getMailAttachment, MailError } from "./imap-mail";
import { attachmentHash } from "./mail-import-policy";
import { prisma } from "./prisma";

class ArchiveReview extends Error {}

export function statementArchiveName(number: string, filename: string) {
  const extension = filename.match(/\.(pdf|xml|html?)$/i)?.[1].toLowerCase();
  const label = number.trim().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "");
  if (!label || !extension) throw new ArchiveReview("Provjerite broj i format izvoda.");
  return `${/^\d+$/.test(label) ? label.padStart(3, "0") : label.slice(0, 120)}.${extension === "htm" ? "html" : extension}`;
}

export async function archiveStatementAttachment(
  token: string, driveId: string, folderId: string, name: string, content: Buffer
) {
  const path = `${driveItemPath(driveId, folderId)}:/${encodeURIComponent(name)}`;
  try {
    const session = await graph<{ uploadUrl: string }>(token, `${path}:/createUploadSession`, {
      method: "POST", body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "fail", name } })
    });
    if (new URL(session.uploadUrl).protocol !== "https:") throw new Error("Neispravna OneDrive sesija.");
    const response = await fetch(session.uploadUrl, {
      method: "PUT", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(60_000),
      headers: { "Content-Length": String(content.length), "Content-Range": `bytes 0-${content.length - 1}/${content.length}` },
      body: new Uint8Array(content)
    });
    if (response.status !== 200 && response.status !== 201) throw new GraphError(response.status);
    const item = await response.json() as DriveItem;
    if (!item.id) throw new Error("OneDrive nije potvrdio fajl.");
    return item.id;
  } catch (error) {
    if (!(error instanceof GraphError) || ![409, 412].includes(error.status)) throw error;
  }

  const item = await graph<DriveItem & { "@microsoft.graph.downloadUrl"?: string }>(token, path);
  if (!item.file || item.size !== content.length) throw new ArchiveReview(`OneDrive već sadrži ${name} sa drugačijim sadržajem.`);
  const url = item["@microsoft.graph.downloadUrl"];
  if (!url || new URL(url).protocol !== "https:") throw new Error("OneDrive nije vratio adresu za provjeru.");
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new GraphError(response.status);
  if (attachmentHash(new Uint8Array(await response.arrayBuffer())) !== attachmentHash(content)) {
    throw new ArchiveReview(`OneDrive već sadrži ${name} sa drugačijim sadržajem.`);
  }
  return item.id;
}

const eligible = Prisma.sql`
  FROM mail_izvod_obrade m
  JOIN bank_statements b ON b.id = m.izvod_id AND b.agencija_id = m.agencija_id
    AND b.firma_id = m.firma_id AND b.poslovna_godina_id = m.poslovna_godina_id
  JOIN nalozi n ON n.id = b.journal_id AND n.agencija_id = b.agencija_id
    AND n.firma_id = b.firma_id AND n.poslovna_godina_id = b.poslovna_godina_id
  JOIN firme f ON f.id = b.firma_id AND f.agencija_id = b.agencija_id AND f.aktivan AND NOT f.is_deleted
  JOIN izvodi_arhiva_folderi a ON a.agencija_id = b.agencija_id AND a.firma_id = b.firma_id
    AND a.poslovna_godina_id = b.poslovna_godina_id AND a.bankovni_racun_id = b.company_bank_account_id
  WHERE b.status = 'POSTED' AND n.status = 'POSTED' AND NOT b.is_deleted AND NOT n.is_deleted
    AND m.imap_uid IS NOT NULL AND m.sadrzaj_hash IS NOT NULL
    AND (m.status = 'IMPORTED' OR (m.status = 'DUPLICATE' AND m.sadrzaj_hash = b.sadrzaj_hash))
    AND (m.arhiva_status IS NULL OR m.arhiva_status = 'RETRY')
`;

export async function runBankStatementArchive() {
  const jobs = await prisma.$queryRaw<{ id: string }[]>`
    SELECT m.id ${eligible}
    AND (m.arhiva_pokusaj_at IS NULL OR m.arhiva_pokusaj_at < timezone('UTC', now()) - interval '10 minutes')
    ORDER BY m.arhiva_pokusaj_at NULLS FIRST, m.created_at LIMIT 12
  `;
  for (const job of jobs) {
    const [claimed] = await prisma.$queryRaw<{ arhiva_pokusaj_at: Date }[]>`
      UPDATE mail_izvod_obrade SET arhiva_pokusaj_at = timezone('UTC', clock_timestamp())
      WHERE id = ${job.id}::uuid AND (arhiva_status IS NULL OR arhiva_status = 'RETRY')
      AND (arhiva_pokusaj_at IS NULL OR arhiva_pokusaj_at < timezone('UTC', now()) - interval '10 minutes')
      RETURNING arhiva_pokusaj_at
    `;
    if (!claimed) continue;
    const row = await prisma.mailIzvodObrada.findUnique({ where: { id: job.id } });
    if (!row?.imap_uid || !row.imap_uid_validity || !row.imap_folder || row.indeks_priloga === null) continue;
    let result: { arhiva_status: string; arhiva_greska: string | null; arhiva_item_id?: string };
    try {
      const config = (await getCompanyMailConfigs(row.agencija_id)).find(
        item => item.firmaId === row.firma_id && item.mailAccountId === row.mail_nalog_id
      );
      if (!config) throw new MailError("Podesite izvorni mail nalog firme za preuzimanje priloga.");
      const original = await getMailAttachment(Number(row.imap_uid), row.imap_uid_validity, row.indeks_priloga, row.imap_folder, config);
      if (!original.content.length || attachmentHash(original.content) !== row.sadrzaj_hash) {
        throw new ArchiveReview("Originalni prilog više ne odgovara uvezenom izvodu.");
      }
      const { token, driveId } = await oneDriveAccess(row.agencija_id);
      const [destination] = await prisma.$queryRaw<{ drive_id: string; folder_id: string; statement_number: string }[]>`
        SELECT a.drive_id, a.folder_id, b.statement_number ${eligible} AND m.id = ${row.id}::uuid
      `;
      if (!destination) continue;
      if (driveId !== destination.drive_id) throw new MailError("Ponovo odaberite folder na povezanom OneDrive nalogu.");
      const name = statementArchiveName(destination.statement_number, original.filename);
      const id = await archiveStatementAttachment(token, driveId, destination.folder_id, name, original.content);
      result = { arhiva_status: "SAVED", arhiva_greska: null, arhiva_item_id: id };
    } catch (error) {
      result = error instanceof ArchiveReview
        ? { arhiva_status: "REVIEW", arhiva_greska: error.message }
        : { arhiva_status: "RETRY", arhiva_greska: error instanceof MailError ? error.message :
          error instanceof GraphError ? error.message : "Provjerite dostupnost maila i OneDrive veze." };
    }
    await prisma.$transaction(async tx => {
      const updated = await tx.mailIzvodObrada.updateMany({
        where: { id: row.id, arhiva_pokusaj_at: claimed.arhiva_pokusaj_at, izvod_id: row.izvod_id }, data: result
      });
      if (updated.count && result.arhiva_status !== "RETRY") {
        await auditLogInTransaction(tx, { agencijaId: row.agencija_id, firmaId: row.firma_id,
          modul: "agencija.izvodi", akcija: "ONEDRIVE_ARCHIVE", tipEntiteta: "BankStatement",
          entitetId: row.izvod_id, novaVrijednost: result });
      }
    });
  }
}

export function startBankStatementArchive() {
  const state = globalThis as typeof globalThis & { bankArchiveTimer?: ReturnType<typeof setInterval>; bankArchiveBusy?: boolean };
  if (state.bankArchiveTimer || !process.env.DOKUMENTA_ONEDRIVE_CLIENT_ID) return;
  state.bankArchiveTimer = setInterval(async () => {
    if (state.bankArchiveBusy) return;
    state.bankArchiveBusy = true;
    try {
      await runBankStatementArchive();
    } catch {
      console.warn("OneDrive arhiva izvoda: periodična obrada nije završena.");
    } finally {
      state.bankArchiveBusy = false;
    }
  }, 60_000);
  state.bankArchiveTimer.unref();
}
