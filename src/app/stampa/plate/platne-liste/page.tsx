import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { loadPayrollDocumentForPrint } from "@/lib/payroll-document-access";
import type { PayrollDocumentData } from "@/lib/payroll-documents";
import { money, payrollCategoryLabel } from "@/lib/payroll";

type PageProps = {
  searchParams?: Promise<{ obracun?: string; radnik?: string }>;
};

function displayDate(value: Date) {
  return value.toLocaleDateString("sr-Latn-ME", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function PayrollSlip({
  data,
  worker
}: {
  data: PayrollDocumentData;
  worker: PayrollDocumentData["workers"][number];
}) {
  const employerCosts =
    worker.totals.doprinosiPoslodavacCent +
    worker.totals.fondRadaCent +
    worker.totals.sindikatCent +
    worker.totals.privrednaKomoraCent;
  const authorizedPerson = data.firma.odgovorna_lica[0]?.ime_prezime ?? "Ovlašćeno lice";

  return (
    <section className="payroll-slip-document">
      {data.isPreview ? <div className="payroll-print-watermark">NACRT</div> : null}

      <header className="payroll-slip-company">
        <div>
          <strong>{data.firma.naziv}</strong>
          <span>{[data.firma.adresa, data.firma.grad].filter(Boolean).join(", ")}</span>
          <span>PIB: {data.firma.pib ?? "—"}</span>
        </div>
        <div>
          <span>Obračun {data.obracun.broj}</span>
          <strong>{String(data.obracun.mjesec).padStart(2, "0")}/{data.obracun.godina}</strong>
          <span>{payrollCategoryLabel(data.obracun.kategorija)}</span>
        </div>
      </header>

      <div className="payroll-slip-title">
        <h1>OBRAČUN LIČNIH PRIMANJA</h1>
        <p>
          za period {displayDate(data.obracun.datum_od)} – {displayDate(data.obracun.datum_do)}
        </p>
      </div>

      <section className="payroll-slip-info-grid">
        <div>
          <p><span>Prezime i ime</span><strong>{worker.name}</strong></p>
          <p><span>JMBG</span><strong>{worker.employee.jmbg ?? "—"}</strong></p>
          <p><span>Radno mjesto</span><strong>{worker.employee.radnoMjesto ?? "—"}</strong></p>
          <p><span>Tekući račun</span><strong>{worker.employee.tekuciRacun ?? "—"}</strong></p>
          <p><span>Telefon</span><strong>{worker.employee.telefon ?? "—"}</strong></p>
          <p><span>E-mail</span><strong>{worker.employee.email ?? "—"}</strong></p>
        </div>
        <div>
          <p><span>Fond sati</span><strong>{worker.calculationWorker.fond_sati}</strong></p>
          <p><span>Obračunati sati</span><strong>{worker.calculationWorker.ukupno_sati}</strong></p>
          <p><span>Radno vrijeme</span><strong>{worker.employee.procenatRadnogVremena}%</strong></p>
          <p><span>Osnovica</span><strong>{money(worker.totals.osnovicaCent)}</strong></p>
          <p><span>Minuli rad</span><strong>{money(worker.totals.minuliRadCent)}</strong></p>
          <p><span>Datum obračuna</span><strong>{displayDate(data.obracun.datum_obracuna)}</strong></p>
        </div>
      </section>

      <table className="payroll-slip-lines">
        <thead>
          <tr>
            <th>Šifra</th>
            <th>Primanje</th>
            <th>Od</th>
            <th>Do</th>
            <th>Sati</th>
            <th>Osnovica</th>
            <th>Bruto</th>
            <th>Neto</th>
          </tr>
        </thead>
        <tbody>
          {worker.lines.map((line) => (
            <tr key={line.id}>
              <td>{line.sifra_primanja}</td>
              <td>{line.naziv_primanja}</td>
              <td>{displayDate(line.datum_od)}</td>
              <td>{displayDate(line.datum_do)}</td>
              <td>{line.ukupno_sati}</td>
              <td>{money(line.osnovica_cent)}</td>
              <td>{money(line.bruto_cent)}</td>
              <td>{money(line.neto_cent)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="payroll-slip-breakdown">
        <h2>Specifikacija obračuna</h2>
        <div className="payroll-slip-breakdown-grid">
          <div>
            <h3>Obračun zarade</h3>
            <p><span>Neto</span><strong>{money(worker.totals.netoCent)}</strong></p>
            <p><span>Porez</span><strong>{money(worker.totals.porezCent)}</strong></p>
            <p><span>Prirez</span><strong>{money(worker.totals.prirezCent)}</strong></p>
            <p><span>Doprinosi zaposlenog</span><strong>{money(worker.totals.doprinosiZaposleniCent)}</strong></p>
            <p className="payroll-slip-subtotal"><span>Bruto I</span><strong>{money(worker.totals.brutoCent)}</strong></p>
            <p><span>Troškovi poslodavca</span><strong>{money(employerCosts)}</strong></p>
            <p className="payroll-slip-total"><span>Ukupan trošak</span><strong>{money(worker.totals.ukupniTrosakCent)}</strong></p>
          </div>
          <div>
            <h3>Doprinosi</h3>
            <p><span>PIO – zaposleni</span><strong>{money(worker.totals.zaposleniPioCent)}</strong></p>
            <p><span>Zdravstvo – zaposleni</span><strong>{money(worker.totals.zaposleniZdravstvoCent)}</strong></p>
            <p><span>Nezaposlenost – zaposleni</span><strong>{money(worker.totals.zaposleniNezaposleniCent)}</strong></p>
            <p><span>PIO – poslodavac</span><strong>{money(worker.totals.poslodavacPioCent)}</strong></p>
            <p><span>Zdravstvo – poslodavac</span><strong>{money(worker.totals.poslodavacZdravstvoCent)}</strong></p>
            <p><span>Nezaposlenost – poslodavac</span><strong>{money(worker.totals.poslodavacNezaposleniCent)}</strong></p>
            <p className="payroll-slip-total"><span>Za isplatu</span><strong>{money(worker.totals.netoZaIsplatuCent)}</strong></p>
          </div>
        </div>
      </section>

      <footer className="payroll-slip-signatures">
        <div><span>{worker.name}</span><i></i><small>Zaposleni</small></div>
        <div><span>M.P.</span></div>
        <div><span>{authorizedPerson}</span><i></i><small>Ovlašćeno lice</small></div>
      </footer>
    </section>
  );
}

export default async function PayrollSlipsPrintPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const result = await loadPayrollDocumentForPrint(params?.obracun);

  if (!result.data) {
    return <main className="print-page"><section className="payroll-slip-document"><p>{result.error}</p></section></main>;
  }

  const workers = params?.radnik
    ? result.data.workers.filter((worker) => worker.employee.id === params.radnik)
    : result.data.workers;

  if (workers.length === 0) {
    return <main className="print-page"><section className="payroll-slip-document"><p>Radnik nije pronađen u izabranom obračunu.</p></section></main>;
  }

  return (
    <main className="print-page payroll-slips-print-page">
      <div className="print-toolbar">
        <Link
          className="print-button print-link-button"
          href={`/agencija/plate/obracun?obracun=${result.data.obracun.id}${params?.radnik ? `&radnik=${params.radnik}` : ""}`}
        >
          Nazad
        </Link>
        <PrintButton label={workers.length === 1 ? "Štampaj platnu listu" : "Štampaj sve platne liste"} />
      </div>
      {workers.map((worker) => (
        <PayrollSlip data={result.data!} worker={worker} key={worker.employee.id} />
      ))}
    </main>
  );
}
