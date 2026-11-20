import { readFiscalContext } from "@/lib/fiscal-context-snapshot";
import Link from "next/link";
import type { loadFiscalReportDetail } from "@/lib/fiscal-report-detail";
import { decimalToScaled } from "@/lib/inventory-calculation";
import { posMoney } from "@/lib/pos-reports";
import { directPortalReportPaymentLabels } from "@/lib/direct-portal-reports";
import styles from "./report.module.css";

function snapshot(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "—";
  const item = (value as Record<string, unknown>)[key];
  return typeof item === "string" && item ? item : "—";
}
export function ReportDetail({ invoice, closeHref }: { invoice: NonNullable<Awaited<ReturnType<typeof loadFiscalReportDetail>>>; closeHref: string }) {
  const fiscalContext = readFiscalContext(invoice.fiscal_context_snapshot, invoice);
  const money = (value: { toString(): string }) => posMoney(decimalToScaled(value, 2));
  return <aside className={`admin-panel ${styles.detail}`} aria-label="Detalj izabranog računa" id="detalj-racuna">
    <div className="panel-header"><h3>{invoice.official_invoice_number ?? invoice.interni_broj}</h3><Link className="secondary-button" href={closeHref} scroll={false}>Zatvori pregled</Link></div>
    <div className={styles.identity}>
      <p>{invoice.fiscal_environment === "Test" ? "TEST" : "Produkcija"} · {invoice.fiscal_status} · {invoice.issued_at?.toLocaleString("sr-Latn-ME", { timeZone: "Europe/Podgorica" })}</p>
      <p>Izdavalac: <strong>{snapshot(invoice.issuer_snapshot, "naziv")}</strong> · PIB {snapshot(invoice.issuer_snapshot, "pib")}</p>
      <p>Kupac: <strong>{snapshot(invoice.buyer_snapshot, "naziv")}</strong> · PIB {snapshot(invoice.buyer_snapshot, "pib")}</p>
      <p>Interni broj: {invoice.interni_broj} · POS kasa: {invoice.pos_register ? `${invoice.pos_register.sifra} · ${invoice.pos_register.naziv}` : "Nije POS kasa"}</p>
      <p>Istorijski ENU: {fiscalContext?.deviceCode ?? "Nije evidentiran"} · Poslovna jedinica: {fiscalContext?.businessUnitCode ?? "Nije evidentirana"} · Operater: {fiscalContext?.operatorCode ?? "Nije evidentiran"}</p>
      <p>IKOF: {invoice.iic ?? "—"}<br/>JIKR: {invoice.jikr ?? "—"}</p>
      {invoice.original_invoice_id ? <p>Korekcija ranije izdatog računa<br/>{invoice.correction_reason}</p> : null}
    </div>
    <h4>Stavke izdatog računa</h4><div className="table-wrap"><table><thead><tr><th>Stavka</th><th>Količina</th><th>PDV stopa</th><th>Ukupno</th></tr></thead><tbody>{invoice.stavke.map(line => <tr key={line.id}><td>{line.sifra_artikla} · {line.naziv_artikla}</td><td>{line.kolicina.toString()} {line.jedinica_mjere}</td><td>{line.pdv_stopa_procenat.toString()}%</td><td>{money(line.ukupno_sa_pdv)} €</td></tr>)}</tbody></table></div>
    <p>Osnovica: <strong>{money(invoice.ukupno_osnovica)} €</strong><br/>PDV: <strong>{money(invoice.ukupno_izlazni_pdv)} €</strong><br/>Ukupno: <strong>{money(invoice.ukupno_sa_pdv)} €</strong></p>
    <h4>Načini plaćanja na računu</h4>{invoice.placanja.length ? invoice.placanja.map(payment => <p key={payment.id}>{directPortalReportPaymentLabels[payment.payment_method] ?? payment.payment_method}: {money(payment.amount)} €</p>) : <p>Nema zasebnih redova plaćanja.</p>}
    <p className="muted-text">Pregled koristi sačuvane podatke dokumenta. Ne pokreće fiskalizaciju. Oznaka plaćanja ne potvrđuje uplatu.</p>
  </aside>;
}
