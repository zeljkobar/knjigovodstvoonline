import { ItemSearchSelect } from "@/components/ItemSearchSelect";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hasAllPermissions, hasPermission } from "@/lib/permissions";
import { supplierReturnStatus, supplierReturnPreview } from "@/lib/supplier-return";
import { scaledToDecimal } from "@/lib/inventory-calculation";
import { InventoryAccessDenied, MissingInventoryContext } from "../../_shared";
import { ReturnHeaderForm, ReturnHidden, returnMoney, returnView } from "../_shared";
import { deleteSupplierReturn, postSupplierReturnAction, saveSupplierReturnLine } from "../actions";

export default async function SupplierReturnDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ poruka?: string; greska?: string }> }) {
  const [{ id }, query, ctx] = await Promise.all([params, searchParams, returnView()]);
  if (!ctx.firma || !ctx.year) return <MissingInventoryContext title="Povrat dobavljaču — izaberite firmu i godinu" />;
  if (!ctx.allowed) return <InventoryAccessDenied title="Povrat dobavljaču" />;
  const doc = await prisma.povratDobavljacu.findFirst({ where: { id, firma_id: ctx.firma.id, agencija_id: ctx.user.agencija_id!, poslovna_godina_id: ctx.year.id, is_deleted: false }, include: { dobavljac: true, magacin: true, kalkulacija: true, originalni_kuf: true, kuf_book: true, nalog: true, stavke: { include: { artikal: { include: { jedinica_mjere: true } }, pdv_stopa: true, stavka_kalkulacije: true }, orderBy: { redni_broj: "asc" } } } });
  if (!doc) notFound();
  const period = await prisma.pdvPeriod.findFirst({ where: { firma_id: ctx.firma.id, status: "LOCKED", datum_od: { lte: doc.datum }, datum_do: { gte: doc.datum } } });
  const unlocked = !ctx.year.zakljucena && !period && doc.status === "DRAFT";
  const editable = unlocked && await hasPermission(ctx.user, { firmaId: ctx.firma.id, modul: "robno", akcija: "update" });
  const canDelete = unlocked && await hasPermission(ctx.user, { firmaId: ctx.firma.id, modul: "robno", akcija: "delete" });
  const canPost = unlocked && await hasAllPermissions(ctx.user, [{ firmaId: ctx.firma.id, modul: "robno", akcija: "post" }, { firmaId: ctx.firma.id, modul: "nalozi", akcija: "create" }, { firmaId: ctx.firma.id, modul: "nalozi", akcija: "post" }, { firmaId: ctx.firma.id, modul: "ulazni_racuni", akcija: "create" }]);
  const canPrint = await hasPermission(ctx.user, { firmaId: ctx.firma.id, modul: "robno", akcija: "export" });
  const [items, rates, sourceLines] = editable ? await Promise.all([
    prisma.artikal.findMany({ where: { firma_id: ctx.firma.id, agencija_id: ctx.user.agencija_id!, aktivan: true, is_deleted: false, usluga: false, prati_zalihe: true }, orderBy: { sifra: "asc" } }),
    prisma.pdvStopa.findMany({ where: { agencija_id: ctx.user.agencija_id!, aktivna: true }, orderBy: { redosljed: "asc" } }),
    doc.kalkulacija_id ? prisma.stavkaKalkulacije.findMany({ where: { kalkulacija_id: doc.kalkulacija_id }, include: { artikal: { select: { sifra: true, naziv: true } } }, orderBy: { redni_broj: "asc" } }) : Promise.resolve([])
  ]) : [[], [], []];
  const hidden = <ReturnHidden companyId={ctx.firma.id} yearId={ctx.year.id} documentId={doc.id} />;
  const lineFeedback = query.greska ? <p role="alert" className="admin-message">{query.greska}</p> : ["Stavka je sačuvana.", "Nacrt ili stavka je obrisana."].includes(query.poruka ?? "") ? <p role="status" className="admin-message">{query.poruka}</p> : null;
  const preview = supplierReturnPreview(doc.stavke);
  const previewMoney = (amount: bigint) => returnMoney(scaledToDecimal(amount, 2));
  function lineForm(line?: NonNullable<typeof doc>["stavke"][number]) {
    return <form action={saveSupplierReturnLine} className="admin-form">
      {hidden}{line ? <input type="hidden" name="stavka_id" value={line.id} /> : null}
      <label><span>Artikal</span><ItemSearchSelect name="artikal_id" defaultValue={line?.artikal_id ?? ""} required><option value="">Izaberite robu</option>{items.map(a => <option key={a.id} value={a.id}>{a.sifra} · {a.naziv}</option>)}</ItemSearchSelect></label>
      <label><span>Količina</span><input name="kolicina" inputMode="decimal" defaultValue={line?.kolicina.toString()} placeholder="0,000" required /></label>
      <label><span>Cijena odobrenja bez PDV-a</span><input name="cijena_odobrenja" inputMode="decimal" defaultValue={line?.cijena_odobrenja.toString()} placeholder="0,0000" required /></label>
      <label><span>Ulazna PDV stopa</span><select name="pdv_stopa_id" defaultValue={line?.pdv_stopa_id ?? ""} required><option value="">Izaberite stopu</option>{rates.map(r => <option key={r.id} value={r.id}>{r.naziv} · {r.procenat.toString()}%</option>)}</select></label>
      {sourceLines.length ? <label className="form-wide"><span>Izvorna stavka kalkulacije (opciono)</span><select name="stavka_kalkulacije_id" defaultValue={line?.stavka_kalkulacije_id ?? ""}><option value="">Bez veze sa stavkom</option>{sourceLines.map(s => <option key={s.id} value={s.id}>{s.artikal.sifra} · {s.artikal.naziv} · {s.kolicina.toString()} po {s.neto_fakturna_cijena.toString()} €</option>)}</select></label> : null}
      <div className="form-actions form-wide"><button className="secondary-button" type="submit">{line ? "Sačuvaj stavku" : "Dodaj stavku"}</button></div>
    </form>;
  }
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Robno / Nabavka / Povrat dobavljaču</p><h2>{doc.interni_broj}</h2><p className="muted-text">{supplierReturnStatus(doc.status)} · {doc.dobavljac.naziv} · {doc.magacin.naziv}</p></div><div className="table-actions"><Link className="secondary-button" href="/agencija/robno/povrat-dobavljacu">Svi povrati</Link>{canPrint ? <Link className="secondary-button" href={`/stampa/robno/povrat-dobavljacu/${doc.id}`}>Štampa</Link> : null}</div></header>
    {query.greska ? <p role="alert" className="admin-message">{query.greska}</p> : query.poruka ? <p role="status" className="admin-message">{query.poruka}</p> : null}
    {period || ctx.year.zakljucena ? <p className="admin-message">Godina ili PDV period je zaključan. Izmjene nijesu dozvoljene.</p> : null}
    <section className="admin-panel"><h3>Zaglavlje</h3>{editable ? <ReturnHeaderForm companyId={ctx.firma.id} agencyId={ctx.user.agencija_id!} yearId={ctx.year.id} defaultDate={doc.datum.toISOString().slice(0, 10)} document={doc} /> : <div className="invoice-summary-grid"><span>Datum <strong>{doc.datum.toLocaleDateString("sr-Latn-ME")}</strong></span><span>Odobrenje <strong>{doc.broj_odobrenja}</strong></span><span>KUF knjiga <strong>{doc.kuf_book?.internal_kuf_number ?? "—"}</strong></span><span>Napomena <strong>{doc.napomena ?? "—"}</strong></span></div>}
      {doc.kalkulacija ? <p>Izvor: <Link href={`/agencija/robno/kalkulacije/${doc.kalkulacija.id}`}>{doc.kalkulacija.interni_broj}</Link></p> : null}
      {doc.originalni_kuf ? <p>Izvorni račun: {doc.originalni_kuf.internal_kuf_number} · {doc.originalni_kuf.supplier_invoice_number}</p> : null}
    </section>
    {editable ? <section id="dodaj-robu" className="admin-panel" style={{ scrollMarginTop: 18 }}><h3>Dodaj robu</h3>{lineFeedback}<p className="admin-hint">Unesite pozitivnu količinu i cijenu iz odobrenja dobavljača. Lager se vrednuje po prosječnoj nabavnoj cijeni; razlika prema odobrenju knjiži se zasebno.</p>{lineForm()}</section> : null}
    <section id="stavke" className="admin-panel" style={{ scrollMarginTop: 18 }}><h3>Stavke</h3>{lineFeedback}<div className="table-wrap"><table className="admin-table"><thead><tr><th>Artikal</th><th>Količina</th><th>Cijena odobrenja</th><th>PDV</th><th>Nabavna vrijednost</th><th>MP vrijednost</th><th>Veza</th></tr></thead><tbody>{doc.stavke.map(l => <tr key={l.id}><td>{l.artikal.sifra} · {l.artikal.naziv}</td><td>{l.kolicina.toString()} {l.artikal.jedinica_mjere.oznaka}</td><td>{l.cijena_odobrenja.toString()} €</td><td>{l.pdv_procenat.toString()}%</td><td>{doc.status === "DRAFT" ? "Pri knjiženju" : `${returnMoney(l.nabavna_vrijednost)} €`}</td><td>{doc.status === "DRAFT" ? "Pri knjiženju" : `${returnMoney(l.maloprodajna_vrijednost)} €`}</td><td>{l.stavka_kalkulacije ? `Stavka ${l.stavka_kalkulacije.redni_broj}` : "—"}</td></tr>)}</tbody></table></div>{!doc.stavke.length ? <p className="empty-state">Nema stavki.</p> : null}
      {editable ? doc.stavke.map(l => <details key={l.id}><summary>Izmijeni {l.artikal.sifra} · {l.artikal.naziv}</summary>{lineForm(l)}<form action={deleteSupplierReturn}>{hidden}<input type="hidden" name="stavka_id" value={l.id} /><button type="submit" className="danger-button">Ukloni stavku</button></form></details>) : null}
    </section>
    {doc.status === "POSTED" ? <section className="admin-panel"><h3>Knjiženje</h3><div className="invoice-summary-grid"><span>Osnovica <strong>{returnMoney(doc.ukupna_osnovica)} €</strong></span><span>Ulazni PDV <strong>{returnMoney(doc.ukupni_ulazni_pdv)} €</strong></span><span>Smanjenje obaveze <strong>{returnMoney(doc.ukupno_odobrenje)} €</strong></span><span>Nabavna vrijednost robe <strong>{returnMoney(doc.ukupna_nabavna_vrijednost)} €</strong></span></div>{doc.nalog ? <p><Link href={`/agencija/nalozi/${doc.nalog.id}`}>Nalog {doc.nalog.sifra}</Link></p> : null}{doc.kuf_book_id ? <p><Link href={`/agencija/racuni/kuf/${doc.kuf_book_id}`}>Negativan KUF zapis</Link></p> : null}<p className="admin-hint">Proknjižen povrat je zaključan. Originalna kalkulacija i račun ostaju sačuvani.</p></section> : null}
    {doc.status === "DRAFT" ? <section className="admin-panel"><h3>Pregled odobrenja</h3><div className="invoice-summary-grid"><span>Osnovica <strong>{previewMoney(preview.base)} €</strong></span><span>Ulazni PDV <strong>{previewMoney(preview.vat)} €</strong></span><span>Smanjenje obaveze <strong>{previewMoney(preview.gross)} €</strong></span></div><p className="admin-hint">Nabavna i maloprodajna vrijednost razduženja obračunavaju se iz lagera pri knjiženju.</p></section> : null}
    {canPost ? <section className="admin-panel"><h3>Proknjiži povrat</h3><p>Knjiženje smanjuje lager i obavezu prema dobavljaču, pravi proknjižen nalog i negativan KUF zapis. Nacrt ne mijenja evidencije.</p><form action={postSupplierReturnAction}>{hidden}<label><input type="checkbox" name="potvrda" required /> Potvrđujem povrat robe, nalog i korekciju KUF-a</label><div className="form-actions"><button className="primary-button" type="submit">Proknjiži povrat</button></div></form></section> : null}
    {canDelete ? <section className="admin-panel"><form action={deleteSupplierReturn}>{hidden}<label><input type="checkbox" name="potvrda" required /> Potvrđujem brisanje nacrta</label><button className="danger-button" type="submit">Obriši nacrt</button></form></section> : null}
  </div>;
}
