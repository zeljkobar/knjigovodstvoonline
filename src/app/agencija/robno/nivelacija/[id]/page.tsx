import Link from "next/link";
import { notFound } from "next/navigation";
import { inventoryPriceAdjustmentStatusLabel, inventoryPriceAdjustmentStatuses } from "@/lib/inventory-price-adjustment";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { getInventoryContext, InventoryAccessDenied, MissingInventoryContext } from "../../_shared";
import { addInventoryPriceAdjustmentLine, deleteInventoryPriceAdjustment, deleteInventoryPriceAdjustmentLine, postInventoryPriceAdjustment, refreshInventoryPriceAdjustmentSnapshot, updateInventoryPriceAdjustmentHeader, updateInventoryPriceAdjustmentLine } from "../actions";

const messages: Record<string, string> = {
  kreirana: "Nacrt nivelacije je otvoren. Dodajte artikle i nove cijene.",
  zaglavlje_sacuvano: "Podaci nivelacije su sačuvani.",
  stavka_dodata: "Artikal je dodat u nivelaciju.",
  stavka_sacuvana: "Nova cijena je sačuvana.",
  stavka_obrisana: "Stavka je obrisana.",
  stanje_osvjezeno: "Početne vrijednosti stavki osvježene su iz trenutnog lagera.",
  stavka: "Izaberite artikal i unesite pozitivnu novu maloprodajnu cijenu.",
  artikal: "Izabrani artikal nije dostupan.",
  dupli_artikal: "Artikal je već dodat u ovu nivelaciju.",
  bez_stanja: "Nivelacija je moguća samo za artikal sa pozitivnim stanjem u izabranom magacinu.",
  neispravan_lager: "Lager nema staru maloprodajnu vrijednost ili njegove vrijednosti nijesu usklađene.",
  bez_promjene: "Nova cijena mora se razlikovati od postojeće cijene na lageru.",
  bez_stavki: "Dodajte najmanje jednu stavku.",
  nije_nacrt: "Mijenjati i knjižiti se može samo aktivan nacrt.",
  obavezna_polja: "Unesite datum nivelacije.",
  datum_van_godine: "Datum nivelacije mora biti unutar poslovne godine.",
  magacin: "Nivelacija je dostupna samo za maloprodajni magacin.",
  podesavanja: "Prvo podesite konta nivelacije u Robno → Podešavanja.",
  smjer: "Smjerovi knjiženja nivelacije nijesu ispravni.",
  konto: "Izabrano konto nivelacije nije dostupno ili zahtijeva partnera.",
  neizbalansiran: "Obračun nivelacije nije izbalansiran. Provjerite početne vrijednosti lagera.",
  vrsta_naloga: "Sistemska vrsta naloga Nivelacija cijena nije dostupna.",
  zakljucana_godina: "Poslovna godina je zaključana.",
  prava: "Nemate pravo za ovu akciju."
};

function number(value: { toString(): string } | null, digits = 2) {
  if (value === null) return "—";
  return Number(value.toString()).toLocaleString("sr-Latn-ME", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function signed(value: { toString(): string }) {
  const amount = Number(value.toString());
  return `${amount > 0 ? "+" : ""}${amount.toLocaleString("sr-Latn-ME", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function InventoryPriceAdjustmentDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ poruka?: string }> }) {
  const [{ id }, { poruka }, rawContext, work] = await Promise.all([params, searchParams, getInventoryContext("view"), readWorkContext()]);
  if (!rawContext.firma || !work.poslovnaGodinaId) return <MissingInventoryContext title="Nivelacija cijena" />;
  if (!rawContext.allowed) return <InventoryAccessDenied title="Nivelacija cijena" />;
  const context = rawContext as typeof rawContext & { firma: NonNullable<typeof rawContext.firma> };
  const adjustment = await prisma.nivelacijaCijena.findFirst({ where: { id, agencija_id: context.user.agencija_id!, firma_id: context.firma.id, poslovna_godina_id: work.poslovnaGodinaId, is_deleted: false }, include: { poslovna_godina: { select: { godina: true, datum_od: true, datum_do: true, zakljucena: true } }, magacin: { include: { poslovna_jedinica: { select: { sifra: true, naziv: true } } } }, nalog: { select: { id: true, sifra: true, status: true } }, stavke: { include: { artikal: { include: { jedinica_mjere: true } } }, orderBy: { redni_broj: "asc" } } } });
  if (!adjustment) notFound();
  const states = await prisma.stanjeZaliha.findMany({ where: { firma_id: context.firma.id, poslovna_godina_id: work.poslovnaGodinaId, magacin_id: adjustment.magacin_id, kolicina: { gt: 0 }, artikal: { aktivan: true, is_deleted: false, usluga: false, prati_zalihe: true } }, include: { artikal: { include: { jedinica_mjere: true } } }, orderBy: { artikal: { sifra: "asc" } } });
  const editable = adjustment.status === inventoryPriceAdjustmentStatuses.draft && !adjustment.poslovna_godina.zakljucena;
  const draftRetail = adjustment.stavke.reduce((sum, line) => sum + Number(line.promjena_maloprodajne_vrijednosti), 0);
  const draftMargin = adjustment.stavke.reduce((sum, line) => sum + Number(line.promjena_razlike_u_cijeni), 0);
  const draftVat = adjustment.stavke.reduce((sum, line) => sum + Number(line.promjena_ukalkulisanog_pdv), 0);
  const totals = adjustment.status === inventoryPriceAdjustmentStatuses.posted ? { retail: adjustment.ukupna_promjena_maloprodajne_vrijednosti, margin: adjustment.ukupna_promjena_razlike_u_cijeni, vat: adjustment.ukupna_promjena_ukalkulisanog_pdv } : { retail: { toString: () => String(draftRetail) }, margin: { toString: () => String(draftMargin) }, vat: { toString: () => String(draftVat) } };
  const dynamicMessage = poruka?.startsWith("proknjizena:") ? `Nivelacija je proknjižena, cjenovnik i lager su ažurirani i kreiran je nacrt naloga ${poruka.split(":")[1] ?? ""}.` : poruka?.startsWith("stanje_promijenjeno:") ? `Lager artikla ${poruka.split(":")[1] ?? ""} promijenjen je nakon dodavanja u nivelaciju. Osvježite početne vrijednosti i ponovo provjerite obračun.` : poruka?.startsWith("neispravan_lager:") ? `Vrijednosti lagera artikla ${poruka.split(":")[1] ?? ""} nijesu usklađene za nivelaciju.` : poruka?.startsWith("bez_promjene:") ? `Nova cijena artikla ${poruka.split(":")[1] ?? ""} ne mijenja njegovu maloprodajnu vrijednost.` : poruka ? messages[poruka] ?? poruka : null;

  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Robno / Promet robe / Nivelacija</p><h2>{adjustment.interni_broj}</h2><p className="muted-text">{adjustment.magacin.sifra} · {adjustment.magacin.naziv}</p></div><div className="header-actions"><span className={`status-badge status-${adjustment.status.toLowerCase()}`}>{inventoryPriceAdjustmentStatusLabel(adjustment.status)}</span><Link className="secondary-button" href={`/stampa/robno/nivelacija/${adjustment.id}`} target="_blank">Štampa</Link><Link className="secondary-button" href="/agencija/robno/nivelacija">Nazad</Link></div></header>
    {dynamicMessage ? <p className="admin-message">{dynamicMessage}</p> : null}
    <section className="metric-grid"><article className="metric"><span>Stavki</span><strong>{adjustment.stavke.length}</strong></article><article className="metric"><span>Promjena MP vrijednosti</span><strong>{signed(totals.retail)} €</strong></article><article className="metric"><span>Promjena RUC-a</span><strong>{signed(totals.margin)} €</strong></article><article className="metric"><span>Promjena PDV-a</span><strong>{signed(totals.vat)} €</strong></article></section>
    <section className="admin-panel"><div className="panel-header"><div><h3>Podaci nivelacije</h3><p className="muted-text">Magacin i poslovna jedinica ostaju vezani za dokument od trenutka otvaranja.</p></div><span>{adjustment.magacin.poslovna_jedinica ? `${adjustment.magacin.poslovna_jedinica.sifra} · ${adjustment.magacin.poslovna_jedinica.naziv}` : "Bez poslovne jedinice"}</span></div>{editable ? <form action={updateInventoryPriceAdjustmentHeader} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="nivelacija_id" value={adjustment.id} /><label><span>Datum</span><input type="date" name="datum" defaultValue={adjustment.datum.toISOString().slice(0, 10)} min={adjustment.poslovna_godina.datum_od.toISOString().slice(0, 10)} max={adjustment.poslovna_godina.datum_do.toISOString().slice(0, 10)} required /></label><label className="form-wide"><span>Napomena</span><input name="napomena" defaultValue={adjustment.napomena ?? ""} /></label><div className="form-actions form-wide"><button className="secondary-button" type="submit">Sačuvaj podatke</button></div></form> : <div className="invoice-summary-grid"><span>Datum <strong>{adjustment.datum.toLocaleDateString("sr-Latn-ME")}</strong></span><span>Napomena <strong>{adjustment.napomena ?? "-"}</strong></span><span>Nalog <strong>{adjustment.nalog?.sifra ?? "-"}</strong></span></div>}</section>
    {editable ? <section className="admin-form-section"><div className="panel-header"><div><h3>Dodaj artikal</h3><p className="muted-text">Prikazani su samo artikli sa pozitivnim stanjem u ovom maloprodajnom magacinu.</p></div><span>{states.length} artikala na stanju</span></div><form action={addInventoryPriceAdjustmentLine} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="nivelacija_id" value={adjustment.id} /><label className="form-wide"><span>Artikal</span><select name="artikal_id" required><option value="">Izaberite artikal</option>{states.map((state) => <option key={state.artikal_id} value={state.artikal_id}>{state.artikal.sifra} · {state.artikal.naziv} — {state.kolicina.toString()} {state.artikal.jedinica_mjere.oznaka}</option>)}</select></label><label><span>Nova MPC sa PDV-om</span><input name="nova_cijena" inputMode="decimal" placeholder="0,00" required /></label><div className="form-actions"><button className="primary-button" type="submit">Dodaj stavku</button></div></form></section> : null}
    <section className="admin-panel"><div className="panel-header"><div><h3>Stavke nivelacije</h3><p className="muted-text">Količina i nabavna vrijednost ostaju iste; mijenjaju se samo MP vrijednost, RUC i ukalkulisani PDV.</p></div><span>{adjustment.stavke.length} stavki</span></div>{adjustment.stavke.length ? <div className="table-wrap"><table className="admin-table"><thead><tr><th>#</th><th>Artikal</th><th>Stanje</th><th>Stara MPC</th><th>Nova MPC</th><th>Δ MP vrijednost</th><th>Δ RUC</th><th>Δ PDV</th><th>Kartica</th>{editable ? <th></th> : null}</tr></thead><tbody>{adjustment.stavke.map((line) => <tr key={line.id}><td>{line.redni_broj}</td><td><strong>{line.artikal.sifra}</strong><small className="table-secondary">{line.artikal.naziv}</small></td><td className="numeric-cell">{number(line.knjigovodstvena_kolicina, 3)} {line.artikal.jedinica_mjere.oznaka}</td><td className="numeric-cell">{number(line.stara_prodajna_cijena_sa_pdv)}</td><td>{editable ? <form action={updateInventoryPriceAdjustmentLine} className="table-actions"><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="nivelacija_id" value={adjustment.id} /><input type="hidden" name="stavka_id" value={line.id} /><input className="compact-input" name="nova_cijena" defaultValue={line.nova_prodajna_cijena_sa_pdv.toString()} inputMode="decimal" /><button className="secondary-button" type="submit">Sačuvaj</button></form> : number(line.nova_prodajna_cijena_sa_pdv)}</td><td className="numeric-cell">{signed(line.promjena_maloprodajne_vrijednosti)}</td><td className="numeric-cell">{signed(line.promjena_razlike_u_cijeni)}</td><td className="numeric-cell">{signed(line.promjena_ukalkulisanog_pdv)}</td><td><Link className="secondary-link" href={`/agencija/robno/kartica-artikla?artikal=${line.artikal_id}&magacin=${adjustment.magacin_id}`}>Otvori</Link></td>{editable ? <td><form action={deleteInventoryPriceAdjustmentLine}><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="nivelacija_id" value={adjustment.id} /><input type="hidden" name="stavka_id" value={line.id} /><button className="danger-link" type="submit">Obriši</button></form></td> : null}</tr>)}</tbody></table></div> : <p className="empty-state">Još nema stavki.</p>}</section>
    {editable ? <section className="admin-panel"><div className="panel-header"><div><h3>Knjiženje nivelacije</h3><p className="muted-text">Sistem ponovo provjerava početne vrijednosti, zatim ažurira lager i cjenovnik i kreira nacrt naloga.</p></div><Link className="secondary-link" href="/agencija/robno/podesavanja">Konta nivelacije</Link></div><div className="form-actions"><form action={postInventoryPriceAdjustment}><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="nivelacija_id" value={adjustment.id} /><button className="primary-button" type="submit" disabled={!adjustment.stavke.length}>Proknjiži nivelaciju</button></form><form action={refreshInventoryPriceAdjustmentSnapshot}><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="nivelacija_id" value={adjustment.id} /><button className="secondary-button" type="submit" disabled={!adjustment.stavke.length}>Osvježi početne vrijednosti</button></form><form action={deleteInventoryPriceAdjustment}><input type="hidden" name="firma_id" value={context.firma.id} /><input type="hidden" name="nivelacija_id" value={adjustment.id} /><button className="danger-button" type="submit">Obriši nacrt</button></form></div></section> : adjustment.nalog ? <section className="admin-panel"><div className="panel-header"><div><h3>Računovodstveni nalog</h3><p className="muted-text">Lager i cjenovnik su ažurirani, a nalog nivelacije kreiran je kao nacrt.</p></div><Link className="secondary-button" href={`/agencija/nalozi/${adjustment.nalog.id}`}>Otvori {adjustment.nalog.sifra ?? "nalog"}</Link></div></section> : null}
  </div>;
}
