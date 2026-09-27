export type MailRule = { sender: string; subject: string; attachment: string };
export type CompanyMailConfig = {
  firmaId: string; folder: string | null; includeSubfolders: boolean; includeInbox: boolean;
  rules: MailRule[];
};
export type MailMetadata = { senders: string[]; subject: string; filenames: string[] };

const normalize = (value: string) => value.normalize("NFC").trim().toLowerCase();

export function parseMailRules(value: unknown): MailRule[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error("Dozvoljeno je najviše 20 pravila.");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Neispravno pravilo.");
    const result = { sender: "", subject: "", attachment: "" };
    for (const key of ["sender", "subject", "attachment"] as const) {
      if (typeof item[key] !== "string" || item[key].length > 320 || /[\r\n\x00]/.test(item[key])) throw new Error("Polja pravila moraju biti tekst do 320 znakova.");
      result[key] = item[key].trim();
    }
    if (result.sender && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(result.sender)) throw new Error("Pošiljalac mora biti puna email adresa ili prazno polje.");
    return result;
  }).filter((rule) => rule.sender || rule.subject || rule.attachment);
}

export function matchesMailRules(rules: MailRule[], mail: MailMetadata) {
  // No filled conditions means no additional filter within explicitly selected sources.
  return rules.length === 0 || rules.some((rule) =>
    (!normalize(rule.sender) || mail.senders.some((address) => normalize(address) === normalize(rule.sender))) &&
    (!normalize(rule.subject) || normalize(mail.subject).includes(normalize(rule.subject))) &&
    (!normalize(rule.attachment) || mail.filenames.some((name) => normalize(name).includes(normalize(rule.attachment)))));
}

export function matchesMailFolder(config: CompanyMailConfig, path: string, delimiter: string) {
  // Never expose an unfiltered INBOX, even when selected as the company folder.
  if (path.toUpperCase() === "INBOX" && !config.rules.some((rule) =>
    rule.sender.trim() || rule.subject.trim() || rule.attachment.trim())) return false;
  return (config.includeInbox && path.toUpperCase() === "INBOX") ||
    Boolean(config.folder && (path === config.folder ||
      (config.includeSubfolders && delimiter && path.startsWith(config.folder + delimiter))));
}
