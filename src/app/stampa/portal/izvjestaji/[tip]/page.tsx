import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { auditLog } from "@/lib/audit";
import { formatPortalMoney } from "@/lib/direct-portal-dashboard";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import {
  directPortalReportChannelLabels,
  directPortalReportPaymentLabels,
  loadDirectPortalReport,
  parseDirectPortalReportFilters,
  parseDirectPortalReportKind,
  type DirectPortalReportSearchParams
} from "@/lib/direct-portal-reports";
import { posQuantity } from "@/lib/pos-reports";

const exportPermission = { modul: "izvjestaji", akcija: "export" };
const titles = {
  promet: "Neto promet",
  artikli: "Prodaja po artiklu i količini",
  placanja: "Promet po načinu plaćanja"
};

export default async function DirectPortalReportPrintPage({
  params,
  searchParams
}: {
  params: Promise<{ tip: string }>;
  searchParams: Promise<DirectPortalReportSearchParams>;
}) {
  const [{ tip }, query] = await Promise.all([params, searchParams]);
  const kind = parseDirectPortalReportKind(tip);
  if (!kind) notFound();

  const context = await requireDirectPortalContext(
    exportPermission,
    `/portal/izvjestaji/${kind}`
  );
  const filters = parseDirectPortalReportFilters(query, context.year);
  const report = await loadDirectPortalReport(context, filters, kind);

  await auditLog({
    agencijaId: context.user.agencija_id!,
    firmaId: context.firma.id,
    korisnikId: context.user.id,
    modul: "izvjestaji",
    akcija: "print_a4",
    tipEntiteta: "direct_portal_report",
    novaVrijednost: {
      tip: kind,
      period_od: filters.periodFrom,
      period_do: filters.periodTo,
      broj_dokumenata: report.documents.length
    }
  });

  const paymentTotal = report.payments.reduce(
    (sum, row) => sum + row.amount,
    BigInt(0)
  );

  return (
    <main className="print-page portal-report-print-page">
      <div className="print-toolbar">
        <Link className="print-button print-back-button" href={`/portal/izvjestaji/${kind}`}>
          Nazad
        </Link>
        <PrintButton label="Štampaj izvještaj" />
      </div>

      <header>
        <p>FISKALNI IZVJEŠTAJ</p>
        <h1>{titles[kind]}</h1>
        <strong>{context.firma.naziv}</strong>
        <span>PIB: {context.firma.pib}</span>
        <span>Period: {filters.periodFrom} — {filters.periodTo}</span>
      </header>

      <section className="pos-report-print-summary">
        <div><span>Računa</span><strong>{report.totals.ordinaryCount}</strong></div>
        <div><span>Storna</span><strong>{report.totals.correctionCount}</strong></div>
        <div><span>Osnovica</span><strong>{formatPortalMoney(report.totals.base)} €</strong></div>
        <div><span>PDV</span><strong>{formatPortalMoney(report.totals.vat)} €</strong></div>
        <div><span>Neto promet</span><strong>{formatPortalMoney(report.totals.gross)} €</strong></div>
      </section>

      {kind === "promet" ? (
        <>
          <h2>Promet po kanalu</h2>
          <table><thead><tr><th>Kanal</th><th>Dokumenata</th><th>Neto promet</th></tr></thead>
            <tbody>{report.channels.map((row) => <tr key={row.channel}><td>{directPortalReportChannelLabels[row.channel] ?? row.channel}</td><td>{row.count}</td><td>{formatPortalMoney(row.gross)} €</td></tr>)}</tbody>
          </table>
          <h2>PDV rekapitulacija</h2>
          <table><thead><tr><th>Stopa</th><th>Osnovica</th><th>PDV</th><th>Ukupno</th></tr></thead>
            <tbody>{report.taxes.map((row) => <tr key={`${row.code}-${row.rate}`}><td>{row.name} ({row.rate}%)</td><td>{formatPortalMoney(row.base)} €</td><td>{formatPortalMoney(row.vat)} €</td><td>{formatPortalMoney(row.gross)} €</td></tr>)}</tbody>
          </table>
        </>
      ) : null}

      {kind === "artikli" ? (
        <><h2>Artikli i usluge</h2><table><thead><tr><th>Šifra</th><th>Artikal / usluga</th><th>JM</th><th>Količina</th><th>Osnovica</th><th>PDV</th><th>Promet</th></tr></thead>
          <tbody>{report.items.map((item) => <tr key={item.id}><td>{item.code}</td><td>{item.name}</td><td>{item.unit}</td><td>{posQuantity(item.quantity)}</td><td>{formatPortalMoney(item.base)} €</td><td>{formatPortalMoney(item.vat)} €</td><td>{formatPortalMoney(item.gross)} €</td></tr>)}</tbody>
        </table></>
      ) : null}

      {kind === "placanja" ? (
        <><h2>Načini plaćanja</h2><table><thead><tr><th>Način plaćanja</th><th>Neto iznos</th></tr></thead>
          <tbody>{report.payments.map((row) => <tr key={row.method}><td>{directPortalReportPaymentLabels[row.method] ?? row.method}</td><td>{formatPortalMoney(row.amount)} €</td></tr>)}</tbody>
          <tfoot><tr><th>Ukupno evidentirano</th><th>{formatPortalMoney(paymentTotal)} €</th></tr></tfoot>
        </table></>
      ) : null}

      <footer>
        Izvještaj je generisan iz fiskalizovanih dokumenata. Storna su uključena kao negativni iznosi. · {new Date().toLocaleString("sr-Latn-ME", { timeZone: "Europe/Podgorica" })}
      </footer>
    </main>
  );
}
