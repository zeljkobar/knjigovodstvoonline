import Link from "next/link";
import { inventoryTransferStatusLabel } from "@/lib/inventory-transfer";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { getInventoryContext, InventoryAccessDenied, MissingInventoryContext } from "../_shared";
import { createInventoryTransfer } from "./actions";

const messages: Record<string, string> = {
  obavezna_polja: "Izaberite dva različita magacina i unesite datum prenosa.",
  magacini: "Izabrani magacini nijesu dostupni u ovoj firmi.",
  datum_van_godine: "Datum prenosa mora biti unutar izabrane poslovne godine.",
  zakljucana_godina: "Poslovna godina je zaključana.",
  prava: "Nemate pravo za ovu akciju.",
  obrisan: "Nacrt prenosa je obrisan."
};

function money(value: { toString(): string }) {
  return Number(value.toString()).toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function InventoryTransfersPage({ searchParams }: { searchParams: Promise<{ poruka?: string; status?: string }> }) {
  const [{ poruka, status }, context, work] = await Promise.all([searchParams, getInventoryContext("view"), readWorkContext()]);
  if (!context.firma) return <MissingInventoryContext title="Prenos robe" />;
  if (!context.allowed) return <InventoryAccessDenied title="Prenos robe" />;
  if (!work.poslovnaGodinaId) return <div className="admin-stack"><header className="admin-header"><div><p className="eyebrow">Robno / Promet robe</p><h2>Prenos robe</h2></div></header><section className="admin-panel"><p className="empty-state">Izaberite poslovnu godinu u gornjoj traci.</p></section></div>;
  const [year, warehouses, transfers] = await Promise.all([
    prisma.poslovnaGodina.findFirst({ where: { id: work.poslovnaGodinaId, firma_id: context.firma.id }, select: { godina: true, datum_od: true, datum_do: true, zakljucena: true } }),
    prisma.magacin.findMany({ where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, aktivan: true, is_deleted: false }, include: { poslovna_jedinica: { select: { sifra: true, naziv: true } } }, orderBy: [{ sifra: "asc" }, { naziv: "asc" }] }),
    prisma.prenosRobe.findMany({ where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, poslovna_godina_id: work.poslovnaGodinaId, is_deleted: false, ...(status ? { status } : {}) }, include: { izvorni_magacin: { select: { sifra: true, naziv: true } }, odredisni_magacin: { select: { sifra: true, naziv: true } }, _count: { select: { stavke: true } } }, orderBy: [{ datum: "desc" }, { broj: "desc" }] })
  ]);
  const today = new Date();
  const defaultDate = year && today >= year.datum_od && today <= year.datum_do ? today : year?.datum_od;
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Robno / Promet robe</p><h2>Prenos robe</h2><p className="muted-text">{context.firma.naziv} · {year?.godina}</p></div><Link className="secondary-button" href="/agencija/robno/promet">Pregled prometa</Link></header>
    {poruka ? <p className="admin-message">{messages[poruka] ?? poruka}</p> : null}
    <section className="admin-form-section"><div className="panel-header"><div><h3>Novi prenos</h3><p className="muted-text">Nacrt ne mijenja lager. Roba se prenosi tek poslije potvrde dokumenta.</p></div><span>{warehouses.length} aktivnih magacina</span></div>
      {year?.zakljucena ? <p className="empty-state">Poslovna godina je zaključana.</p> : warehouses.length < 2 ? <p className="empty-state">Za prenos su potrebna najmanje dva aktivna magacina.</p> : <form action={createInventoryTransfer} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><label><span>Iz magacina</span><select name="izvorni_magacin_id" required><option value="">Izaberite izvorni magacin</option>{warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.sifra} · {warehouse.naziv}{warehouse.poslovna_jedinica ? ` — ${warehouse.poslovna_jedinica.sifra} · ${warehouse.poslovna_jedinica.naziv}` : ""}</option>)}</select></label><label><span>U magacin</span><select name="odredisni_magacin_id" required><option value="">Izaberite odredišni magacin</option>{warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.sifra} · {warehouse.naziv}{warehouse.poslovna_jedinica ? ` — ${warehouse.poslovna_jedinica.sifra} · ${warehouse.poslovna_jedinica.naziv}` : ""}</option>)}</select></label><label><span>Datum prenosa</span><input type="date" name="datum" required defaultValue={defaultDate?.toISOString().slice(0, 10)} min={year?.datum_od.toISOString().slice(0, 10)} max={year?.datum_do.toISOString().slice(0, 10)} /></label><label className="form-wide"><span>Napomena</span><input name="napomena" placeholder="Opciono" /></label><div className="form-actions form-wide"><button className="primary-button" type="submit">Otvori nacrt prenosa</button></div></form>}
    </section>
    <section className="admin-panel"><div className="panel-header"><h3>Pregled prenosa</h3><div className="table-actions"><Link href="/agencija/robno/prenos">Svi</Link><Link href="/agencija/robno/prenos?status=DRAFT">Nacrti</Link><Link href="/agencija/robno/prenos?status=POSTED">Proknjiženi</Link></div></div>{transfers.length ? <div className="table-wrap"><table className="admin-table"><thead><tr><th>Broj</th><th>Datum</th><th>Iz magacina</th><th>U magacin</th><th>Stavke</th><th>Vrijednost</th><th>Status</th><th></th></tr></thead><tbody>{transfers.map((transfer) => <tr key={transfer.id}><td><strong>{transfer.interni_broj}</strong></td><td>{transfer.datum.toLocaleDateString("sr-Latn-ME")}</td><td>{transfer.izvorni_magacin.sifra} · {transfer.izvorni_magacin.naziv}</td><td>{transfer.odredisni_magacin.sifra} · {transfer.odredisni_magacin.naziv}</td><td>{transfer._count.stavke}</td><td className="numeric-cell">{money(transfer.ukupna_nabavna_vrijednost)}</td><td><span className={`status-badge status-${transfer.status.toLowerCase()}`}>{inventoryTransferStatusLabel(transfer.status)}</span></td><td><Link className="secondary-link" href={`/agencija/robno/prenos/${transfer.id}`}>Otvori</Link></td></tr>)}</tbody></table></div> : <p className="empty-state">Nema prenosa za izabrani filter.</p>}</section>
  </div>;
}
