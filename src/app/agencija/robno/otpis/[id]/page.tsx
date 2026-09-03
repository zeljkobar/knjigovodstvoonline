import Link from "next/link";
import { notFound } from "next/navigation";
import {
  inventoryWriteOffReasonLabel,
  inventoryWriteOffReasons,
  inventoryWriteOffStatusLabel,
  inventoryWriteOffStatuses
} from "@/lib/inventory-write-off";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { getInventoryContext, InventoryAccessDenied, MissingInventoryContext } from "../../_shared";
import { addInventoryWriteOffLine, deleteInventoryWriteOff, deleteInventoryWriteOffLine, postInventoryWriteOff, updateInventoryWriteOffHeader, updateInventoryWriteOffLine } from "../actions";

const messages: Record<string, string> = {
  kreiran: "Nacrt otpisa je otvoren. Dodajte artikle i količine.",
  zaglavlje_sacuvano: "Podaci otpisa su sačuvani.",
  stavka_dodata: "Stavka je dodata.",
  stavka_dodata_bez_cijene: "Stavka je dodata, ali nema raspoloživu nabavnu cijenu. Unesite procijenjenu cijenu prije knjiženja.",
  stavka_sacuvana: "Stavka je sačuvana.",
  stavka_obrisana: "Stavka je obrisana.",
  stavka: "Izaberite artikal i unesite pozitivnu količinu i, ako je koristite, pozitivnu procijenjenu cijenu.",
  artikal: "Izabrani artikal nije dostupan.",
  dupli_artikal: "Artikal je već dodat u ovaj otpis.",
  bez_stavki: "Dodajte najmanje jednu stavku.",
  nije_nacrt: "Mijenjati i knjižiti se može samo aktivan nacrt.",
  obavezna_polja: "Popunite datum i razlog otpisa.",
  opis_razloga: "Za drugi razlog unesite opis razloga otpisa.",
  datum_van_godine: "Datum otpisa mora biti unutar poslovne godine.",
  podesavanja: "Prvo podesite konta otpisa u Robno → Podešavanja.",
  smjer: "Smjerovi knjiženja otpisa nijesu ispravni.",
  konto: "Izabrano konto otpisa nije dostupno ili zahtijeva partnera.",
  konto_troska: "Konto troška otpisa mora počinjati sa 5.",
  vrsta_naloga: "Sistemska vrsta naloga Otpis robe nije dostupna.",
  zakljucana_godina: "Poslovna godina je zaključana.",
  prava: "Nemate pravo za ovu akciju."
};

function number(value: { toString(): string } | null, digits = 2) {
  if (value === null) return "—";
  return Number(value.toString()).toLocaleString("sr-Latn-ME", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default async function InventoryWriteOffDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ poruka?: string }> }) {
  const [{ id }, { poruka }, rawContext, work] = await Promise.all([params, searchParams, getInventoryContext("view"), readWorkContext()]);
  if (!rawContext.firma || !work.poslovnaGodinaId) return <MissingInventoryContext title="Otpis robe" />;
  if (!rawContext.allowed) return <InventoryAccessDenied title="Otpis robe" />;
  const context = rawContext as typeof rawContext & { firma: NonNullable<typeof rawContext.firma> };
  const writeOff = await prisma.otpisRobe.findFirst({ where: { id, agencija_id: context.user.agencija_id!, firma_id: context.firma.id, poslovna_godina_id: work.poslovnaGodinaId, is_deleted: false }, include: { poslovna_godina: { select: { godina: true, datum_od: true, datum_do: true, zakljucena: true } }, magacin: { include: { poslovna_jedinica: { select: { sifra: true, naziv: true } } } }, nalog: { select: { id: true, sifra: true, status: true } }, stavke: { include: { artikal: { include: { jedinica_mjere: true } } }, orderBy: { redni_broj: "asc" } } } });
  if (!writeOff) notFound();
  const [items, states] = await Promise.all([
    prisma.artikal.findMany({ where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, aktivan: true, is_deleted: false, usluga: false, prati_zalihe: true }, include: { jedinica_mjere: true }, orderBy: [{ sifra: "asc" }, { naziv: "asc" }] }),
    prisma.stanjeZaliha.findMany({ where: { firma_id: context.firma.id, poslovna_godina_id: work.poslovnaGodinaId, magacin_id: writeOff.magacin_id }, select: { artikal_id: true, kolicina: true, prosjecna_nabavna_cijena: true } })
  ]);
  const stateMap = new Map(states.map((state) => [state.artikal_id, state]));
  const editable = writeOff.status === inventoryWriteOffStatuses.draft && !writeOff.poslovna_godina.zakljucena;
  const totalCost = writeOff.status === inventoryWriteOffStatuses.posted ? writeOff.ukupna_nabavna_vrijednost : { toString: () => String(writeOff.stavke.reduce((sum, line) => sum + Number(line.nabavna_vrijednost), 0)) };
  const dynamicMessage = poruka?.startsWith("proknjizen:") ? `Otpis je proknjižen, lager je razdužen i kreiran je nacrt naloga ${poruka.split(":")[1] ?? ""}.` : poruka?.startsWith("lager:") ? `Nema dovoljno artikla ${poruka.split(":")[1] ?? ""}. Dostupno: ${poruka.split(":")[2] ?? "0"}, traženo: ${poruka.split(":")[3] ?? "0"}.` : poruka?.startsWith("nabavna:") ? `Artikal ${poruka.split(":")[1] ?? ""} nema nabavnu cijenu. Unesite procijenjenu nabavnu cijenu.` : poruka ? messages[poruka] ?? poruka : null;

  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Robno / Promet robe / Otpis</p><h2>{writeOff.interni_broj}</h2><p className="muted-text">{writeOff.magacin.sifra} · {writeOff.magacin.naziv}</p></div><div className="header-actions"><span className={`status-badge status-${writeOff.status.toLowerCase()}`}>{inventoryWriteOffStatusLabel(writeOff.status)}</span><Link className="secondary-button" href={`/stampa/robno/otpis/${writeOff.id}`} target="_blank">Štampa</Link><Link className="secondary-button" href="/agencija/robno/otpis">Nazad</Link></div></header>
    {dynamicMessage ? <p className="admin-message">{dynamicMessage}</p> : null}
    <section className="metric-grid"><article className="metric"><span>Stavki</span><strong>{writeOff.stavke.length}</strong></article><article className="metric"><span>Nabavna vrijednost</span><strong>{number(totalCost)} €</strong></article><article className="metric"><span>Maloprodajna vrijednost</span><strong>{number(writeOff.ukupna_maloprodajna_vrijednost)} €</strong></article><article className="metric"><span>Nalog</span><strong>{writeOff.nalog?.sifra ?? "-"}</strong></article></section>
    <section className="admin-panel"><div className="panel-header"><div><h3>Podaci otpisa</h3><p className="muted-text">Magacin i poslovna jedinica ostaju vezani za dokument od trenutka otvaranja.</p></div><span>{writeOff.magacin.poslovna_jedinica ? `${writeOff.magacin.poslovna_jedinica.sifra} · ${writeOff.magacin.poslovna_jedinica.naziv}` : "Bez poslovne jedinice"}</span></div>{editable ? <form action={updateInventoryWriteOffHeader} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="otpis_id" value={writeOff.id} /><label><span>Datum</span><input type="date" name="datum" defaultValue={writeOff.datum.toISOString().slice(0, 10)} min={writeOff.poslovna_godina.datum_od.toISOString().slice(0, 10)} max={writeOff.poslovna_godina.datum_do.toISOString().slice(0, 10)} required /></label><label><span>Razlog</span><select name="razlog" defaultValue={writeOff.razlog}>{inventoryWriteOffReasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}</select></label><label className="form-wide"><span>Opis drugog razloga</span><input name="opis_razloga" defaultValue={writeOff.opis_razloga ?? ""} placeholder="Obavezno samo za Drugi razlog" /></label><label className="form-wide"><span>Napomena</span><input name="napomena" defaultValue={writeOff.napomena ?? ""} /></label><div className="form-actions form-wide"><button className="secondary-button" type="submit">Sačuvaj podatke</button></div></form> : <div className="invoice-summary-grid"><span>Datum <strong>{writeOff.datum.toLocaleDateString("sr-Latn-ME")}</strong></span><span>Razlog <strong>{inventoryWriteOffReasonLabel(writeOff.razlog)}</strong></span><span>Opis razloga <strong>{writeOff.opis_razloga ?? "-"}</strong></span><span>Napomena <strong>{writeOff.napomena ?? "-"}</strong></span></div>}</section>
    {editable ? <section className="admin-form-section"><div className="panel-header"><div><h3>Dodaj artikal</h3><p className="muted-text">Procijenjena cijena koristi se samo ako lager nema prosječnu ni artikal posljednju nabavnu cijenu.</p></div><span>Nacrt</span></div><form action={addInventoryWriteOffLine} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="otpis_id" value={writeOff.id} /><label className="form-wide"><span>Artikal</span><select name="artikal_id" required><option value="">Izaberite artikal</option>{items.map((item) => { const state = stateMap.get(item.id); return <option key={item.id} value={item.id}>{item.sifra} · {item.naziv} — stanje {state?.kolicina.toString() ?? "0.000"} {item.jedinica_mjere.oznaka}</option>; })}</select></label><label><span>Količina</span><input name="kolicina" inputMode="decimal" placeholder="0,000" required /></label><label><span>Procijenjena nabavna cijena</span><input name="procijenjena_cijena" inputMode="decimal" placeholder="Opciono" /></label><label className="form-wide"><span>Napomena stavke</span><input name="napomena_stavke" placeholder="Opciono" /></label><div className="form-actions form-wide"><button className="primary-button" type="submit">Dodaj stavku</button></div></form></section> : null}
    <section className="admin-panel"><div className="panel-header"><div><h3>Stavke otpisa</h3><p className="muted-text">Vrijednosti se konačno obračunavaju iz lagera u trenutku knjiženja.</p></div><span>{writeOff.stavke.length} stavki</span></div>{writeOff.stavke.length ? <div className="table-wrap"><table className="admin-table"><thead><tr><th>#</th><th>Artikal</th><th>JM</th><th>Raspoloživo</th><th>Količina / procjena</th><th>Nabavna cijena</th><th>Nabavna vrijednost</th><th>Kartica</th>{editable ? <th></th> : null}</tr></thead><tbody>{writeOff.stavke.map((line) => { const state = stateMap.get(line.artikal_id); return <tr key={line.id}><td>{line.redni_broj}</td><td><strong>{line.artikal.sifra}</strong><small className="table-secondary">{line.artikal.naziv}</small>{line.napomena ? <small className="table-secondary">{line.napomena}</small> : null}</td><td>{line.artikal.jedinica_mjere.oznaka}</td><td className="numeric-cell">{number(state?.kolicina ?? { toString: () => "0" }, 3)}</td><td>{editable ? <form action={updateInventoryWriteOffLine} className="table-actions"><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="otpis_id" value={writeOff.id} /><input type="hidden" name="stavka_id" value={line.id} /><input type="hidden" name="napomena_stavke" value={line.napomena ?? ""} /><input className="compact-input" name="kolicina" defaultValue={line.kolicina.toString()} inputMode="decimal" aria-label="Količina" /><input className="compact-input" name="procijenjena_cijena" defaultValue={line.procijenjena_nabavna_cijena?.toString() ?? ""} inputMode="decimal" placeholder="Procjena" aria-label="Procijenjena cijena" /><button className="secondary-button" type="submit">Sačuvaj</button></form> : `${number(line.kolicina, 3)} / ${number(line.procijenjena_nabavna_cijena, 4)}`}</td><td className="numeric-cell">{number(line.jedinicna_nabavna_cijena, 4)}</td><td className="numeric-cell">{number(line.nabavna_vrijednost)}</td><td><Link className="secondary-link" href={`/agencija/robno/kartica-artikla?artikal=${line.artikal_id}&magacin=${writeOff.magacin_id}`}>Otvori</Link></td>{editable ? <td><form action={deleteInventoryWriteOffLine}><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="otpis_id" value={writeOff.id} /><input type="hidden" name="stavka_id" value={line.id} /><button className="danger-link" type="submit">Obriši</button></form></td> : null}</tr>; })}</tbody></table></div> : <p className="empty-state">Još nema stavki.</p>}</section>
    {editable ? <section className="admin-panel"><div className="panel-header"><div><h3>Knjiženje otpisa</h3><p className="muted-text">Pri knjiženju se provjerava lager, razdužuju količina i sve vrijednosti zaliha, pa kreira nacrt naloga.</p></div><Link className="secondary-link" href="/agencija/robno/podesavanja">Konta otpisa</Link></div><div className="form-actions"><form action={postInventoryWriteOff}><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="otpis_id" value={writeOff.id} /><button className="primary-button" type="submit" disabled={!writeOff.stavke.length}>Proknjiži otpis</button></form><form action={deleteInventoryWriteOff}><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="otpis_id" value={writeOff.id} /><button className="danger-button" type="submit">Obriši nacrt</button></form></div></section> : writeOff.nalog ? <section className="admin-panel"><div className="panel-header"><div><h3>Računovodstveni nalog</h3><p className="muted-text">Otpis je proknjižen, a nalog troška i razduženja zaliha kreiran je kao nacrt.</p></div><Link className="secondary-button" href={`/agencija/nalozi/${writeOff.nalog.id}`}>Otvori {writeOff.nalog.sifra ?? "nalog"}</Link></div></section> : null}
  </div>;
}
