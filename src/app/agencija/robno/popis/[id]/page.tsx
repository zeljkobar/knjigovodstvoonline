import Link from "next/link";
import { notFound } from "next/navigation";
import { inventoryCountStatusLabel, inventoryCountStatuses } from "@/lib/inventory-count";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { getInventoryContext, InventoryAccessDenied, MissingInventoryContext } from "../../_shared";
import { deleteInventoryCount, fillInventoryCountBookQuantities, postInventoryCount, refreshInventoryCountSnapshot, updateInventoryCountHeader, updateInventoryCountLine } from "../actions";

const messages: Record<string, string> = {
  kreiran: "Popis je otvoren sa trenutnim knjigovodstvenim stanjem. Unesite stvarne količine.",
  postoji_nacrt: "Za ovaj magacin već postoji otvoren nacrt pa je prikazan postojeći popis.",
  zaglavlje_sacuvano: "Podaci popisa su sačuvani.",
  stavka_sacuvana: "Stvarno stanje artikla je sačuvano.",
  popunjeno: "Sva prazna stvarna stanja prepisana su iz knjigovodstvenog stanja.",
  stanje_osvjezeno: "Knjigovodstveno stanje je osvježeno. Provjerite ponovo razlike.",
  zakljucen_bez_razlike: "Popis je zaključen bez utvrđenog viška ili manjka.",
  nepopunjeno: "Unesite stvarno stanje za svaki artikal. Dugme za prepisivanje popunjava sve prazne redove.",
  kolicina: "Stvarna količina i ručna cijena moraju biti ispravni nenegativni brojevi.",
  cijena_viska: "Za višak bez prosječne nabavne cijene unesite ručnu nabavnu cijenu.",
  podesavanja: "Prvo podesite konta popisa u Robno → Podešavanja.",
  smjer: "Smjerovi knjiženja popisa nijesu ispravni.",
  konto: "Izabrano konto nije dostupno ili zahtijeva partnera.",
  konto_prihoda: "Konto prihoda od viška mora počinjati sa 6.",
  konto_troska: "Konto troška manjka mora počinjati sa 5.",
  vrsta_naloga: "Sistemska vrsta naloga Popis robe nije dostupna.",
  nije_nacrt: "Mijenjati i knjižiti se može samo aktivan nacrt.",
  datum_van_godine: "Datum popisa mora biti unutar poslovne godine.",
  zakljucana_godina: "Poslovna godina je zaključana.",
  prava: "Nemate pravo za ovu akciju."
};

function number(value: { toString(): string } | null, digits = 2) {
  if (value === null) return "—";
  return Number(value.toString()).toLocaleString("sr-Latn-ME", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export default async function InventoryCountDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ poruka?: string }> }) {
  const [{ id }, { poruka }, rawContext, work] = await Promise.all([params, searchParams, getInventoryContext("view"), readWorkContext()]);
  if (!rawContext.firma || !work.poslovnaGodinaId) return <MissingInventoryContext title="Popis robe" />;
  if (!rawContext.allowed) return <InventoryAccessDenied title="Popis robe" />;
  const context = rawContext as typeof rawContext & { firma: NonNullable<typeof rawContext.firma> };
  const count = await prisma.popisRobe.findFirst({ where: { id, agencija_id: context.user.agencija_id!, firma_id: context.firma.id, poslovna_godina_id: work.poslovnaGodinaId, is_deleted: false }, include: { poslovna_godina: { select: { godina: true, datum_od: true, datum_do: true, zakljucena: true } }, magacin: { include: { poslovna_jedinica: { select: { sifra: true, naziv: true } } } }, nalog: { select: { id: true, sifra: true, status: true } }, stavke: { include: { artikal: { include: { jedinica_mjere: true } } }, orderBy: { redni_broj: "asc" } } } });
  if (!count) notFound();
  const editable = count.status === inventoryCountStatuses.draft && !count.poslovna_godina.zakljucena;
  const entered = count.stavke.filter((line) => line.stvarna_kolicina !== null).length;
  const differences = count.stavke.filter((line) => Number(line.razlika_kolicina) !== 0);
  const surplus = differences.filter((line) => Number(line.razlika_kolicina) > 0).reduce((sum, line) => sum + Number(line.nabavna_vrijednost_razlike), 0);
  const shortage = differences.filter((line) => Number(line.razlika_kolicina) < 0).reduce((sum, line) => sum + Number(line.nabavna_vrijednost_razlike), 0);
  const dynamicMessage = poruka?.startsWith("proknjizen:") ? `Popis je proknjižen, lager je korigovan i kreiran je nacrt naloga ${poruka.split(":")[1] ?? ""}.` : poruka?.startsWith("stanje_promijenjeno:") ? `Lager artikla ${poruka.split(":")[1] ?? ""} promijenjen je poslije otvaranja popisa. Osvježite knjigovodstveno stanje i provjerite razlike.` : poruka?.startsWith("cijena_viska:") ? `Za višak artikla ${poruka.split(":")[1] ?? ""} unesite ručnu nabavnu cijenu.` : poruka ? messages[poruka] ?? poruka : null;
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Robno / Promet robe / Popis</p><h2>{count.interni_broj}</h2><p className="muted-text">{count.magacin.sifra} · {count.magacin.naziv}</p></div><div className="header-actions"><span className={`status-badge status-${count.status.toLowerCase()}`}>{inventoryCountStatusLabel(count.status)}</span><Link className="secondary-button" href={`/stampa/robno/popis/${count.id}`} target="_blank">Štampa</Link><Link className="secondary-button" href="/agencija/robno/popis">Nazad</Link></div></header>
    {dynamicMessage ? <p className="admin-message">{dynamicMessage}</p> : null}
    <section className="metric-grid"><article className="metric"><span>Uneseno</span><strong>{entered} / {count.stavke.length}</strong></article><article className="metric"><span>Višak</span><strong>{surplus.toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2 })} €</strong></article><article className="metric"><span>Manjak</span><strong>{shortage.toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2 })} €</strong></article><article className="metric"><span>Nalog</span><strong>{count.nalog?.sifra ?? "-"}</strong></article></section>
    <section className="admin-panel"><div className="panel-header"><div><h3>Podaci popisa</h3><p className="muted-text">Magacin se ne mijenja jer je stanje snimljeno u trenutku otvaranja dokumenta.</p></div><span>{count.magacin.poslovna_jedinica ? `${count.magacin.poslovna_jedinica.sifra} · ${count.magacin.poslovna_jedinica.naziv}` : "Bez poslovne jedinice"}</span></div>{editable ? <form action={updateInventoryCountHeader} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="popis_id" value={count.id} /><label><span>Datum</span><input type="date" name="datum" defaultValue={count.datum.toISOString().slice(0, 10)} min={count.poslovna_godina.datum_od.toISOString().slice(0, 10)} max={count.poslovna_godina.datum_do.toISOString().slice(0, 10)} required /></label><label className="form-wide"><span>Napomena</span><input name="napomena" defaultValue={count.napomena ?? ""} /></label><div className="form-actions form-wide"><button className="secondary-button" type="submit">Sačuvaj podatke</button></div></form> : <div className="invoice-summary-grid"><span>Datum <strong>{count.datum.toLocaleDateString("sr-Latn-ME")}</strong></span><span>Napomena <strong>{count.napomena ?? "-"}</strong></span></div>}</section>
    {editable ? <section className="admin-panel"><div className="panel-header"><div><h3>Brzi unos</h3><p className="muted-text">Prepišite sva prazna stanja, pa izmijenite samo artikle kod kojih je fizički utvrđena razlika.</p></div></div><div className="form-actions"><form action={fillInventoryCountBookQuantities}><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="popis_id" value={count.id} /><button className="primary-button" type="submit">Prepiši knjigovodstveno u prazna polja</button></form><form action={refreshInventoryCountSnapshot}><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="popis_id" value={count.id} /><button className="secondary-button" type="submit">Osvježi knjigovodstveno stanje</button></form></div></section> : null}
    <section className="admin-panel"><div className="panel-header"><div><h3>Popisne stavke</h3><p className="muted-text">Pozitivna razlika je višak, negativna je manjak. Ručna cijena koristi se samo za višak koji nema prosječnu cijenu.</p></div><span>{differences.length} razlika</span></div><div className="table-wrap"><table className="admin-table"><thead><tr><th>#</th><th>Artikal</th><th>JM</th><th>Knjigovodstveno</th><th>Stvarno</th><th>Razlika</th><th>Cijena viška</th><th>Vrijednost razlike</th>{editable ? <th></th> : null}</tr></thead><tbody>{count.stavke.map((line) => <tr key={line.id}><td>{line.redni_broj}</td><td><strong>{line.artikal.sifra}</strong><small className="table-secondary">{line.artikal.naziv}</small></td><td>{line.artikal.jedinica_mjere.oznaka}</td><td className="numeric-cell">{number(line.knjigovodstvena_kolicina, 3)}</td>{editable ? <><td colSpan={4}><form action={updateInventoryCountLine} className="table-actions"><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="popis_id" value={count.id} /><input type="hidden" name="stavka_id" value={line.id} /><input className="compact-input" name="stvarna_kolicina" defaultValue={line.stvarna_kolicina?.toString() ?? ""} placeholder="0,000" inputMode="decimal" required /><span className={Number(line.razlika_kolicina) > 0 ? "status-badge status-posted" : Number(line.razlika_kolicina) < 0 ? "status-badge status-deleted" : "status-badge"}>{number(line.razlika_kolicina, 3)}</span><input className="compact-input" name="rucna_cijena" defaultValue={line.rucna_nabavna_cijena_viska?.toString() ?? ""} placeholder={line.knjigovodstvena_prosjecna_nabavna_cijena.toString()} inputMode="decimal" /><strong>{number(line.nabavna_vrijednost_razlike)}</strong><button className="secondary-button" type="submit">Sačuvaj</button></form></td></> : <><td className="numeric-cell">{number(line.stvarna_kolicina, 3)}</td><td className="numeric-cell">{number(line.razlika_kolicina, 3)}</td><td className="numeric-cell">{number(line.rucna_nabavna_cijena_viska, 4)}</td><td className="numeric-cell">{number(line.nabavna_vrijednost_razlike)}</td></>}</tr>)}</tbody></table></div></section>
    {editable ? <section className="admin-panel"><div className="panel-header"><div><h3>Zaključenje popisa</h3><p className="muted-text">Pri knjiženju se ponovo provjerava da lager nije mijenjan nakon otvaranja popisa.</p></div><Link className="secondary-link" href="/agencija/robno/podesavanja">Konta popisa</Link></div><div className="form-actions"><form action={postInventoryCount}><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="popis_id" value={count.id} /><button className="primary-button" type="submit" disabled={entered !== count.stavke.length}>Zaključi i proknjiži popis</button></form><form action={deleteInventoryCount}><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="popis_id" value={count.id} /><button className="danger-button" type="submit">Obriši nacrt</button></form></div></section> : count.nalog ? <section className="admin-panel"><div className="panel-header"><div><h3>Računovodstveni nalog</h3><p className="muted-text">Lager je korigovan, a nalog je kreiran kao nacrt za kontrolu i knjiženje u glavnu knjigu.</p></div><Link className="secondary-button" href={`/agencija/nalozi/${count.nalog.id}`}>Otvori {count.nalog.sifra ?? "nalog"}</Link></div></section> : null}
  </div>;
}
