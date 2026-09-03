import Link from "next/link";
import { notFound } from "next/navigation";
import { inventoryTransferStatusLabel, inventoryTransferStatuses } from "@/lib/inventory-transfer";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { getInventoryContext, InventoryAccessDenied, MissingInventoryContext } from "../../_shared";
import { addInventoryTransferLine, deleteInventoryTransfer, deleteInventoryTransferLine, postInventoryTransfer, updateInventoryTransferHeader, updateInventoryTransferLine } from "../actions";

const messages: Record<string, string> = {
  kreiran: "Nacrt prenosa je otvoren. Dodajte artikle i količine.",
  zaglavlje_sacuvano: "Podaci prenosa su sačuvani.",
  stavka_dodata: "Stavka je dodata.",
  stavka_sacuvana: "Količina je sačuvana.",
  stavka_obrisana: "Stavka je obrisana.",
  stavka: "Izaberite artikal i unesite pozitivnu količinu.",
  artikal: "Izabrani artikal nije dostupan.",
  dupli_artikal: "Artikal je već dodat u ovaj prenos.",
  bez_stavki: "Dodajte najmanje jednu stavku.",
  nije_nacrt: "Mijenjati i knjižiti se može samo aktivan nacrt.",
  magacini: "Izaberite dva različita aktivna magacina.",
  obavezna_polja: "Popunite obavezna polja prenosa.",
  datum_van_godine: "Datum prenosa mora biti unutar poslovne godine.",
  podesavanja: "Prvo podesite konta prenosa u Robno → Podešavanja.",
  smjer: "Smjerovi knjiženja prenosa nijesu ispravni.",
  konto: "Izabrano konto prenosa nije dostupno ili zahtijeva partnera.",
  vrsta_naloga: "Sistemska vrsta naloga Prenos robe nije dostupna.",
  zakljucana_godina: "Poslovna godina je zaključana.",
  prava: "Nemate pravo za ovu akciju."
};

function money(value: { toString(): string }, digits = 2) {
  return Number(value.toString()).toLocaleString("sr-Latn-ME", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default async function InventoryTransferDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ poruka?: string }> }) {
  const [{ id }, { poruka }, rawContext, work] = await Promise.all([params, searchParams, getInventoryContext("view"), readWorkContext()]);
  if (!rawContext.firma || !work.poslovnaGodinaId) return <MissingInventoryContext title="Prenos robe" />;
  if (!rawContext.allowed) return <InventoryAccessDenied title="Prenos robe" />;
  const context = rawContext as typeof rawContext & { firma: NonNullable<typeof rawContext.firma> };
  const transfer = await prisma.prenosRobe.findFirst({
    where: { id, agencija_id: context.user.agencija_id!, firma_id: context.firma.id, poslovna_godina_id: work.poslovnaGodinaId, is_deleted: false },
    include: {
      poslovna_godina: { select: { godina: true, datum_od: true, datum_do: true, zakljucena: true } },
      izvorni_magacin: { include: { poslovna_jedinica: { select: { sifra: true, naziv: true } } } },
      odredisni_magacin: { include: { poslovna_jedinica: { select: { sifra: true, naziv: true } } } },
      nalog: { select: { id: true, sifra: true, status: true } },
      stavke: { include: { artikal: { include: { jedinica_mjere: true } } }, orderBy: { redni_broj: "asc" } }
    }
  });
  if (!transfer) notFound();
  const [warehouses, items, sourceStates] = await Promise.all([
    prisma.magacin.findMany({ where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, aktivan: true, is_deleted: false }, include: { poslovna_jedinica: { select: { sifra: true, naziv: true } } }, orderBy: [{ sifra: "asc" }, { naziv: "asc" }] }),
    prisma.artikal.findMany({ where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, aktivan: true, is_deleted: false, usluga: false, prati_zalihe: true }, include: { jedinica_mjere: true }, orderBy: [{ sifra: "asc" }, { naziv: "asc" }] }),
    prisma.stanjeZaliha.findMany({ where: { firma_id: context.firma.id, poslovna_godina_id: work.poslovnaGodinaId, magacin_id: transfer.izvorni_magacin_id }, select: { artikal_id: true, kolicina: true, prosjecna_nabavna_cijena: true } })
  ]);
  const stateMap = new Map(sourceStates.map((state) => [state.artikal_id, state]));
  const editable = transfer.status === inventoryTransferStatuses.draft && !transfer.poslovna_godina.zakljucena;
  const dynamicMessage = poruka?.startsWith("proknjizen:")
    ? `Prenos je proknjižen, oba lagera su ažurirana i kreiran je nacrt naloga ${poruka.split(":")[1] ?? ""}.`
    : poruka?.startsWith("lager:")
      ? `Nema dovoljno artikla ${poruka.split(":")[1] ?? ""}. Dostupno: ${poruka.split(":")[2] ?? "0"}.`
      : poruka?.startsWith("nabavna:")
        ? `Artikal ${poruka.split(":")[1] ?? ""} nema prosječnu nabavnu cijenu u izvornom magacinu.`
        : poruka ? messages[poruka] ?? poruka : null;
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Robno / Promet robe / Prenos</p><h2>{transfer.interni_broj}</h2><p className="muted-text">{transfer.izvorni_magacin.sifra} · {transfer.izvorni_magacin.naziv} → {transfer.odredisni_magacin.sifra} · {transfer.odredisni_magacin.naziv}</p></div><div className="header-actions"><span className={`status-badge status-${transfer.status.toLowerCase()}`}>{inventoryTransferStatusLabel(transfer.status)}</span><Link className="secondary-button" href={`/stampa/robno/prenos/${transfer.id}`} target="_blank">Štampa</Link><Link className="secondary-button" href="/agencija/robno/prenos">Nazad</Link></div></header>
    {dynamicMessage ? <p className="admin-message">{dynamicMessage}</p> : null}
    <section className="metric-grid"><article className="metric"><span>Stavki</span><strong>{transfer.stavke.length}</strong></article><article className="metric"><span>Nabavna vrijednost</span><strong>{money(transfer.ukupna_nabavna_vrijednost)} €</strong></article><article className="metric"><span>Nalog</span><strong>{transfer.nalog?.sifra ?? "-"}</strong></article></section>
    <section className="admin-panel"><div className="panel-header"><div><h3>Podaci prenosa</h3><p className="muted-text">Poslovne jedinice se preuzimaju sa izabranih magacina.</p></div><span>{transfer.datum.toLocaleDateString("sr-Latn-ME")}</span></div>
      {editable ? <form action={updateInventoryTransferHeader} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="prenos_id" value={transfer.id} /><label><span>Iz magacina</span><select name="izvorni_magacin_id" defaultValue={transfer.izvorni_magacin_id} required>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.sifra} · {warehouse.naziv}{warehouse.poslovna_jedinica ? ` — ${warehouse.poslovna_jedinica.sifra} · ${warehouse.poslovna_jedinica.naziv}` : ""}</option>)}</select></label><label><span>U magacin</span><select name="odredisni_magacin_id" defaultValue={transfer.odredisni_magacin_id} required>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.sifra} · {warehouse.naziv}{warehouse.poslovna_jedinica ? ` — ${warehouse.poslovna_jedinica.sifra} · ${warehouse.poslovna_jedinica.naziv}` : ""}</option>)}</select></label><label><span>Datum</span><input type="date" name="datum" defaultValue={transfer.datum.toISOString().slice(0, 10)} min={transfer.poslovna_godina.datum_od.toISOString().slice(0, 10)} max={transfer.poslovna_godina.datum_do.toISOString().slice(0, 10)} required /></label><label className="form-wide"><span>Napomena</span><input name="napomena" defaultValue={transfer.napomena ?? ""} /></label><div className="form-actions form-wide"><button className="secondary-button" type="submit">Sačuvaj podatke</button></div></form> : <div className="invoice-summary-grid"><span>Izvorna poslovna jedinica <strong>{transfer.izvorni_magacin.poslovna_jedinica ? `${transfer.izvorni_magacin.poslovna_jedinica.sifra} · ${transfer.izvorni_magacin.poslovna_jedinica.naziv}` : "-"}</strong></span><span>Odredišna poslovna jedinica <strong>{transfer.odredisni_magacin.poslovna_jedinica ? `${transfer.odredisni_magacin.poslovna_jedinica.sifra} · ${transfer.odredisni_magacin.poslovna_jedinica.naziv}` : "-"}</strong></span><span>Napomena <strong>{transfer.napomena ?? "-"}</strong></span></div>}
    </section>
    {editable ? <section className="admin-form-section"><div className="panel-header"><div><h3>Dodaj artikal</h3><p className="muted-text">Prikazana raspoloživa količina odnosi se na trenutni lager izvornog magacina.</p></div><span>Nacrt</span></div><form action={addInventoryTransferLine} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="prenos_id" value={transfer.id} /><label className="form-wide"><span>Artikal</span><select name="artikal_id" required><option value="">Izaberite artikal</option>{items.map((item) => { const state = stateMap.get(item.id); return <option key={item.id} value={item.id}>{item.sifra} · {item.naziv} — stanje {state?.kolicina.toString() ?? "0.000"} {item.jedinica_mjere.oznaka}</option>; })}</select></label><label><span>Količina</span><input name="kolicina" inputMode="decimal" placeholder="0,000" required /></label><div className="form-actions"><button className="primary-button" type="submit">Dodaj stavku</button></div></form></section> : null}
    <section className="admin-panel"><div className="panel-header"><div><h3>Stavke prenosa</h3><p className="muted-text">Nabavna cijena se konačno utvrđuje iz prosječne cijene izvornog magacina pri knjiženju.</p></div><span>{transfer.stavke.length} stavki</span></div>{transfer.stavke.length ? <div className="table-wrap"><table className="admin-table"><thead><tr><th>#</th><th>Artikal</th><th>JM</th><th>Raspoloživo</th><th>Količina</th><th>Nabavna cijena</th><th>Vrijednost</th>{editable ? <th></th> : null}</tr></thead><tbody>{transfer.stavke.map((line) => { const state = stateMap.get(line.artikal_id); return <tr key={line.id}><td>{line.redni_broj}</td><td><strong>{line.artikal.sifra}</strong><small className="table-secondary">{line.artikal.naziv}</small></td><td>{line.artikal.jedinica_mjere.oznaka}</td><td className="numeric-cell">{money(state?.kolicina ?? { toString: () => "0" }, 3)}</td><td>{editable ? <form action={updateInventoryTransferLine} className="table-actions"><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="prenos_id" value={transfer.id} /><input type="hidden" name="stavka_id" value={line.id} /><input className="compact-input" name="kolicina" defaultValue={line.kolicina.toString()} inputMode="decimal" /><button className="secondary-button" type="submit">Sačuvaj</button></form> : money(line.kolicina, 3)}</td><td className="numeric-cell">{money(line.jedinicna_nabavna_cijena, 4)}</td><td className="numeric-cell">{money(line.nabavna_vrijednost)}</td>{editable ? <td><form action={deleteInventoryTransferLine}><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="prenos_id" value={transfer.id} /><input type="hidden" name="stavka_id" value={line.id} /><button className="danger-link" type="submit">Obriši</button></form></td> : null}</tr>; })}</tbody></table></div> : <p className="empty-state">Još nema stavki.</p>}</section>
    {editable ? <section className="admin-panel"><div className="panel-header"><div><h3>Knjiženje prenosa</h3><p className="muted-text">Provjerava lager i prosječnu nabavnu cijenu, zatim istovremeno razdužuje izvorni i zadužuje odredišni magacin.</p></div><Link className="secondary-link" href="/agencija/robno/podesavanja">Konta prenosa</Link></div><div className="form-actions"><form action={postInventoryTransfer}><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="prenos_id" value={transfer.id} /><button className="primary-button" type="submit" disabled={!transfer.stavke.length}>Proknjiži prenos</button></form><form action={deleteInventoryTransfer}><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="prenos_id" value={transfer.id} /><button className="danger-button" type="submit">Obriši nacrt</button></form></div></section> : transfer.nalog ? <section className="admin-panel"><div className="panel-header"><div><h3>Računovodstveni nalog</h3><p className="muted-text">Lager je proknjižen. Povezani nalog je kreiran kao nacrt za kontrolu i knjiženje u glavnu knjigu.</p></div><Link className="secondary-button" href={`/agencija/nalozi/${transfer.nalog.id}`}>Otvori {transfer.nalog.sifra ?? "nalog"}</Link></div></section> : null}
  </div>;
}
