import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { prepareFiscalEnvironmentRepair, FiscalEnvironmentRepairError } from "@/lib/fiscal-environment-repair";
import { confirmMissingFiscalEnvironment } from "./actions";
import { ReviewNotice } from "../../pregledi";

export const dynamic = "force-dynamic";
export default async function EnvironmentRepairPage({ params, searchParams }: { params: Promise<{ invoiceId: string }>; searchParams: Promise<{ rezultat?: string }> }) {
  const admin = await requireRole("admin");
  const { invoiceId } = await params;
  const query = await searchParams;
  let plan: Awaited<ReturnType<typeof prepareFiscalEnvironmentRepair>> | undefined;
  let error: unknown;
  try { plan = await prepareFiscalEnvironmentRepair({ id: admin.id, name: admin.korisnicko_ime }, invoiceId); } catch (caught) { error = caught; }
  return <div className="admin-stack"><header className="admin-header"><h2>Provjera nedostajućeg okruženja</h2><Link className="secondary-button" href="/admin/fiskalizacija/usaglasavanje">Nazad na usaglašavanje</Link></header>
    {query.rezultat === "sacuvano" ? <p role="status">Okruženje je potvrđeno i dopunjeno. Ponovite kontrolu prometa.</p> : null}
    {query.rezultat === "greska" ? <p role="alert">Dopuna nije završena. Provjerite svjež pregled i eventualne promjene ili zaključavanja.</p> : null}
    {error ? error instanceof FiscalEnvironmentRepairError ? <p role="alert">{error.message}</p> : <ReviewNotice error={error} permission="invoices:read"/> : null}
    {plan ? <section className="admin-panel"><h3>{plan.local.interni_broj}</h3><p>Zvanični broj: {plan.remote.officialInvoiceNumber}</p><p>Lokalno okruženje: {plan.local.fiscal_environment ?? "Nije evidentirano"}<br/>API okruženje: {plan.remote.environment}</p>
      <p>Ova dopuna mijenja isključivo nedostajuće okruženje. Iznosi, status, stavke, fiskalni identifikatori, KIF i nalozi se ne prepisuju. Nema ponovnog slanja računa.</p>
      {plan.reasons.length ? <><h4>Dopuna nije dozvoljena</h4><ul>{plan.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></> : <form action={confirmMissingFiscalEnvironment}>
        <input type="hidden" name="invoiceId" value={plan.local.id}/><input type="hidden" name="version" value={plan.local.updated_at.toISOString()}/>
        <label><input type="checkbox" name="confirmation" value="CONFIRM_ENVIRONMENT" required/> Potvrđujem dopunu nedostajućeg okruženja prema ovom API računu.</label>
        <button className="primary-button" type="submit">Potvrdi okruženje</button>
      </form>}
    </section> : null}
  </div>;
}
