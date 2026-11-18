import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { fiscalReviewApi } from "@/lib/fiscal-admin-api";
import {
  fiscalEnum, fiscalInput, fiscalPage, fiscalReviewRoutes as routes, invoiceEnvironments, isFiscalUuid, type FiscalSearch
} from "@/lib/fiscal-review-filters";
import { FiscalInvoiceTable, ReviewHeader, ReviewNotice, ReviewPager } from "../pregledi";
import styles from "../pregledi.module.css";

export default async function FiscalInvoicesPage({ searchParams }: { searchParams: Promise<FiscalSearch> }) {
  const admin = await requireRole("admin");
  const query = await searchParams;
  const companyId = fiscalInput(query.companyId);
  const environment = fiscalEnum(query.environment, invoiceEnvironments);
  const officialInvoiceNumber = fiscalInput(query.officialInvoiceNumber);
  const buyerName = fiscalInput(query.buyerName);
  const filters = { companyId, environment, officialInvoiceNumber, buyerName, page: fiscalPage(query.page) };
  const invalid = (companyId && !isFiscalUuid(companyId)) ? "Identifikator firme nije ispravan." :
    buyerName && buyerName.length < 3 ? "Za pretragu kupca upiši najmanje tri znaka." : null;
  let invoices: Awaited<ReturnType<typeof fiscalReviewApi.invoices>>["data"] | undefined;
  let error: unknown;
  if (!invalid) {
    try { invoices = (await fiscalReviewApi.invoices({ id: admin.id, name: admin.korisnicko_ime }, filters)).data; }
    catch (e) { error = e; }
  }
  return <div className="admin-stack">
    <ReviewHeader title="Fiskalni računi" description="Računi evidentirani u Fiscal API-ju. Pregled ne mijenja račune." active="invoices" />
    <section className="admin-panel">
      <form className={styles.filters} action={routes.invoices} method="get">
        <label>Okruženje <select name="environment" defaultValue={environment ?? ""}>
          <option value="">Sva okruženja</option>
          {Object.entries(invoiceEnvironments).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Zvanični broj <input name="officialInvoiceNumber" defaultValue={officialInvoiceNumber} maxLength={100} /></label>
        <label>Kupac <input name="buyerName" defaultValue={buyerName} maxLength={100} minLength={3} /></label>
        {companyId ? <input type="hidden" name="companyId" value={companyId} /> : null}
        <button type="submit">Pretraži</button>
        <Link className="table-link" href={routes.invoices}>Očisti filtere</Link>
      </form>
    </section>
    {invalid ? <p className="admin-message" role="alert">{invalid}</p> : null}
    {error ? <ReviewNotice error={error} permission="invoices:read" /> : null}
    {invoices ? <section className="admin-panel">
      <div className="panel-header"><h3>Računi</h3><span>{invoices.totalCount} ukupno</span></div>
      <FiscalInvoiceTable items={invoices.items} />
      <ReviewPager data={invoices} href={routes.invoices} query={filters} />
    </section> : null}
  </div>;
}
