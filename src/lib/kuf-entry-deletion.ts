import type { Prisma } from "@prisma/client";
import { auditLogInTransaction } from "./audit";
import { decimalToScaled } from "./inventory-calculation";

export class KufDeletionError extends Error {}

// The caller supplies verified permissions and runs a serializable transaction.
export async function deleteKufEntryInTransaction(tx: Prisma.TransactionClient, input: {
  id: string; bookId: string; firmaId: string; agencijaId: string; godinaId: string;
  userId: string; reason: string; canDeleteJournal: boolean;
}) {
  const { id, bookId, firmaId, agencijaId, godinaId, userId, reason } = input;
  const fail = (message: string): never => { throw new KufDeletionError(message); };
  if (!reason.trim()) fail("Unesite razlog brisanja računa.");
  await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${godinaId}::uuid AND firma_id=${firmaId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM kuf_books WHERE id=${bookId}::uuid AND firma_id=${firmaId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM kuf_entries WHERE id=${id}::uuid AND firma_id=${firmaId}::uuid FOR UPDATE`;
  const scope = { firma_id: firmaId, agencija_id: agencijaId, poslovna_godina_id: godinaId };
  const entry = await tx.kufEntry.findFirst({where:{id,kuf_book_id:bookId,...scope},include:{kuf_book:true,poslovna_godina:true,tax_lines:true}});
  if (!entry) return fail("Račun nije pronađen u izabranoj firmi i godini.");
  if (entry.is_deleted) return;
  if (entry.poslovna_godina.zakljucena) fail("Poslovna godina je zaključana. Brisanje računa nije dozvoljeno dok se godina ne otključa.");
  if (entry.source_type === "SUPPLIER_RETURN") fail("Račun je kreiran kroz povrat dobavljaču i ne može se zasebno brisati.");
  if (entry.posting_mode !== "KUF_RULES" || entry.source_type === "CALCULATION") fail("Račun je preuzet iz drugog dokumenta. Brisanje pokrenite iz izvorne kalkulacije.");
  if (await tx.povratDobavljacu.count({ where: { originalni_kuf_id: entry.id, is_deleted: false } })) fail("Račun je povezan sa povratom dobavljaču.");
  if (!entry.kuf_book || entry.kuf_book.is_deleted || entry.kuf_book.status !== "OPEN") return fail("KUF knjiga je zaključana ili nije dostupna za izmjene.");
  if (!["UNPOSTED", "POSTED"].includes(entry.posting_status)) fail("Status računa ne dozvoljava brisanje.");
  const journal = entry.journal_id ? await tx.nalog.findFirst({where:{id:entry.journal_id,...scope,is_deleted:false}}) : null;
  const dates = [entry.kuf_book.kuf_date, entry.invoice_date, entry.receipt_date, ...(journal ? [journal.datum] : [])];
  const periods = await tx.pdvPeriod.findMany({where:{firma_id:firmaId,status:"LOCKED"}});
  if (periods.some(p=>dates.some(d=>d>=p.datum_od && d<=p.datum_do))) fail("PDV mjesec je zaključan. Administrator agencije prvo mora otključati odgovarajući PDV period uz razlog.");
  if (entry.payment_status !== "UNPAID" || await tx.bankStatementLineAllocation.count({where:{kuf_entry_id:id}})) fail("Račun ima evidentirano plaćanje. Prvo razriješite plaćanje i raspodjelu na izvodu.");
  const linked = await tx.stavkaNaloga.findMany({where:{kuf_entry_id:id}});
  let removedLines: typeof linked = [];
  let journalDeleted = false;
  if (entry.journal_id || entry.posting_status === "POSTED") {
    if (!input.canDeleteJournal) fail("Nemate pravo brisanja stavki naloga. Potrebno je pravo Brisanje za modul Nalozi.");
    if (!journal || journal.source_type !== "KUF" || journal.izvorni_dokument_id !== bookId || !["POSTED","DRAFT"].includes(journal.status)) return fail("Veza računa sa zajedničkim KUF nalogom nije ispravna.");
    await tx.$queryRaw`SELECT id FROM nalozi WHERE id=${journal.id}::uuid FOR UPDATE`;
    if (await tx.osPromjena.count({where:{izvorni_nalog_id:journal.id,is_deleted:false}})) fail("Nalog je povezan sa promjenom osnovnog sredstva. Prvo razriješite tu vezu u osnovnim sredstvima.");
    const all = await tx.stavkaNaloga.findMany({where:{nalog_id:journal.id}});
    if (!linked.length || linked.some(l=>l.nalog_id!==journal.id) || all.some(l=>!l.kuf_entry_id)) fail("Ovaj nalog nema potpunu vezu stavki sa KUF računima. Jednom vratite nalog u nacrt, obrišite nacrt naloga i ponovo proknjižite KUF. Nakon toga možete brisati pojedinačne račune.");
    const owners = await tx.kufEntry.findMany({where:{...scope,kuf_book_id:bookId,journal_id:journal.id,is_deleted:false}});
    if (all.some(l=>!owners.some(e=>e.id===l.kuf_entry_id)) || owners.some(e=>!all.some(l=>l.kuf_entry_id===e.id))) fail("Stavke naloga nisu pouzdano povezane sa računima ove KUF knjige.");
    const balance = (lines: typeof all) => lines.reduce((sum,l)=>sum+decimalToScaled(l.duguje,2)-decimalToScaled(l.potrazuje,2),BigInt(0));
    const remaining = all.filter(l=>l.kuf_entry_id!==id);
    if (balance(linked)!==BigInt(0) || balance(remaining)!==BigInt(0)) fail("Brisanje bi narušilo ravnotežu naloga. Provjerite stavke knjiženja ovog računa.");
    removedLines = linked;
    await tx.stavkaNaloga.deleteMany({where:{nalog_id:journal.id,kuf_entry_id:id}});
    journalDeleted = remaining.length === 0;
    await tx.nalog.update({where:{id:journal.id},data:{updated_by:userId,...(journalDeleted?{status:"DELETED",is_deleted:true,deleted_at:new Date(),deleted_by:userId,delete_reason:reason}:{})}});
  } else if (linked.length) fail("Neproknjiženi račun ima povezane stavke naloga. Brisanje je zaustavljeno.");
  await auditLogInTransaction(tx,{korisnikId:userId,agencijaId,firmaId,modul:"agencija.racuni.kuf",akcija:"delete_entry_and_posting",tipEntiteta:"KufEntry",entitetId:id,staraVrijednost:{entry,stavke:removedLines,journal},novaVrijednost:{reason,journalDeleted,is_deleted:!!journal}});
  if (journal) {
    await tx.kufEntry.update({where:{id},data:{is_deleted:true,deleted_at:new Date(),deleted_by:userId,delete_reason:reason,updated_by:userId}});
  } else {
    await tx.kufEntry.delete({where:{id}});
  }
}
