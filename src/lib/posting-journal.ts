import "server-only";
import type { Prisma } from "@prisma/client";
import { requireAnyRole } from "./auth";
import { requirePermissionForUser, hasPermission } from "./permissions";
import { prisma } from "./prisma";
import { readWorkContext } from "./work-context";
import { decimalToScaled } from "./inventory-calculation";

export type PostingJournalParams = { datum_od?: string; datum_do?: string; strana?: string; rbr?: string; nalog?: string; stavka?: string; konto?: string; partner?: string; dokument?: string; datum_dokumenta?: string; opis?: string; duguje?: string; potrazuje?: string };
export function postingJournalQuery(params: PostingJournalParams = {}, page?: number) {
  const query = new URLSearchParams();
  for (const key of ["datum_od", "datum_do", "rbr", "nalog", "stavka", "konto", "partner", "dokument", "datum_dokumenta", "opis", "duguje", "potrazuje"] as const) if (params[key]) query.set(key, params[key]);
  if (page) query.set("strana", String(page));
  return query.toString();
}
export function journalMoney(cents: number) {
  return (cents / 100).toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function parseDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}
export async function loadPostingJournal(params: PostingJournalParams = {}, print = false) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const context = await readWorkContext();
  if (!user.agencija_id || !context.firmaId || !context.poslovnaGodinaId) return null;
  await requirePermissionForUser(user, { firmaId: context.firmaId, modul: "nalozi", akcija: "view" });
  if (print) await requirePermissionForUser(user, { firmaId: context.firmaId, modul: "nalozi", akcija: "export" });
  const [firma, godina] = await Promise.all([
    prisma.firma.findFirst({ where: { id: context.firmaId, agencija_id: user.agencija_id, aktivan: true, is_deleted: false,
      ...(user.rola === "admin_agencije" ? {} : { korisnici: { some: { korisnik_id: user.id, is_deleted: false } } }) },
      select: { naziv: true, pib: true } }),
    prisma.poslovnaGodina.findFirst({ where: { id: context.poslovnaGodinaId, firma_id: context.firmaId }, select: { godina: true } })
  ]);
  if (!firma || !godina) return null;
  const from = parseDate(params.datum_od), to = parseDate(params.datum_do);
  let error = (params.datum_od && !from) || (params.datum_do && !to) || (from && to && from > to)
    ? "Unesite ispravan period: datum od mora biti prije datuma do." : null;
  const where: Prisma.StavkaNalogaWhereInput = { nalog: {
    agencija_id: user.agencija_id, firma_id: context.firmaId, poslovna_godina_id: context.poslovnaGodinaId,
    status: "POSTED", is_deleted: false,
    ...(from || to ? { datum: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {})
  } };
  const and: Prisma.StavkaNalogaWhereInput[] = [];
  const contains = (value: string) => ({ contains: value.trim(), mode: "insensitive" as const });
  if (params.konto?.trim()) and.push({ firma_konto: { OR: [{ sifra: contains(params.konto) }, { naziv: contains(params.konto) }] } });
  if (params.partner?.trim()) and.push({ komitent: { OR: [{ naziv: contains(params.partner) }, { pib: contains(params.partner) }] } });
  if (params.dokument?.trim()) and.push({ broj_dokumenta: contains(params.dokument) });
  if (params.opis?.trim()) and.push({ OR: [{ opis: contains(params.opis) }, { dodatni_opis: contains(params.opis) }, { nalog: { opis: contains(params.opis) } }] });
  if (params.nalog?.trim()) {
    const text = params.nalog.trim();
    const code = /^(.*)-(\d{4})-(\d+)$/.exec(text);
    and.push({ nalog: { OR: [{ sifra: contains(text) }, ...(code ? [{ broj: Number(code[3]), vrsta_naloga: { prefiks: contains(code[1]) } }] : /^\d{1,9}$/.test(text) ? [{ broj: Number(text) }] : [{ vrsta_naloga: { prefiks: contains(text) } }])] } });
  }
  for (const key of ["rbr", "stavka"] as const) if (params[key] && !/^[1-9]\d{0,8}$/.test(params[key])) error = "Redni broj mora biti pozitivan cijeli broj.";
  if (params.stavka && !error) and.push({ redni_broj: Number(params.stavka) });
  if (params.datum_dokumenta) {
    const date = parseDate(params.datum_dokumenta);
    if (!date) error = "Unesite ispravan datum dokumenta.";
    else and.push({ datum_dokumenta: date });
  }
  for (const [key, field] of [["duguje", "duguje"], ["potrazuje", "potrazuje"]] as const) {
    if (!params[key]?.trim()) continue;
    const value = params[key].trim().replace(/\s/g, "");
    // Accept a decimal comma or dot, and local thousands separators (1.234,56).
    const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
    if (!/^-?\d{1,12}(\.\d{1,2})?$/.test(normalized)) error = "Unesite ispravan iznos (npr. 1234,56).";
    else and.push({ [field]: { equals: normalized } });
  }
  if (and.length) where.AND = and;
  const orderBy: Prisma.StavkaNalogaOrderByWithRelationInput[] = [{ nalog: { datum: "asc" } }, { nalog: { created_at: "asc" } }, { nalog_id: "asc" }, { redni_broj: "asc" }];
  const canPrint = await hasPermission(user, { firmaId: context.firmaId, modul: "nalozi", akcija: "export" });
  // Count, totals and page share one database snapshot.
  const result = error ? { count: 0, page: 1, rows: [], debit: 0, credit: 0 } : await prisma.$transaction(async tx => {
    if (params.rbr) {
      const selected = await tx.stavkaNaloga.findMany({ where, orderBy, skip: Number(params.rbr) - 1, take: 1, select: { id: true } });
      where.id = { in: selected.map(row => row.id) };
    }
    const count = await tx.stavkaNaloga.count({ where });
    const page = Math.min(Math.max(1, Number.parseInt(params.strana ?? "1", 10) || 1), Math.max(1, Math.ceil(count / 100)));
    const totals = await tx.stavkaNaloga.aggregate({ where, _sum: { duguje: true, potrazuje: true } });
    const rows = await tx.stavkaNaloga.findMany({ where,
      orderBy,
      ...(print ? {} : { skip: (page - 1) * 100, take: 100 }),
      select: { id: true, nalog_id: true, redni_broj: true, opis: true, dodatni_opis: true, broj_dokumenta: true,
        datum_dokumenta: true, duguje: true, potrazuje: true,
        firma_konto: { select: { sifra: true, naziv: true } }, komitent: { select: { naziv: true, pib: true } },
        nalog: { select: { datum: true, datum_knjizenja: true, opis: true, sifra: true, broj: true, vrsta_naloga: { select: { prefiks: true } } } } }
    });
    return { count, page, rows: rows.map(row => ({ ...row, debit: Number(decimalToScaled(row.duguje, 2)), credit: Number(decimalToScaled(row.potrazuje, 2)) })),
      debit: Number(decimalToScaled(totals._sum.duguje ?? 0, 2)), credit: Number(decimalToScaled(totals._sum.potrazuje ?? 0, 2)) };
  }, { isolationLevel: "RepeatableRead" });
  return { firma, godina, canPrint, error, ordinal: params.rbr ? Number(params.rbr) : null, ...result };
}
