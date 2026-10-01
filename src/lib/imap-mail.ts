import "server-only";
import { ImapFlow, type FetchMessageObject, type MessageStructureObject } from "imapflow";
import { simpleParser } from "mailparser";
import { matchesMailRules, matchesMailFolder, type CompanyMailConfig, type MailMetadata } from "./company-mail-rules";
import { imapOptions, safeImapError } from "./imap-connection";

import { mailSourceKey } from "./mail-import-policy";

export const MAIL_PAGE_SIZE = 25;
export const MAX_MAIL_BYTES = 10 * 1024 * 1024;
export class MailError extends Error {}

function isoDate(value: Date | string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function mailReference(uid: unknown, validity: unknown) {
  const value = Number(uid);
  if (!Number.isInteger(value) || value < 1 || value > 4294967295 ||
      typeof validity !== "string" || !/^[1-9]\d{0,9}$/.test(validity) || Number(validity) > 4294967295) {
    throw new MailError("Neispravna oznaka poruke. Osvježite spisak.");
  }
  return { uid: value, validity };
}

export function mailPage(value: unknown) {
  const page = Number(value ?? 1);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

let activeConnections = 0;
async function withMailClient<T>(read: (client: ImapFlow) => Promise<T>): Promise<T> {
  if (activeConnections >= 3) throw new MailError("Sanduče je trenutno zauzeto. Pokušajte ponovo za nekoliko sekundi.");
  const options = imapOptions(process.env);
  if (!options) throw new MailError("IMAP podešavanja nijesu potpuna.");
  activeConnections++;
  const client = new ImapFlow(options);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const interrupted = new Promise<never>((_, reject) => {
      client.on("error", reject);
      timer = setTimeout(() => { reject(new MailError("Učitavanje mailova je trajalo predugo. Pokušajte ponovo ili suzite foldere i pravila.")); client.close(); }, 30_000);
    });
    return await Promise.race([interrupted, (async () => {
      await client.connect();
      const result = await read(client);
      await client.logout();
      return result;
    })()]);
  } catch (error) {
    if (error instanceof MailError) throw error;
    const safe = safeImapError(error);
    throw new MailError(safe.ok ? "Poruku nije moguće učitati." : safe.message);
  } finally {
    clearTimeout(timer);
    client.close();
    activeConnections--;
  }
}

export function attachmentNames(node?: MessageStructureObject): string[] {
  if (!node) return [];
  const name = node.dispositionParameters?.filename || node.parameters?.name;
  return [...(name ? [name] : []), ...(node.childNodes || []).flatMap(attachmentNames)];
}

function metadata(row: FetchMessageObject): MailMetadata {
  return {
    senders: row.envelope?.from?.map((sender) => sender.address || "") || [],
    subject: row.envelope?.subject || "", filenames: attachmentNames(row.bodyStructure)
  };
}

async function openFolder(client: ImapFlow, folder: string) {
  const mailbox = await client.mailboxOpen(folder, { readOnly: true });
  if (!mailbox.readOnly) throw new MailError("Folder nije otvoren samo za čitanje.");
  return mailbox;
}

export async function listMailFolders() {
  return withMailClient(async (client) => (await client.list()).map((folder) => ({
    path: folder.path, delimiter: folder.delimiter, selectable: !folder.flags.has("\\Noselect")
  })));
}

export async function listCompanyInbox(config: CompanyMailConfig, requestedPage: number, completed: ReadonlySet<string> = new Set()) {
  return withMailClient(async (client) => {
    const folders = await client.list();
    if (config.folder && !folders.some((folder) => folder.path === config.folder)) throw new MailError("Podešeni folder više ne postoji. Provjerite podešavanja firme.");
    const selected = folders.filter((folder) => !folder.flags.has("\\Noselect") && matchesMailFolder(config, folder.path, folder.delimiter));
    type Row = { uid: number; validity: string; folder: string; subject: string; from: string; date: string | null; seen: boolean; size: number; received: string | null };
    const messages: Row[] = [];
    const needsAttachmentNames = config.rules.some((rule) => Boolean(rule.attachment));
    let scanned = 0;
    for (const folder of selected) {
      const mailbox = await openFolder(client, folder.path);
      if (!mailbox.exists) continue;
      // Search only narrows by sender; final exact-address and Unicode substring checks run below.
      // Subject matching is local to avoid server charset differences. Attachment names come from BODYSTRUCTURE.
      const senders = config.rules.map((rule) => rule.sender).filter(Boolean);
      const query = config.rules.length > 0 && senders.length === config.rules.length
        ? (senders.length === 1 ? { from: senders[0] } : { or: senders.map((from) => ({ from })) }) : { all: true };
      const found = await client.search(query, { uid: true });
      const uids = (Array.isArray(found) ? found : []).filter(uid => !completed.has(mailSourceKey(folder.path, mailbox.uidValidity.toString(), uid)));
      scanned += uids.length;
      if (scanned > 20000) throw new MailError("Previše poruka za jednu provjeru. Suzite foldere ili pravila pošiljaoca.");
      for (let offset = 0; offset < uids.length; offset += 100) {
        const rows = await client.fetchAll(uids.slice(offset, offset + 100), {
          uid: true, envelope: true, flags: true, size: true, internalDate: true, bodyStructure: needsAttachmentNames
        }, { uid: true });
        for (const row of rows) {
          const meta = metadata(row);
          if (!matchesMailRules(config.rules, meta)) continue;
          messages.push({
            uid: row.uid, validity: mailbox.uidValidity.toString(), folder: folder.path,
            subject: (meta.subject || "(Bez naslova)").slice(0, 1000),
            from: (row.envelope?.from?.map((sender) => sender.name ? `${sender.name} <${sender.address || ""}>` : sender.address || "").join(", ") || "Nepoznat pošiljalac").slice(0, 2000),
            date: isoDate(row.envelope?.date) || isoDate(row.internalDate), received: isoDate(row.internalDate),
            seen: row.flags?.has("\\Seen") ?? false, size: row.size || 0,
          });
        }
      }
    }
    messages.sort((a, b) => (b.received || "").localeCompare(a.received || "") || b.uid - a.uid || a.folder.localeCompare(b.folder));
    const count = messages.length;
    const pages = Math.max(1, Math.ceil(count / MAIL_PAGE_SIZE));
    const page = Math.min(mailPage(requestedPage), pages);
    return { count, page, pages, references: messages.map(({ uid, validity, folder }) => ({ uid, validity, folder })), messages: messages.slice((page - 1) * MAIL_PAGE_SIZE, page * MAIL_PAGE_SIZE) };
  });
}

export async function parseMailSource(source: Buffer) {
  if (source.length > MAX_MAIL_BYTES) throw new MailError("Poruka je veća od 10 MB. Otvorite je u svom mail programu.");
  // Only text is rendered by React. HTML, remote images and scripts never enter the DOM.
  return simpleParser(source, { skipTextToHtml: true, skipImageLinks: true, maxHtmlLengthToParse: MAX_MAIL_BYTES });
}

async function readMail(uid: number, validity: string, folder: string, config: CompanyMailConfig) {
  const ref = mailReference(uid, validity);
  return withMailClient(async (client) => {
    const folders = await client.list();
    const selected = folders.find((item) => item.path === folder && !item.flags.has("\\Noselect") && matchesMailFolder(config, item.path, item.delimiter));
    if (!selected) throw new MailError("Folder ne pripada podešavanjima izabrane firme.");
    const mailbox = await openFolder(client, folder);
    const currentValidity = mailbox.uidValidity.toString();
    if (ref.validity !== currentValidity) throw new MailError("Sanduče se promijenilo. Osvježite spisak poruka.");
    const meta = await client.fetchOne(ref.uid, { size: true, envelope: true, bodyStructure: true }, { uid: true });
    if (!meta) throw new MailError("Poruka više nije u ovom folderu. Osvježite spisak.");
    if (!matchesMailRules(config.rules, metadata(meta))) throw new MailError("Poruka ne odgovara pravilima izabrane firme.");
    if (typeof meta.size !== "number" || meta.size > MAX_MAIL_BYTES) throw new MailError("Poruka je veća od 10 MB ili veličina nije dostupna. Otvorite je u svom mail programu.");
    // ImapFlow uses BODY.PEEK[], and EXAMINE additionally prevents all flag changes.
    const message = await client.fetchOne(ref.uid, { source: { start: 0, maxLength: MAX_MAIL_BYTES + 1 } }, { uid: true });
    if (!message || !message.source) throw new MailError("Poruka više nije dostupna.");
    return parseMailSource(message.source);
  });
}

export async function getMailDetail(uid: number, validity: string, folder: string, config: CompanyMailConfig) {
  const parsed = await readMail(uid, validity, folder, config);
  const recipients = Array.isArray(parsed.to) ? parsed.to.map((to) => to.text).join(", ") : parsed.to?.text;
  return {
    subject: (parsed.subject || "(Bez naslova)").slice(0, 1000),
    from: parsed.from?.text || "Nepoznat pošiljalac",
    to: recipients || "",
    date: isoDate(parsed.date),
    text: (parsed.text || "Poruka nema tekstualni sadržaj.").slice(0, 200_000),
    truncated: (parsed.text?.length || 0) > 200_000,
    attachments: parsed.attachments.map((attachment, index) => ({
      index, filename: attachment.filename || `prilog-${index + 1}`, size: attachment.size
    }))
  };
}

export async function getMailAttachment(uid: number, validity: string, index: number, folder: string, config: CompanyMailConfig) {
  if (!Number.isSafeInteger(index) || index < 0 || index > 1000) throw new MailError("Neispravna oznaka priloga.");
  const parsed = await readMail(uid, validity, folder, config);
  const attachment = parsed.attachments[index];
  if (!attachment) throw new MailError("Prilog nije pronađen.");
  return { content: attachment.content, filename: attachment.filename || `prilog-${index + 1}` };
}

export async function getMailImportAttachments(uid: number, validity: string, folder: string, config: CompanyMailConfig) {
  const parsed = await readMail(uid, validity, folder, config);
  return parsed.attachments.map((attachment, index) => ({
    index, filename: attachment.filename || `prilog-${index + 1}`,
    content: attachment.content, contentType: attachment.contentType
  }));
}
