import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { fiscalReviewApi } from "@/lib/fiscal-admin-api";
import { fiscalDocumentSelection, fiscalMetrics, fiscalPage, fiscalReportSelection, fiscalReviewHref,
  fiscalReviewRoutes as routes, type FiscalSearch } from "@/lib/fiscal-review-filters";
import { FiscalInvoiceTable, fiscalLabel, ReviewHeader, ReviewNotice, ReviewPager } from "../../pregledi";

export default async function FiscalTurnoverDocumentsPage({ searchParams }: { searchParams: Promise<FiscalSearch> }) {
  const admin = await requireRole("admin");
  const query = await searchParams;
  const { filter, error: selectionError } = fiscalReportSelection(query);
  const drill = fiscalDocumentSelection(query);
  const values = { ...filter, ...drill };
  let documents: Awaited<ReturnType<typeof fiscalReviewApi.turnoverDocuments>>["data"] | undefined;
  let error: unknown;
  if (filter && drill) {
    try {
      documents = (await fiscalReviewApi.turnoverDocuments({ id: admin.id, name: admin.korisnicko_ime },
        { ...values, page: fiscalPage(query.page) })).data;
    } catch (e) { error = e; }
  }
  const caption = drill ? fiscalMetrics[drill.metric as keyof typeof fiscalMetrics] : "Dokumenti izvještaja";
  const dimension = [drill?.category, drill?.paymentType, drill?.status, drill?.workflowKind]
    .filter((v): v is string => typeof v === "string").map(fiscalLabel).join(" · ");
  return <div className="admin-stack">
    <ReviewHeader title={caption} description="Dokumenti koji odgovaraju odabranom redu izvještaja. Prikazani iznos je doprinos tom redu, ne nužno cijeli račun." active="turnover" />
    <section className="admin-panel">
      <div className="panel-header"><h3>Odabrani dokumenti</h3>
        <Link className="table-link" href={fiscalReviewHref(routes.turnover, filter ?? {})}>Nazad na isti izvještaj</Link>
      </div>
      {filter ? <p>{filter.fromDate} – {filter.toDate} (bez završnog datuma) · {fiscalLabel(filter.environment)}
        {drill?.bucketStartDate ? " · Grupa od " + drill.bucketStartDate : ""}
        {drill?.vatRate ? " · PDV " + drill.vatRate + "%" : ""}
        {dimension ? " · " + dimension : ""}
      </p> : null}
      {!filter || !drill ? <p className="admin-message" role="alert">{selectionError ?? "Prvo izaberi red u izvještaju."}</p> : null}
      {error ? <ReviewNotice error={error} permission="reports:read i invoices:read" /> : null}
      {documents ? <>
        <FiscalInvoiceTable items={documents.items} contributions />
        <ReviewPager data={documents} href={routes.documents} query={values} />
      </> : null}
    </section>
  </div>;
}
