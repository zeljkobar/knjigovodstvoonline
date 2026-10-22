import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { getInventoryContext } from "../_shared";
import { PartnerSearchInput } from "@/components/PartnerSearchInput";
import { saveSupplierReturn } from "./actions";
import type { PovratDobavljacu, Komitent } from "@prisma/client";
import Link from "next/link";

export async function returnView() {
  const context = await getInventoryContext("view");
  const work = await readWorkContext();
  const year = context.firma && work.poslovnaGodinaId ? await prisma.poslovnaGodina.findFirst({ where: { id: work.poslovnaGodinaId, firma_id: context.firma.id } }) : null;
  return { ...context, year };
}
export const returnMoney = (v: { toString(): string }) => Number(v.toString()).toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function ReturnHidden({ companyId, yearId, documentId }: { companyId: string; yearId: string; documentId?: string }) {
  return <><input type="hidden" name="firma_id" value={companyId} /><input type="hidden" name="godina_id" value={yearId} />{documentId ? <input type="hidden" name="povrat_id" value={documentId} /> : null}</>;
}
export async function ReturnHeaderForm({ companyId, agencyId, yearId, defaultDate, document }: { companyId: string; agencyId: string; yearId: string; defaultDate: string; document?: PovratDobavljacu & { dobavljac: Komitent } }) {
  const [warehouses, calculations, entries, books] = await Promise.all([
    prisma.magacin.findMany({ where: { firma_id: companyId, agencija_id: agencyId, aktivan: true, is_deleted: false }, orderBy: { sifra: "asc" } }),
    prisma.kalkulacija.findMany({ where: { firma_id: companyId, agencija_id: agencyId, status: { in: ["WAITING_KUF", "POSTED"] }, is_deleted: false, tip: "DOMESTIC" }, include: { dobavljac: { select: { naziv: true } } }, orderBy: { datum_kalkulacije: "desc" } }),
    prisma.kufEntry.findMany({ where: { firma_id: companyId, agencija_id: agencyId, is_deleted: false, vat_transaction_type: "DOMESTIC", total_gross: { gt: 0 } }, include: { dobavljac: { select: { naziv: true } } }, orderBy: { invoice_date: "desc" } }),
    prisma.kufBook.findMany({ where: { firma_id: companyId, agencija_id: agencyId, poslovna_godina_id: yearId, is_deleted: false }, include: { racun_vrsta: { select: { naziv: true } } }, orderBy: [{ mjesec: "asc" }, { redni_broj: "asc" }] })
  ]);
  const supplier = document?.dobavljac;
  return <form action={saveSupplierReturn} className="admin-form">
    <ReturnHidden companyId={companyId} yearId={yearId} documentId={document?.id} />
    <PartnerSearchInput name="dobavljac_id" label="Dobavljač" required initialPartner={supplier ? { id: supplier.id, naziv: supplier.naziv, label: supplier.naziv, pib: supplier.pib, scope: supplier.scope } : null} />
    <label><span>Magacin</span><select name="magacin_id" required defaultValue={document?.magacin_id ?? (warehouses.length === 1 ? warehouses[0].id : "")}><option value="">Izaberite magacin</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.sifra} · {w.naziv}</option>)}</select></label>
    <label><span>Datum povrata / odobrenja</span><input type="date" name="datum" required defaultValue={document?.datum.toISOString().slice(0, 10) ?? defaultDate} /></label>
    <label><span>Broj odobrenja / dokumenta povrata</span><input name="broj_odobrenja" required maxLength={120} defaultValue={document?.broj_odobrenja} /></label>
    <label><span>Izvorna kalkulacija (opciono)</span><select name="kalkulacija_id" defaultValue={document?.kalkulacija_id ?? ""}><option value="">Samostalan povrat</option>{calculations.map(c => <option key={c.id} value={c.id}>{c.interni_broj} · {c.dobavljac.naziv}</option>)}</select></label>
    <label><span>Izvorni KUF račun (opciono)</span><select name="originalni_kuf_id" defaultValue={document?.originalni_kuf_id ?? ""}><option value="">Bez veze sa računom</option>{entries.map(e => <option key={e.id} value={e.id}>{e.internal_kuf_number} · {e.supplier_invoice_number} · {e.dobavljac.naziv}</option>)}</select></label>
    <label><span>KUF knjiga za negativan zapis</span><select name="kuf_book_id" defaultValue={document?.kuf_book_id ?? ""}><option value="">Izaberite prije knjiženja</option>{books.map(b => <option key={b.id} value={b.id}>{b.mjesec}. mjesec · {b.racun_vrsta.naziv} · {b.internal_kuf_number}</option>)}</select></label>
    <label><span>Napomena</span><input name="napomena" maxLength={2000} defaultValue={document?.napomena ?? ""} /></label>
    <p className="admin-hint form-wide">Domaći povrat. KUF knjiga mora biti iz mjeseca povrata. Izvorna kalkulacija i račun moraju pripadati istom dobavljaču; kalkulacija i istom magacinu. Izvor može biti iz ranije godine.</p>
    {!warehouses.length ? <p className="admin-hint form-wide">Prvo dodajte <Link href="/agencija/robno/magacini">aktivan magacin</Link>.</p> : null}
    <div className="form-actions form-wide"><button type="submit" disabled={!warehouses.length} className="primary-button">{document ? "Sačuvaj zaglavlje" : "Otvori nacrt povrata"}</button></div>
  </form>;
}
