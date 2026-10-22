import type { Prisma } from "@prisma/client";
import { auditLogInTransaction } from "./audit";
import { decimalToScaled, scaledToDecimal } from "./inventory-calculation";

export class CalculationDeletionError extends Error {}

// Caller must use a serializable transaction. Retain documents for audit, reverse stock.
export async function deleteCalculationInTransaction(tx: Prisma.TransactionClient, input: {
  id: string; firmaId: string; agencijaId: string; godinaId: string; userId: string; reason: string;
}) {
  const { id, firmaId, agencijaId, godinaId, userId, reason } = input;
  const fail = (message: string): never => { throw new CalculationDeletionError(message); };
  await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${godinaId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM kalkulacije WHERE id=${id}::uuid AND firma_id=${firmaId}::uuid AND agencija_id=${agencijaId}::uuid FOR UPDATE`;
  const calculation = await tx.kalkulacija.findFirst({ where: { id, firma_id: firmaId, agencija_id: agencijaId, poslovna_godina_id: godinaId }, include: { poslovna_godina: true, stavke: true } });
  if (!calculation) return fail("Kalkulacija nije pronađena u izabranoj firmi i godini.");
  if (calculation.is_deleted) return;
  if (calculation.poslovna_godina.zakljucena) return fail("Poslovna godina je zaključana.");
  if (await tx.povratDobavljacu.count({ where: { kalkulacija_id: id, is_deleted: false } })) return fail("Kalkulacija je povezana sa povratom dobavljaču.");
  if (!["DRAFT", "WAITING_KUF", "POSTED"].includes(calculation.status)) return fail("Status kalkulacije ne dozvoljava brisanje.");
  const entries = await tx.kufEntry.findMany({ where: { OR: [{ source_type: "CALCULATION", source_id: id }, ...(calculation.kuf_entry_id ? [{ id: calculation.kuf_entry_id }] : [])] }, include: { kuf_book: true } });
  if (entries.some(e => e.firma_id !== firmaId || e.agencija_id !== agencijaId || e.poslovna_godina_id !== godinaId || e.source_type !== "CALCULATION" || e.source_id !== id || e.journal_id !== calculation.nalog_id)) return fail("Veza kalkulacije sa KUF-om nije ispravna.");
  const activeEntries = entries.filter(e => !e.is_deleted);
  for (const entry of activeEntries) {
    await tx.$queryRaw`SELECT id FROM kuf_entries WHERE id=${entry.id}::uuid FOR UPDATE`;
    if (entry.kuf_book_id) await tx.$queryRaw`SELECT id FROM kuf_books WHERE id=${entry.kuf_book_id}::uuid FOR UPDATE`;
  }
  const dates = [calculation.datum_kalkulacije, calculation.datum_racuna_dobavljaca, ...activeEntries.flatMap(e => [e.invoice_date, e.receipt_date, ...(e.kuf_book ? [e.kuf_book.kuf_date] : [])])];
  const journal = calculation.nalog_id ? await tx.nalog.findFirst({ where: { id: calculation.nalog_id, firma_id: firmaId, agencija_id: agencijaId, poslovna_godina_id: godinaId } }) : null;
  if (calculation.nalog_id && (!journal || journal.source_type !== "CALCULATION" || journal.izvorni_dokument_id !== id)) return fail("Nalog nije zaseban nalog ove kalkulacije. Brisanje je zaustavljeno.");
  if (journal) {
    await tx.$queryRaw`SELECT id FROM nalozi WHERE id=${journal.id}::uuid FOR UPDATE`;
    dates.push(journal.datum);
    if (await tx.kufEntry.count({ where: { journal_id: journal.id, is_deleted: false, NOT: { source_type: "CALCULATION", source_id: id } } })) return fail("Nalog koriste i drugi računi.");
  }
  const periods = await tx.$queryRaw<{ datum_od: Date; datum_do: Date; status: string }[]>`SELECT datum_od, datum_do, status FROM pdv_periodi WHERE firma_id=${firmaId}::uuid FOR UPDATE`;
  if (periods.some(p => p.status === "LOCKED" && dates.some(d => d >= p.datum_od && d <= p.datum_do))) return fail("PDV period je zaključan. Prvo otključajte odgovarajući period.");
  if (activeEntries.length && await tx.bankStatementLineAllocation.count({ where: { kuf_entry_id: { in: activeEntries.map(e => e.id) } } })) return fail("Račun je povezan sa plaćanjem na izvodu. Prvo uklonite raspodjelu plaćanja.");
  const movements = await tx.prometZaliha.findMany({ where: { kalkulacija_id: id, firma_id: firmaId, agencija_id: agencijaId, poslovna_godina_id: godinaId, tip_dokumenta: "CALCULATION" }, orderBy: { created_at: "asc" } });
  if (calculation.status !== "DRAFT" && (!journal || movements.length !== calculation.stavke.length)) return fail("Nedostaju povezani nalog ili prometi zaliha; brisanje je zaustavljeno.");
  if (calculation.status === "DRAFT" && (journal || activeEntries.length || movements.length)) return fail("Nacrt ima povezane dokumente; brisanje je zaustavljeno.");
  const groups = new Map<string, typeof movements>();
  for (const m of movements) groups.set(m.artikal_id, [...(groups.get(m.artikal_id) ?? []), m]);
  for (const [artikalId, items] of groups) {
    const later = await tx.prometZaliha.findFirst({ where: {
      firma_id: firmaId, magacin_id: calculation.magacin_id, artikal_id: artikalId,
      OR: [{ kalkulacija_id: null }, { kalkulacija_id: { not: id } }],
      AND: [
        { OR: [{ kalkulacija_id: null }, { kalkulacija: { is_deleted: false } }] },
        { OR: [{ created_at: { gt: items[0].created_at } }, { datum_prometa: { gt: calculation.datum_kalkulacije } }] }
      ]
    } });
    if (later) return fail("Postoji naknadni promet iste robe u magacinu. Prvo poništite zavisne dokumente.");
    await tx.$queryRaw`SELECT id FROM stanja_zaliha WHERE firma_id=${firmaId}::uuid AND poslovna_godina_id=${godinaId}::uuid AND magacin_id=${calculation.magacin_id}::uuid AND artikal_id=${artikalId}::uuid FOR UPDATE`;
    const state = await tx.stanjeZaliha.findUnique({ where: { firma_id_poslovna_godina_id_magacin_id_artikal_id: { firma_id: firmaId, poslovna_godina_id: godinaId, magacin_id: calculation.magacin_id, artikal_id: artikalId } } });
    if (!state) return fail("Stanje zaliha nije pronađeno.");
    let quantity = decimalToScaled(state.kolicina, 3), value = decimalToScaled(state.nabavna_vrijednost, 2);
    let retail = decimalToScaled(state.maloprodajna_vrijednost, 2), difference = decimalToScaled(state.razlika_u_cijeni, 2), vat = decimalToScaled(state.ukalkulisani_pdv, 2);
    const isRetail = calculation.tip_prodaje === "RETAIL";
    for (const m of [...items].reverse()) {
      quantity -= decimalToScaled(m.kolicina, 3); value -= decimalToScaled(m.nabavna_vrijednost, 2);
      if (isRetail) { retail -= decimalToScaled(m.prodajna_vrijednost, 2); difference -= decimalToScaled(m.razlika_u_cijeni, 2); vat -= decimalToScaled(m.ukalkulisani_pdv, 2); }
      if (quantity < BigInt(0) || value < BigInt(0) || (quantity === BigInt(0) && value !== BigInt(0))) return fail("Brisanje bi napravilo neispravno stanje zaliha.");
      const average = quantity > BigInt(0) ? (value * BigInt(100000) + quantity / BigInt(2)) / quantity : BigInt(0);
      await tx.prometZaliha.create({ data: {
        agencija_id: agencijaId, firma_id: firmaId, poslovna_godina_id: godinaId, magacin_id: calculation.magacin_id, artikal_id: artikalId,
        kalkulacija_id: id, stavka_kalkulacije_id: m.stavka_kalkulacije_id, tip_dokumenta: "CALCULATION_REVERSAL", dokument_id: id, stavka_dokumenta_id: m.id,
        datum_prometa: m.datum_prometa, smjer: "IN", kolicina: scaledToDecimal(-decimalToScaled(m.kolicina, 3), 3),
        jedinicna_nabavna_cijena: m.jedinicna_nabavna_cijena, nabavna_vrijednost: scaledToDecimal(-decimalToScaled(m.nabavna_vrijednost, 2), 2),
        prodajna_cijena_sa_pdv: m.prodajna_cijena_sa_pdv, prodajna_vrijednost: scaledToDecimal(-decimalToScaled(m.prodajna_vrijednost, 2), 2),
        razlika_u_cijeni: scaledToDecimal(-decimalToScaled(m.razlika_u_cijeni, 2), 2), ukalkulisani_pdv: scaledToDecimal(-decimalToScaled(m.ukalkulisani_pdv, 2), 2),
        prosjecna_cijena_nakon: scaledToDecimal(average, 4), kolicina_nakon: scaledToDecimal(quantity, 3), created_by: userId
      } });
    }
    await tx.stanjeZaliha.update({ where: { id: state.id }, data: {
      kolicina: scaledToDecimal(quantity, 3), nabavna_vrijednost: scaledToDecimal(value, 2),
      prosjecna_nabavna_cijena: scaledToDecimal(quantity > BigInt(0) ? (value * BigInt(100000) + quantity / BigInt(2)) / quantity : BigInt(0), 4),
      maloprodajna_vrijednost: scaledToDecimal(retail, 2), razlika_u_cijeni: scaledToDecimal(difference, 2), ukalkulisani_pdv: scaledToDecimal(vat, 2)
    } });
    // Only undo a price still owned by this calculation; preserve subsequent manual prices.
    const prices = await tx.cijenaArtikla.findMany({ where: { firma_id: firmaId, artikal_id: artikalId, magacin_id: calculation.magacin_id, napomena: `Kreirano iz ${calculation.interni_broj}`, is_deleted: false } });
    for (const price of prices) {
      await tx.cijenaArtikla.update({ where: { id: price.id }, data: { aktivna: false, is_deleted: true, deleted_at: new Date(), deleted_by: userId, updated_by: userId } });
      if (price.aktivna) {
        const previous = await tx.cijenaArtikla.findFirst({ where: { firma_id: firmaId, artikal_id: artikalId, magacin_id: calculation.magacin_id, tip: price.tip, is_deleted: false, created_at: { lt: price.created_at } }, orderBy: { created_at: "desc" } });
        if (previous) await tx.cijenaArtikla.update({ where: { id: previous.id }, data: { aktivna: true, updated_by: userId } });
      }
    }
    const last = await tx.prometZaliha.findFirst({ where: { firma_id: firmaId, artikal_id: artikalId, tip_dokumenta: "CALCULATION", kalkulacija_id: { not: id }, kalkulacija: { is_deleted: false } }, orderBy: { created_at: "desc" } });
    await tx.artikal.update({ where: { id: artikalId }, data: { posljednja_nabavna_cijena: last?.jedinicna_nabavna_cijena ?? "0", updated_by: userId } });
  }
  const deletion = { is_deleted: true, deleted_at: new Date(), deleted_by: userId, delete_reason: reason, updated_by: userId };
  if (journal && !journal.is_deleted) await tx.nalog.update({ where: { id: journal.id }, data: { ...deletion, status: "DELETED" } });
  await tx.kufEntry.updateMany({ where: { id: { in: activeEntries.map(e => e.id) } }, data: deletion });
  await tx.kalkulacija.update({ where: { id }, data: { ...deletion, status: "DELETED" } });
  await auditLogInTransaction(tx, { korisnikId: userId, agencijaId, firmaId, modul: "robno", akcija: "delete_calculation", tipEntiteta: "Kalkulacija", entitetId: id,
    staraVrijednost: { calculation, journal, kufEntries: activeEntries }, novaVrijednost: { status: "DELETED", reason, reversedMovements: movements.map(m => m.id) } });
}
