import Link from "next/link";
import { inventoryPriceAdjustmentStatusLabel } from "@/lib/inventory-price-adjustment";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { getInventoryContext, InventoryAccessDenied, MissingInventoryContext } from "../_shared";
import { createInventoryPriceAdjustment } from "./actions";

const messages: Record<string, string> = {
  obavezna_polja: "Izaberite maloprodajni magacin i unesite datum nivelacije.",
  magacin: "Nivelacija je dostupna samo za aktivan maloprodajni magacin ove firme.",
  datum_van_godine: "Datum nivelacije mora biti unutar izabrane poslovne godine.",
  zakljucana_godina: "Poslovna godina je zaključana.",
  prava: "Nemate pravo za ovu akciju.",
  obrisana: "Nacrt nivelacije je obrisan."
};

function signed(value: { toString(): string }) {
  const amount = Number(value.toString());
  return `${amount > 0 ? "+" : ""}${amount.toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function InventoryPriceAdjustmentsPage({ searchParams }: { searchParams: Promise<{ poruka?: string; status?: string }> }) {
  const [{ poruka, status }, context, work] = await Promise.all([searchParams, getInventoryContext("view"), readWorkContext()]);
  if (!context.firma) return <MissingInventoryContext title="Nivelacija cijena" />;
  if (!context.allowed) return <InventoryAccessDenied title="Nivelacija cijena" />;
  if (!work.poslovnaGodinaId) return <div className="admin-stack"><header className="admin-header"><div><p className="eyebrow">Robno / Promet robe</p><h2>Nivelacija cijena</h2></div></header><section className="admin-panel"><p className="empty-state">Izaberite poslovnu godinu u gornjoj traci.</p></section></div>;

  const [year, warehouses, adjustments] = await Promise.all([
    prisma.poslovnaGodina.findFirst({ where: { id: work.poslovnaGodinaId, firma_id: context.firma.id }, select: { godina: true, datum_od: true, datum_do: true, zakljucena: true } }),
    prisma.magacin.findMany({ where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, aktivan: true, is_deleted: false, tip_prodaje: "RETAIL" }, include: { poslovna_jedinica: { select: { sifra: true, naziv: true } } }, orderBy: [{ sifra: "asc" }, { naziv: "asc" }] }),
    prisma.nivelacijaCijena.findMany({ where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, poslovna_godina_id: work.poslovnaGodinaId, is_deleted: false, ...(status ? { status } : {}) }, include: { magacin: { select: { sifra: true, naziv: true } }, _count: { select: { stavke: true } } }, orderBy: [{ datum: "desc" }, { broj: "desc" }] })
  ]);
  const today = new Date();
  const defaultDate = year && today >= year.datum_od && today <= year.datum_do ? today : year?.datum_do;

  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Robno / Promet robe</p><h2>Nivelacija cijena</h2><p className="muted-text">Promjena maloprodajnih cijena bez promjene količine i nabavne vrijednosti robe.</p></div><Link className="secondary-button" href="/agencija/robno/promet">Pregled prometa</Link></header>
    {poruka ? <p className="admin-message">{messages[poruka] ?? poruka}</p> : null}
    <section className="admin-form-section"><div className="panel-header"><div><h3>Nova nivelacija</h3><p className="muted-text">Nacrt ne mijenja lager ni cjenovnik dok dokument ne bude proknjižen.</p></div><span>{warehouses.length} maloprodajnih magacina</span></div>
      {year?.zakljucena ? <p className="empty-state">Poslovna godina je zaključana.</p> : !warehouses.length ? <p className="empty-state">Nema aktivnog maloprodajnog magacina.</p> : <form action={createInventoryPriceAdjustment} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><label><span>Maloprodajni magacin</span><select name="magacin_id" required><option value="">Izaberite magacin</option>{warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.sifra} · {warehouse.naziv}{warehouse.poslovna_jedinica ? ` — ${warehouse.poslovna_jedinica.sifra} · ${warehouse.poslovna_jedinica.naziv}` : ""}</option>)}</select></label><label><span>Datum nivelacije</span><input type="date" name="datum" required defaultValue={defaultDate?.toISOString().slice(0, 10)} min={year?.datum_od.toISOString().slice(0, 10)} max={year?.datum_do.toISOString().slice(0, 10)} /></label><label className="form-wide"><span>Napomena</span><input name="napomena" placeholder="npr. Promjena maloprodajnog cjenovnika" /></label><div className="form-actions form-wide"><button className="primary-button" type="submit">Otvori nacrt nivelacije</button></div></form>}
    </section>
    <section className="admin-panel"><div className="panel-header"><h3>Pregled nivelacija</h3><div className="table-actions"><Link href="/agencija/robno/nivelacija">Sve</Link><Link href="/agencija/robno/nivelacija?status=DRAFT">Nacrti</Link><Link href="/agencija/robno/nivelacija?status=POSTED">Proknjižene</Link></div></div>{adjustments.length ? <div className="table-wrap"><table className="admin-table"><thead><tr><th>Broj</th><th>Datum</th><th>Magacin</th><th>Stavke</th><th>Promjena MP vrijednosti</th><th>Status</th><th></th></tr></thead><tbody>{adjustments.map((adjustment) => <tr key={adjustment.id}><td><strong>{adjustment.interni_broj}</strong></td><td>{adjustment.datum.toLocaleDateString("sr-Latn-ME")}</td><td>{adjustment.magacin.sifra} · {adjustment.magacin.naziv}</td><td>{adjustment._count.stavke}</td><td className="numeric-cell">{signed(adjustment.ukupna_promjena_maloprodajne_vrijednosti)}</td><td><span className={`status-badge status-${adjustment.status.toLowerCase()}`}>{inventoryPriceAdjustmentStatusLabel(adjustment.status)}</span></td><td><Link className="secondary-link" href={`/agencija/robno/nivelacija/${adjustment.id}`}>Otvori</Link></td></tr>)}</tbody></table></div> : <p className="empty-state">Nema nivelacija za izabrani filter.</p>}</section>
  </div>;
}
