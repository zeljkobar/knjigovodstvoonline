import Link from "next/link";
import { loadClientPartnerCard, clientCents, clientDate } from "@/lib/client-partner-card";
import { formatInventoryMoney as money } from "@/app/agencija/_components/inventory-report-utils";
import { AutoSubmitFilterForm } from "@/components/AutoSubmitFilterForm";

export default async function ClientCard({ params, searchParams }: {
  params: Promise<{ tip: string }>;
  searchParams: Promise<{ partner?: string; datum_od?: string; datum_do?: string }>;
}) {
  const { tip } = await params;
  const query = await searchParams;
  const data = await loadClientPartnerCard(tip, query.partner ?? "");
  if (!data.configured) return <p className="admin-message">Agencija još nije podesila ovaj pregled. Obratite se svom knjigovođi.</p>;
  const from = clientDate(query.datum_od), to = clientDate(query.datum_do);
  if (from && to && from > to) return <p className="admin-message">Datum od mora biti prije datuma do. <Link href={`/klijent/izvjestaji/${tip}/kartica?partner=${query.partner}`}>Ukloni filter datuma</Link></p>;
  const opening = data.lines.filter((line) => from && line.nalog.datum < from).reduce((sum, line) => sum + clientCents(line.duguje) - clientCents(line.potrazuje), BigInt(0));
  let balance = opening, debit = BigInt(0), credit = BigInt(0);
  const rows = data.lines.filter((line) => (!from || line.nalog.datum >= from) && (!to || line.nalog.datum <= to)).map((line) => {
    debit += clientCents(line.duguje); credit += clientCents(line.potrazuje);
    balance += clientCents(line.duguje) - clientCents(line.potrazuje);
    return { ...line, balance };
  });
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">{data.config.label} / Analitička kartica</p><h1>{data.partner?.naziv}</h1><p>{data.context.firma.naziv} · {data.context.year.godina} · PIB partnera: {data.partner?.pib ?? "—"}</p></div><Link className="secondary-button" href={`/klijent/izvjestaji/${tip}`}>Nazad na pregled</Link></header>
    <section className="admin-panel"><AutoSubmitFilterForm action={`/klijent/izvjestaji/${tip}/kartica`} className="admin-form"><input type="hidden" name="partner" value={query.partner} /><label>Datum od<input name="datum_od" type="date" defaultValue={query.datum_od} /></label><label>Datum do<input name="datum_do" type="date" defaultValue={query.datum_do} /></label></AutoSubmitFilterForm></section>
    <section className="admin-panel"><p>Početni saldo prije perioda: <strong>{money(opening)}</strong></p><div className="table-wrap"><table className="admin-table"><thead><tr><th>Datum</th><th>Dokument</th><th>Opis</th><th>Valuta</th><th>Duguje</th><th>Potražuje</th><th>Saldo</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.nalog.datum.toLocaleDateString("sr-Latn-ME")}</td><td>{row.broj_dokumenta ?? "—"}</td><td>{[row.opis, row.dodatni_opis].filter(Boolean).join(" · ")}</td><td>{row.datum_valute?.toLocaleDateString("sr-Latn-ME") ?? "—"}</td><td>{money(clientCents(row.duguje))}</td><td>{money(clientCents(row.potrazuje))}</td><td>{money(row.balance)}</td></tr>)}{!rows.length ? <tr><td colSpan={7}>Nema prometa u izabranom periodu.</td></tr> : null}</tbody><tfoot><tr><th colSpan={4}>Ukupno</th><td>{money(debit)}</td><td>{money(credit)}</td><td>{money(balance)}</td></tr></tfoot></table></div></section>
  </div>;
}
