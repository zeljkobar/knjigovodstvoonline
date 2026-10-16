import { prisma } from "@/lib/prisma";

type Entry = { journal_id: string | null };
export async function loadInvoiceJournalStatuses(entries: Entry[], agencyId: string | null) {
  const ids = [...new Set(entries.flatMap(entry => entry.journal_id ? [entry.journal_id] : []))];
  if (!agencyId || !ids.length) return new Map<string, string>();
  const journals = await prisma.nalog.findMany({
    where: { id: { in: ids }, agencija_id: agencyId, is_deleted: false },
    select: { id: true, status: true }
  });
  return new Map(journals.map(journal => [journal.id, journal.status]));
}

export function invoiceEntryPostingLabel(entry: Entry, statuses: ReadonlyMap<string, string>) {
  const status = entry.journal_id ? statuses.get(entry.journal_id) : undefined;
  if (status === "POSTED") return "Knjiženo";
  if (status === "DRAFT") return "U nacrtu naloga";
  return "Otvorena";
}

export function invoiceBookPostingLabel(entries: Entry[], statuses: ReadonlyMap<string, string>) {
  if (!entries.length) return "Otvorena";
  const labels = entries.map(entry => invoiceEntryPostingLabel(entry, statuses));
  const posted = labels.filter(label => label === "Knjiženo").length;
  if (posted === entries.length) return "Knjiženo";
  if (posted) return "Djelimično knjižena";
  if (labels.includes("U nacrtu naloga")) return "U nacrtu naloga";
  return "Otvorena";
}
