import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { loadPayrollDocumentForPrint } from "@/lib/payroll-document-access";
import { money, payrollCategoryLabel } from "@/lib/payroll";

type PageProps = {
  searchParams?: Promise<{ obracun?: string }>;
};

function displayDate(value: Date) {
  return value.toLocaleDateString("sr-Latn-ME", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

export default async function PayrollRecapPrintPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const result = await loadPayrollDocumentForPrint(params?.obracun);

  if (!result.data) {
    return <main className="print-page"><section className="payroll-recap-document"><p>{result.error}</p></section></main>;
  }

  const { firma, obracun, workers, totals, isPreview } = result.data;

  return (
    <main className="print-page payroll-recap-print-page">
      <div className="print-toolbar">
        <Link className="print-button print-link-button" href={`/agencija/plate/obracun?obracun=${obracun.id}`}>
          Nazad
        </Link>
        <PrintButton label="Štampaj rekapitulaciju" />
      </div>

      <section className="payroll-recap-document">
        {isPreview ? <div className="payroll-print-watermark">NACRT</div> : null}
        <header className="payroll-recap-header">
          <div>
            <p>{firma.naziv}</p>
            <span>PIB: {firma.pib ?? "—"}</span>
          </div>
          <div>
            <h1>REKAPITULACIJA OBRAČUNA</h1>
            <strong>Obračun {obracun.broj} / {obracun.godina}</strong>
            <span>{payrollCategoryLabel(obracun.kategorija)}</span>
          </div>
        </header>

        <section className="payroll-recap-meta">
          <p><span>Period</span><strong>{displayDate(obracun.datum_od)} – {displayDate(obracun.datum_do)}</strong></p>
          <p><span>Datum obračuna</span><strong>{displayDate(obracun.datum_obracuna)}</strong></p>
          <p><span>Datum isplate</span><strong>{obracun.datum_isplate ? displayDate(obracun.datum_isplate) : "—"}</strong></p>
          <p><span>Fond sati</span><strong>{obracun.fond_sati}</strong></p>
        </section>

        <table className="payroll-recap-table">
          <thead>
            <tr>
              <th>Radnik</th>
              <th>Sati</th>
              <th>Neto</th>
              <th>Bruto</th>
              <th>Porez</th>
              <th>Prirez</th>
              <th>Dopr. zaposleni</th>
              <th>Dopr. poslodavac</th>
              <th>Trošak</th>
            </tr>
          </thead>
          <tbody>
            {workers.map((worker) => (
              <tr key={worker.employee.id}>
                <td>{worker.name}</td>
                <td>{worker.calculationWorker.ukupno_sati}</td>
                <td>{money(worker.totals.netoCent)}</td>
                <td>{money(worker.totals.brutoCent)}</td>
                <td>{money(worker.totals.porezCent)}</td>
                <td>{money(worker.totals.prirezCent)}</td>
                <td>{money(worker.totals.doprinosiZaposleniCent)}</td>
                <td>{money(worker.totals.doprinosiPoslodavacCent)}</td>
                <td>{money(worker.totals.ukupniTrosakCent)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>UKUPNO</th>
              <th>{workers.reduce((sum, worker) => sum + worker.calculationWorker.ukupno_sati, 0)}</th>
              <th>{money(totals.netoCent)}</th>
              <th>{money(totals.brutoCent)}</th>
              <th>{money(totals.porezCent)}</th>
              <th>{money(totals.prirezCent)}</th>
              <th>{money(totals.doprinosiZaposleniCent)}</th>
              <th>{money(totals.doprinosiPoslodavacCent)}</th>
              <th>{money(totals.ukupniTrosakCent)}</th>
            </tr>
          </tfoot>
        </table>

        <section className="payroll-recap-summary">
          <p><span>Broj radnika</span><strong>{workers.length}</strong></p>
          <p><span>Neto za isplatu</span><strong>{money(totals.netoZaIsplatuCent)}</strong></p>
          <p><span>Ukupno porez i prirez</span><strong>{money(totals.porezCent + totals.prirezCent)}</strong></p>
          <p><span>Ukupan trošak</span><strong>{money(totals.ukupniTrosakCent)}</strong></p>
        </section>
      </section>
    </main>
  );
}
