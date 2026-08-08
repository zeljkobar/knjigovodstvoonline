import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { fiscalAdminApi, isFiscalApiConfigured, type FiscalCertificateExpiration } from "@/lib/fiscal-admin-api";
import { prisma } from "@/lib/prisma";
import { scanFiscalCertificateExpirations } from "./actions";

type Props = { searchParams?: Promise<{ poruka?: string }> };

export default async function FiscalPlatformPage({ searchParams }: Props) {
  const admin = await requireRole("admin");
  const query = await searchParams;
  const firme = await prisma.firma.findMany({
    where: { is_deleted: false }, orderBy: [{ agencija: { naziv: "asc" } }, { naziv: "asc" }],
    select: { id: true, naziv: true, pib: true, aktivan: true, agencija: { select: { naziv: true, is_fiscal_direct_container: true } }, fiscalCompanyLink: { select: { fiscal_api_company_id: true, onboarding_status: true, fiscal_environment: true, is_suspended: true, last_readiness_result: true } } }
  });
  let expirations: FiscalCertificateExpiration[] = [];
  const readinessByFirma = new Map<string, { isReady: boolean; issues: Array<{ code: string; message: string }> }>();
  if (isFiscalApiConfigured()) {
    const actor = { id: admin.id, name: admin.korisnicko_ime };
    try { expirations = (await fiscalAdminApi.listCertificateExpirations(90, actor)).data; } catch { /* Ostali podaci ostaju dostupni. */ }
    const readinessResults = await Promise.allSettled(firme.filter((x) => x.fiscalCompanyLink?.fiscal_api_company_id).map(async (x) => ({ firmaId: x.id, result: (await fiscalAdminApi.getReadiness(x.fiscalCompanyLink!.fiscal_api_company_id!, actor)).data })));
    for (const item of readinessResults) if (item.status === "fulfilled") readinessByFirma.set(item.value.firmaId, item.value.result);
  }
  const linked = firme.filter((x) => x.fiscalCompanyLink);
  const notReady = linked.filter((x) => !(readinessByFirma.get(x.id)?.isReady ?? (x.fiscalCompanyLink?.last_readiness_result as { isReady?: boolean } | null)?.isReady));
  const suspended = linked.filter((x) => x.fiscalCompanyLink?.is_suspended);
  const inTest = linked.filter((x) => x.fiscalCompanyLink?.fiscal_environment === "Test");

  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Centralno upravljanje</p><h2>Fiskalna platforma</h2><p>Firme, spremnost, sertifikati i pristup aplikacija.</p></div><div className="admin-actions"><Link className="primary-link" href="/admin/fiskalizacija/korisnici">Dodaj fiskalnog klijenta</Link><Link className="table-link" href="/admin/fiskalizacija/aplikacije">API aplikacije</Link></div></header>
    {query?.poruka ? <p className="admin-message">{query.poruka === "ISTEK_SERTIFIKATA_PROVJEREN" ? "Provjera isteka sertifikata je završena." : `Fiscal API: ${query.poruka}`}</p> : null}
    {!isFiscalApiConfigured() ? <p className="admin-message">Serverska Fiscal API veza nije podešena.</p> : null}
    <section className="metric-grid" aria-label="Fiskalna statistika"><div className="metric"><span>Povezane firme</span><strong>{linked.length}</strong></div><div className="metric"><span>Nijesu spremne</span><strong>{notReady.length}</strong></div><div className="metric"><span>U testu</span><strong>{inTest.length}</strong></div><div className="metric"><span>Suspendovane</span><strong>{suspended.length}</strong></div></section>

    <section className="admin-panel"><div className="panel-header"><h3>Centralna upozorenja</h3><form action={scanFiscalCertificateExpirations}><button>Pokreni provjeru sertifikata</button></form></div>
      {expirations.length ? <div className="table-wrap"><table><thead><tr><th>Firma</th><th>PIB</th><th>Sertifikat</th><th>Važi do</th><th>Status</th></tr></thead><tbody>{expirations.map((x) => <tr key={x.certificateId}><td>{x.companyName}</td><td>{x.companyTin}</td><td>{x.fileName}</td><td>{new Date(x.validTo).toLocaleDateString("sr-Latn-ME")}</td><td>{x.isExpired ? "Istekao" : `${x.daysRemaining} dana`}</td></tr>)}</tbody></table></div> : <p>Nema aktivnih sertifikata koji ističu u narednih 90 dana.</p>}
    </section>

    {notReady.length ? <section className="admin-panel"><div className="panel-header"><h3>Firme koje nijesu spremne</h3><span>{notReady.length}</span></div>{notReady.map((x) => <p key={x.id}><Link className="table-link" href={`/admin/fiskalizacija/${x.id}`}>{x.naziv}</Link> · {readinessByFirma.get(x.id)?.issues.map((issue) => issue.code).join(", ") || x.fiscalCompanyLink?.onboarding_status}</p>)}</section> : null}

    <section className="admin-panel"><div className="panel-header"><h3>Firme i fiskalni status</h3><span>{firme.length} ukupno</span></div><div className="table-wrap"><table><thead><tr><th>Firma</th><th>Agencija</th><th>PIB</th><th>Okruženje</th><th>Status</th><th>Akcija</th></tr></thead><tbody>{firme.map((firma) => { const link = firma.fiscalCompanyLink; return <tr key={firma.id}><td><strong>{firma.naziv}</strong><small>{firma.aktivan ? "Aktivna u sistemu" : "Neaktivna u sistemu"}</small></td><td>{firma.agencija.is_fiscal_direct_container ? "Direktan klijent" : firma.agencija.naziv}</td><td>{firma.pib || "-"}</td><td>{link?.fiscal_environment || "-"}</td><td>{link?.is_suspended ? "Suspendovana" : link?.onboarding_status || "Nije podešeno"}</td><td><Link className="table-link" href={`/admin/fiskalizacija/${firma.id}`}>Otvori</Link></td></tr>; })}</tbody></table></div></section>
  </div>;
}
