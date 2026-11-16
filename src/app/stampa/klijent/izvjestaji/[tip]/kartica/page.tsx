import { notFound } from "next/navigation";
import { ClientPartnerCardTable, clientPartnerCardDate } from "@/components/ClientPartnerCardTable";
import { PrintButton } from "@/components/PrintButton";
import { loadClientPartnerCardReport, type ClientPartnerCardQuery } from "@/lib/client-partner-card";

export default async function ClientPartnerCardPrint({ params, searchParams }: {
  params: Promise<{ tip: string }>;
  searchParams: Promise<ClientPartnerCardQuery & { godina?: string }>;
}) {
  const [{ tip }, query] = await Promise.all([params, searchParams]);
  const report = await loadClientPartnerCardReport(tip, query, query.godina);
  if (!report.configured || report.invalidPeriod) notFound();
  const { firma, year } = report.context;

  return <main className="print-page account-card-print-page">
    <style>{`@page { size: A4 landscape; margin: 10mm; }`}</style>
    <div className="print-toolbar account-card-print-toolbar"><PrintButton label="Štampaj karticu" /></div>
    <article className="account-card-print-document">
      <header className="account-card-print-header">
        <div>
          <p>{report.config.label}</p>
          <h1>Analitička kartica partnera</h1>
          <strong>{report.partner?.naziv}</strong>
          <p>PIB partnera: {report.partner?.pib ?? "—"}</p>
        </div>
        <div>
          <strong>{firma.naziv}</strong>
          <p>PIB firme: {firma.pib ?? "—"}</p>
          <p>Poslovna godina: {year.godina}</p>
        </div>
      </header>
      <p>Period: {clientPartnerCardDate(report.from ?? year.datum_od)} – {clientPartnerCardDate(report.to ?? year.datum_do)} · Iznosi u EUR</p>
      <ClientPartnerCardTable report={report} print />
    </article>
  </main>;
}
