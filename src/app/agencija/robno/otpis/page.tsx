import Link from "next/link";
import {
  inventoryWriteOffReasonLabel,
  inventoryWriteOffReasons,
  inventoryWriteOffStatusLabel
} from "@/lib/inventory-write-off";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { getInventoryContext, InventoryAccessDenied, MissingInventoryContext } from "../_shared";
import { createInventoryWriteOff } from "./actions";

const messages: Record<string, string> = {
  obavezna_polja: "Izaberite magacin, datum i razlog otpisa.",
  opis_razloga: "Za drugi razlog unesite opis razloga otpisa.",
  magacin: "Izabrani magacin nije dostupan u ovoj firmi.",
  datum_van_godine: "Datum otpisa mora biti unutar izabrane poslovne godine.",
  zakljucana_godina: "Poslovna godina je zaključana.",
  prava: "Nemate pravo za ovu akciju.",
  obrisan: "Nacrt otpisa je obrisan."
};

function money(value: { toString(): string }) {
  return Number(value.toString()).toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function InventoryWriteOffsPage({ searchParams }: { searchParams: Promise<{ poruka?: string; status?: string }> }) {
  const [{ poruka, status }, context, work] = await Promise.all([searchParams, getInventoryContext("view"), readWorkContext()]);
  if (!context.firma) return <MissingInventoryContext title="Otpis robe" />;
  if (!context.allowed) return <InventoryAccessDenied title="Otpis robe" />;
  if (!work.poslovnaGodinaId) return <div className="admin-stack"><header className="admin-header"><div><p className="eyebrow">Robno / Promet robe</p><h2>Otpis robe</h2></div></header><section className="admin-panel"><p className="empty-state">Izaberite poslovnu godinu u gornjoj traci.</p></section></div>;

  const [year, warehouses, writeOffs] = await Promise.all([
    prisma.poslovnaGodina.findFirst({ where: { id: work.poslovnaGodinaId, firma_id: context.firma.id }, select: { godina: true, datum_od: true, datum_do: true, zakljucena: true } }),
    prisma.magacin.findMany({ where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, aktivan: true, is_deleted: false }, include: { poslovna_jedinica: { select: { sifra: true, naziv: true } } }, orderBy: [{ sifra: "asc" }, { naziv: "asc" }] }),
    prisma.otpisRobe.findMany({ where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, poslovna_godina_id: work.poslovnaGodinaId, is_deleted: false, ...(status ? { status } : {}) }, include: { magacin: { select: { sifra: true, naziv: true } }, _count: { select: { stavke: true } } }, orderBy: [{ datum: "desc" }, { broj: "desc" }] })
  ]);
  const today = new Date();
  const defaultDate = year && today >= year.datum_od && today <= year.datum_do ? today : year?.datum_do;

  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Robno / Promet robe</p><h2>Otpis robe</h2><p className="muted-text">Dokumentovani izlaz oštećene, neupotrebljive ili manjkave robe.</p></div><Link className="secondary-button" href="/agencija/robno/promet">Pregled prometa</Link></header>
    {poruka ? <p className="admin-message">{messages[poruka] ?? poruka}</p> : null}
    <section className="admin-form-section"><div className="panel-header"><div><h3>Novi otpis</h3><p className="muted-text">Nacrt ne mijenja lager. Zalihe se razdužuju tek kada proknjižite dokument.</p></div><span>{warehouses.length} aktivnih magacina</span></div>
      {year?.zakljucena ? <p className="empty-state">Poslovna godina je zaključana.</p> : !warehouses.length ? <p className="empty-state">Prvo dodajte aktivan magacin.</p> : <form action={createInventoryWriteOff} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><label><span>Magacin</span><select name="magacin_id" required><option value="">Izaberite magacin</option>{warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.sifra} · {warehouse.naziv}{warehouse.poslovna_jedinica ? ` — ${warehouse.poslovna_jedinica.sifra} · ${warehouse.poslovna_jedinica.naziv}` : ""}</option>)}</select></label><label><span>Datum otpisa</span><input type="date" name="datum" required defaultValue={defaultDate?.toISOString().slice(0, 10)} min={year?.datum_od.toISOString().slice(0, 10)} max={year?.datum_do.toISOString().slice(0, 10)} /></label><label><span>Razlog</span><select name="razlog" required>{inventoryWriteOffReasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select></label><label><span>Opis drugog razloga</span><input name="opis_razloga" placeholder="Obavezno samo za Drugi razlog" /></label><label className="form-wide"><span>Napomena</span><input name="napomena" placeholder="Opciono" /></label><div className="form-actions form-wide"><button className="primary-button" type="submit">Otvori nacrt otpisa</button></div></form>}
    </section>
    <section className="admin-panel"><div className="panel-header"><h3>Pregled otpisa</h3><div className="table-actions"><Link href="/agencija/robno/otpis">Svi</Link><Link href="/agencija/robno/otpis?status=DRAFT">Nacrti</Link><Link href="/agencija/robno/otpis?status=POSTED">Proknjiženi</Link></div></div>{writeOffs.length ? <div className="table-wrap"><table className="admin-table"><thead><tr><th>Broj</th><th>Datum</th><th>Magacin</th><th>Razlog</th><th>Stavke</th><th>Nabavna vrijednost</th><th>Status</th><th></th></tr></thead><tbody>{writeOffs.map((writeOff) => <tr key={writeOff.id}><td><strong>{writeOff.interni_broj}</strong></td><td>{writeOff.datum.toLocaleDateString("sr-Latn-ME")}</td><td>{writeOff.magacin.sifra} · {writeOff.magacin.naziv}</td><td>{inventoryWriteOffReasonLabel(writeOff.razlog)}</td><td>{writeOff._count.stavke}</td><td className="numeric-cell">{money(writeOff.ukupna_nabavna_vrijednost)}</td><td><span className={`status-badge status-${writeOff.status.toLowerCase()}`}>{inventoryWriteOffStatusLabel(writeOff.status)}</span></td><td><Link className="secondary-link" href={`/agencija/robno/otpis/${writeOff.id}`}>Otvori</Link></td></tr>)}</tbody></table></div> : <p className="empty-state">Nema otpisa za izabrani filter.</p>}</section>
  </div>;
}
