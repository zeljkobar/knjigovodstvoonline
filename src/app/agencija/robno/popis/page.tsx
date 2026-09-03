import Link from "next/link";
import { inventoryCountStatusLabel } from "@/lib/inventory-count";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { getInventoryContext, InventoryAccessDenied, MissingInventoryContext } from "../_shared";
import { createInventoryCount } from "./actions";

const messages: Record<string, string> = {
  obavezna_polja: "Izaberite magacin i unesite datum popisa.",
  magacin: "Izabrani magacin nije dostupan u ovoj firmi.",
  datum_van_godine: "Datum popisa mora biti unutar izabrane poslovne godine.",
  bez_artikala: "Firma nema aktivnih artikala koji prate zalihe.",
  zakljucana_godina: "Poslovna godina je zaključana.",
  prava: "Nemate pravo za ovu akciju.",
  obrisan: "Nacrt popisa je obrisan."
};

function money(value: { toString(): string }) {
  return Number(value.toString()).toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function InventoryCountsPage({ searchParams }: { searchParams: Promise<{ poruka?: string; status?: string }> }) {
  const [{ poruka, status }, context, work] = await Promise.all([searchParams, getInventoryContext("view"), readWorkContext()]);
  if (!context.firma) return <MissingInventoryContext title="Popis robe" />;
  if (!context.allowed) return <InventoryAccessDenied title="Popis robe" />;
  if (!work.poslovnaGodinaId) return <div className="admin-stack"><header className="admin-header"><div><p className="eyebrow">Robno / Promet robe</p><h2>Popis robe</h2></div></header><section className="admin-panel"><p className="empty-state">Izaberite poslovnu godinu u gornjoj traci.</p></section></div>;
  const [year, warehouses, counts] = await Promise.all([
    prisma.poslovnaGodina.findFirst({ where: { id: work.poslovnaGodinaId, firma_id: context.firma.id }, select: { godina: true, datum_od: true, datum_do: true, zakljucena: true } }),
    prisma.magacin.findMany({ where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, aktivan: true, is_deleted: false }, include: { poslovna_jedinica: { select: { sifra: true, naziv: true } } }, orderBy: [{ sifra: "asc" }, { naziv: "asc" }] }),
    prisma.popisRobe.findMany({ where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, poslovna_godina_id: work.poslovnaGodinaId, is_deleted: false, ...(status ? { status } : {}) }, include: { magacin: { select: { sifra: true, naziv: true } }, _count: { select: { stavke: true } } }, orderBy: [{ datum: "desc" }, { broj: "desc" }] })
  ]);
  const today = new Date();
  const defaultDate = year && today >= year.datum_od && today <= year.datum_do ? today : year?.datum_do;
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Robno / Promet robe</p><h2>Popis robe</h2><p className="muted-text">Knjigovodstveno i stvarno stanje po magacinu, sa automatskim viškom i manjkom.</p></div><Link className="secondary-button" href="/agencija/robno/promet">Pregled prometa</Link></header>
    {poruka ? <p className="admin-message">{messages[poruka] ?? poruka}</p> : null}
    <section className="admin-form-section"><div className="panel-header"><div><h3>Novi popis</h3><p className="muted-text">Otvaranjem se snima trenutno knjigovodstveno stanje svih aktivnih artikala izabranog magacina.</p></div><span>{warehouses.length} aktivnih magacina</span></div>
      {year?.zakljucena ? <p className="empty-state">Poslovna godina je zaključana.</p> : !warehouses.length ? <p className="empty-state">Prvo dodajte aktivan magacin.</p> : <form action={createInventoryCount} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><label><span>Magacin</span><select name="magacin_id" required><option value="">Izaberite magacin</option>{warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.sifra} · {warehouse.naziv}{warehouse.poslovna_jedinica ? ` — ${warehouse.poslovna_jedinica.sifra} · ${warehouse.poslovna_jedinica.naziv}` : ""}</option>)}</select></label><label><span>Datum popisa</span><input type="date" name="datum" required defaultValue={defaultDate?.toISOString().slice(0, 10)} min={year?.datum_od.toISOString().slice(0, 10)} max={year?.datum_do.toISOString().slice(0, 10)} /></label><label className="form-wide"><span>Napomena</span><input name="napomena" placeholder="npr. Redovni godišnji popis" /></label><div className="form-actions form-wide"><button className="primary-button" type="submit">Otvori popis</button></div></form>}
    </section>
    <section className="admin-panel"><div className="panel-header"><h3>Pregled popisa</h3><div className="table-actions"><Link href="/agencija/robno/popis">Svi</Link><Link href="/agencija/robno/popis?status=DRAFT">Nacrti</Link><Link href="/agencija/robno/popis?status=POSTED">Proknjiženi</Link></div></div>{counts.length ? <div className="table-wrap"><table className="admin-table"><thead><tr><th>Broj</th><th>Datum</th><th>Magacin</th><th>Stavke</th><th>Višak</th><th>Manjak</th><th>Status</th><th></th></tr></thead><tbody>{counts.map((count) => <tr key={count.id}><td><strong>{count.interni_broj}</strong></td><td>{count.datum.toLocaleDateString("sr-Latn-ME")}</td><td>{count.magacin.sifra} · {count.magacin.naziv}</td><td>{count._count.stavke}</td><td className="numeric-cell">{money(count.ukupna_vrijednost_viska)}</td><td className="numeric-cell">{money(count.ukupna_vrijednost_manjka)}</td><td><span className={`status-badge status-${count.status.toLowerCase()}`}>{inventoryCountStatusLabel(count.status)}</span></td><td><Link className="secondary-link" href={`/agencija/robno/popis/${count.id}`}>Otvori</Link></td></tr>)}</tbody></table></div> : <p className="empty-state">Nema popisa za izabrani filter.</p>}</section>
  </div>;
}
