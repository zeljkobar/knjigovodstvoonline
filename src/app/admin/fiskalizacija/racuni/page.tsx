import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { FiscalAdminApiError, listFiscalAdminInvoices } from "@/lib/fiscal-admin-api";

const route = "/admin/fiskalizacija/racuni";
const dateFormat = new Intl.DateTimeFormat("sr-Latn-ME", {
  dateStyle: "short", timeStyle: "short", timeZone: "Europe/Podgorica"
});
const environmentLabels = { Production: "Produkcija", Test: "Test", Unknown: "Nepoznato" };
const statusLabels: Record<string, string> = {
  Fiscalized: "Fiskalizovan",
  StornoCreated: "Storniran",
  FiscalizationFailed: "Neuspjela fiskalizacija",
  FiscalizationPending: "Ishod nije potvrđen",
  ReadyForFiscalization: "Spreman za fiskalizaciju",
  Draft: "Nacrt"
};
type Search = { page?: string; environment?: string; officialInvoiceNumber?: string };

export default async function FiscalInvoicesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const admin = await requireRole("admin");
  const query = await searchParams;
  const requestedPage = Number(query.page);
  const page = Number.isInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 1_000_000 ? requestedPage : 1;
  const environment = query.environment === "Production" || query.environment === "Test" || query.environment === "Unknown"
    ? query.environment : undefined;
  const officialInvoiceNumber = typeof query.officialInvoiceNumber === "string" ? query.officialInvoiceNumber.trim().slice(0, 120) : "";
  let invoices: Awaited<ReturnType<typeof listFiscalAdminInvoices>>["data"] | undefined;
  let errorMessage: string | undefined;
  try {
    invoices = (await listFiscalAdminInvoices({ id: admin.id, name: admin.korisnicko_ime },
      { page, environment, officialInvoiceNumber })).data;
  } catch (error) {
    const apiError = error instanceof FiscalAdminApiError ? error : null;
    errorMessage = apiError?.code === "FISCAL_READ_NOT_CONFIGURED"
      ? "Serverski ključ za globalni pregled još nije podešen."
      : `Fiskalni računi trenutno nijesu dostupni.${apiError?.correlationId ? ` Referenca: ${apiError.correlationId}.` : ""}`;
  }

  const pageLink = (next: number) => {
    const params = new URLSearchParams({ page: String(next) });
    if (environment) params.set("environment", environment);
    if (officialInvoiceNumber) params.set("officialInvoiceNumber", officialInvoiceNumber);
    return `${route}?${params}`;
  };
  return <div className="admin-stack">
    <header className="admin-header">
      <div><p className="eyebrow">Fiskalna platforma</p><h2>Fiskalni računi</h2>
        <p>Računi svih firmi evidentirani u Fiscal API-ju. Pregled ne mijenja račune.</p>
      </div>
      <Link className="table-link" href="/admin/fiskalizacija">Nazad na fiskalnu platformu</Link>
    </header>
    <section className="admin-panel">
      <form className="admin-actions" action={route} method="get">
        <label>Okruženje <select name="environment" defaultValue={environment ?? ""}>
          <option value="">Sva okruženja</option><option value="Production">Produkcija</option>
          <option value="Test">Test</option><option value="Unknown">Nepoznato</option>
        </select></label>
        <label>Zvanični broj <input name="officialInvoiceNumber" defaultValue={officialInvoiceNumber} maxLength={120} /></label>
        <button type="submit">Pretraži</button>
      </form>
    </section>
    {errorMessage ? <p className="admin-message" role="alert">{errorMessage}</p> : null}
    {invoices ? <section className="admin-panel">
      <div className="panel-header"><h3>Računi</h3><span>{invoices.totalCount} ukupno</span></div>
      {invoices.items.length ? <div className="table-wrap"><table>
        <thead><tr><th>Firma</th><th>Račun</th><th>Vrijeme izdavanja</th><th>Kupac</th><th>Okruženje</th><th>Status</th><th>Ukupno</th><th>JIKR</th></tr></thead>
        <tbody>{invoices.items.map((row) => <tr key={row.id}>
          <td><strong>{row.companyName}</strong><small>{row.companyTin}</small></td>
          <td>{row.officialInvoiceNumber ?? row.invoiceNumber}</td>
          <td><time dateTime={row.issueDateTime}>{dateFormat.format(new Date(row.issueDateTime))}</time></td>
          <td>{row.buyer?.name ?? "—"}</td><td>{environmentLabels[row.environment] ?? row.environment}</td>
          <td>{statusLabels[row.status] ?? row.status}</td>
          <td>{row.totalGrossAmount.replace(".", ",")} {row.currency}</td><td>{row.jikr ?? "—"}</td>
        </tr>)}</tbody>
      </table></div> : <p>Nema računa na ovoj stranici za izabrane filtere.</p>}
      <nav className="admin-actions" aria-label="Stranice fiskalnih računa">
        {invoices.page > 1 ? <Link className="table-link" href={pageLink(invoices.page - 1)}>Prethodna</Link> : null}
        <span>Stranica {invoices.page}</span>
        {invoices.page * invoices.pageSize < invoices.totalCount
          ? <Link className="table-link" href={pageLink(invoices.page + 1)}>Sljedeća</Link> : null}
      </nav>
    </section> : null}
  </div>;
}
