import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { fiscalReviewApi } from "@/lib/fiscal-admin-api";
import { fiscalReviewHref, fiscalReviewRoutes as routes, isFiscalUuid } from "@/lib/fiscal-review-filters";
import { fiscalLabel, fiscalTime, InvoiceLink, ReviewFields, ReviewHeader, ReviewNotice } from "../../pregledi";
import styles from "../../pregledi.module.css";

export default async function FiscalExchangePage({ params }: { params: Promise<{ exchangeId: string }> }) {
  const admin = await requireRole("admin");
  const { exchangeId } = await params;
  if (!isFiscalUuid(exchangeId)) notFound();
  let exchange: Awaited<ReturnType<typeof fiscalReviewApi.exchange>>["data"] | undefined;
  let error: unknown;
  try { exchange = (await fiscalReviewApi.exchange({ id: admin.id, name: admin.korisnicko_ime }, exchangeId)).data; }
  catch (e) { error = e; }
  return <div className="admin-stack">
    <ReviewHeader title="Detalj razmjene" description="Ishod Poreske uprave i lokalno čuvanje su odvojeni." active="diagnostics" />
    {error ? <ReviewNotice error={error} permission="exchanges:read" /> : null}
    {exchange ? <section className="admin-panel">
      <div className="panel-header"><h3>{fiscalLabel(exchange.operation)}</h3>
        <div className={styles.links}>
          {exchange.invoiceId ? <InvoiceLink id={exchange.invoiceId} /> : null}
          {exchange.correlationId ? <Link className="table-link" href={fiscalReviewHref(routes.diagnostics, { view: "requests", correlationId: exchange.correlationId })}>Povezani API zahtjevi</Link> : null}
        </div>
      </div>
      <ReviewFields fields={[
        ["Ishod PU", fiscalLabel(exchange.outcome)], ["HTTP status PU", exchange.puHttpStatus],
        ["Lokalni završetak", fiscalLabel(exchange.localCompletion)], ["Okruženje", fiscalLabel(exchange.environment)],
        ["Početak", fiscalTime(exchange.startedAt)], ["Završetak", fiscalTime(exchange.completedAt)],
        ["Trajanje", exchange.durationMs != null ? exchange.durationMs + " ms" : "—"],
        ["Izvor", fiscalLabel(exchange.provenance)], ["Arhivski dokaz", fiscalLabel(exchange.evidenceState)],
        ["Correlation ID", exchange.correlationId], ["ID razmjene", exchange.exchangeId],
        ["UUID PU zahtjeva", exchange.requestUuid], ["Firma (UUID)", exchange.companyId],
        ["Kod greške", exchange.error?.code], ["Poruka", exchange.error?.message]
      ]} />
    </section> : null}
  </div>;
}
