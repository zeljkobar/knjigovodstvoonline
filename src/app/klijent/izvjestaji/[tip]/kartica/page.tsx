import Link from "next/link";
import { loadClientPartnerCardReport, type ClientPartnerCardQuery } from "@/lib/client-partner-card";
import { AutoSubmitFilterForm } from "@/components/AutoSubmitFilterForm";
import { ClientPartnerCardTable } from "@/components/ClientPartnerCardTable";

export default async function ClientCard({ params, searchParams }: {
  params: Promise<{ tip: string }>;
  searchParams: Promise<ClientPartnerCardQuery>;
}) {
  const [{ tip }, query] = await Promise.all([params, searchParams]);
  const report = await loadClientPartnerCardReport(tip, query);
  if (!report.configured) return <p className="admin-message">Agencija još nije podesila ovaj pregled. Obratite se svom knjigovođi.</p>;

  const path = `/klijent/izvjestaji/${tip}/kartica`;
  const printQuery = new URLSearchParams({ partner: query.partner ?? "", godina: report.context.year.id });
  if (report.from) printQuery.set("datum_od", report.from.toISOString().slice(0, 10));
  if (report.to) printQuery.set("datum_do", report.to.toISOString().slice(0, 10));
  if (report.invalidPeriod) return <p className="admin-message">
    Datum od mora biti prije datuma do. <Link href={`${path}?partner=${query.partner}`}>Ukloni filter datuma</Link>
  </p>;

  return <div className="admin-stack">
    <header className="admin-header">
      <div>
        <p className="eyebrow">{report.config.label} / Analitička kartica</p>
        <h1>{report.partner?.naziv}</h1>
        <p>{report.context.firma.naziv} · {report.context.year.godina} · PIB partnera: {report.partner?.pib ?? "—"}</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-button" href={`/klijent/izvjestaji/${tip}`}>Nazad na pregled</Link>
        <Link className="primary-link" href={`/stampa/klijent/izvjestaji/${tip}/kartica?${printQuery}`}
          target="_blank" rel="noreferrer" prefetch={false}>Štampaj karticu</Link>
      </div>
    </header>
    <section className="admin-panel">
      <AutoSubmitFilterForm action={path} className="admin-form">
        <input type="hidden" name="partner" value={query.partner} />
        <label>Datum od<input name="datum_od" type="date" defaultValue={query.datum_od} /></label>
        <label>Datum do<input name="datum_do" type="date" defaultValue={query.datum_do} /></label>
      </AutoSubmitFilterForm>
    </section>
    <section className="admin-panel"><ClientPartnerCardTable report={report} /></section>
  </div>;
}
