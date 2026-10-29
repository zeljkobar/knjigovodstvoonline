import "server-only";
import { prisma } from "./prisma";
import { decryptMailPassword } from "./mail-secrets";
import { imapOptions } from "./imap-connection";

export class MailAccountError extends Error {}
export const mailAccountPublicSelect = {
  id: true, naziv: true, host: true, port: true, korisnicko_ime: true, aktivan: true, automatska_obrada: true, updated_at: true
} as const;
export async function agencyMailAccounts(agencyId: string, activeOnly = false) {
  return prisma.agencijaMailNalog.findMany({ where: {
    agencija_id: agencyId, is_deleted: false, ...(activeOnly ? { aktivan: true } : {}),
    agencija: { aktivan: true, is_deleted: false }
  }, select: mailAccountPublicSelect, orderBy: { naziv: "asc" } });
}
export async function mailAccountOptions(agencyId: string, accountId: string, companyId?: string) {
  if (!agencyId || !accountId) throw new MailAccountError("Izaberite mail nalog agencije u podešavanjima firme.");
  const account = await prisma.agencijaMailNalog.findFirst({ where: {
    id: accountId, agencija_id: agencyId, aktivan: true, is_deleted: false,
    agencija: { aktivan: true, is_deleted: false },
    ...(companyId ? { firme: { some: {
      agencija_id: agencyId, firma_id: companyId, aktivno: true, is_deleted: false,
      firma: { agencija_id: agencyId, aktivan: true, is_deleted: false }
    } } } : {})
  } });
  if (!account) throw new MailAccountError("Mail nalog nije dostupan za izabranu agenciju i firmu.");
  try {
    const pass = decryptMailPassword(account.lozinka_sifrovana, agencyId, account.id);
    const options = imapOptions({ IMAP_HOST: account.host, IMAP_PORT: String(account.port), IMAP_USER: account.korisnicko_ime,
      IMAP_PASS: pass, IMAP_SECURE: "true", IMAP_FOLDER: "INBOX" });
    if (!options) throw new Error();
    return options;
  } catch { throw new MailAccountError("Mail lozinku nije moguće učitati. Provjerite serverski MAIL_ENCRYPTION_KEY i sačuvani nalog."); }
}
