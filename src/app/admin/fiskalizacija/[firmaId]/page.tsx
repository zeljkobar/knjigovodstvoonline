import Link from "next/link";
import { randomUUID } from "crypto";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { fiscalAdminApi, type FiscalActivation, type FiscalAuditPage, type FiscalBusinessUnit, type FiscalCertificate, type FiscalCertificateAlert, type FiscalCompany, type FiscalDevice, type FiscalOperator, type FiscalProductionProfile } from "@/lib/fiscal-admin-api";
import { prisma } from "@/lib/prisma";
import { acknowledgeFiscalCertificateAlert, activateFiscalCertificate, activateFiscalProduction, configureFiscalProductionProfile, confirmFiscalTest, createFiscalBusinessUnit, createFiscalDevice, createFiscalOperator, deactivateFiscalCertificate, fiscalizeAndConfirmControlTest, onboardFiscalCompany, refreshFiscalReadiness, registerFiscalProductionEnu, returnFiscalCompanyToTest, setFiscalSuspension, toggleFiscalBusinessUnit, toggleFiscalDevice, toggleFiscalOperator, updateFiscalBusinessUnit, updateFiscalDevice, updateFiscalIdentity, updateFiscalOperator, uploadFiscalCertificate } from "../actions";

type Query = { poruka?: string; correlation?: string; audit_page?: string; audit_action?: string; audit_actor?: string; audit_from?: string; audit_to?: string };
type Props = { params: Promise<{ firmaId: string }>; searchParams?: Promise<Query> };

const messages: Record<string, string> = {
  KLIJENT_KREIRAN: "Fiskalni klijent je dodat. Sada unesite kodove i povežite ga sa Fiscal API-jem.",
  CONTROL_TEST_AUTOMATSKI_POTVRDJEN: "Kontrolna usluga od 1,00 € je fiskalizovana u testu, dobila je JIKR i test je potvrđen.",
  CONTROL_TEST_INVALID: "Kontrolni test nema ispravan idempotency ključ.", CONTROL_TEST_CONFIGURATION_MISSING: "Nedostaje aktivna testna poslovna jedinica, ENU ili operater.",
  CONTROL_TEST_NOT_FISCALIZED: "Kontrolni račun nije uspješno fiskalizovan.", PRODUCTION_PROFILE_REQUIRED_FIELDS: "Popunite obavezna polja produkcionog profila.",
  PRODUKCIONI_PROFIL_SACUVAN: "Produkcioni profil je sačuvan. Firma je i dalje u testnom režimu.", KLIJENT_KREIRAN_EMAIL_GRESKA: "Klijent je dodat, ali pozivnica nije poslata.",
  FIRMA_VEC_POSTOJI: "Firma sa tim PIB-om već postoji.", FIRMA_POVEZANA: "Firma je povezana sa Fiscal API-jem.", READINESS_OSVJEZEN: "Provjera spremnosti je osvježena.",
  FIRMA_SUSPENDOVANA: "Fiskalizacija je suspendovana.", FIRMA_AKTIVIRANA: "Firma je ponovo aktivirana.", FIRMA_ILI_PIB_NEDOSTAJE: "Firma nije pronađena ili nema PIB.",
  KODOVI_NEDOSTAJU: "Kod softvera i održavaoca su obavezni.", FIRMA_NIJE_POVEZANA: "Firma nije povezana sa Fiscal API-jem.", RAZLOG_OBAVEZAN: "Razlog suspenzije je obavezan.",
  FISCAL_API_NOT_CONFIGURED: "Serverska veza sa Fiscal API-jem nije podešena.", FISCAL_API_UNAVAILABLE: "Fiscal API trenutno nije dostupan.", FISCAL_API_GRESKA: "Fiscal API operacija nije uspjela.",
  JEDINICA_DODATA: "Poslovna jedinica je dodata.", JEDINICA_SACUVANA: "Poslovna jedinica je izmijenjena.", JEDINICA_STATUS_SACUVAN: "Status poslovne jedinice je promijenjen.",
  ENU_DODAT: "ENU uređaj je dodat.", ENU_SACUVAN: "ENU uređaj je izmijenjen.", ENU_STATUS_SACUVAN: "Status ENU uređaja je promijenjen.",
  OPERATER_DODAT: "Operater je dodat.", OPERATER_SACUVAN: "Operater je izmijenjen.", OPERATER_STATUS_SACUVAN: "Status operatera je promijenjen.",
  SERTIFIKAT_DODAT: "Sertifikat je bezbjedno proslijeđen Fiscal API-ju.", SERTIFIKAT_AKTIVIRAN: "Sertifikat je aktiviran.", SERTIFIKAT_DEAKTIVIRAN: "Sertifikat je deaktiviran.",
  CERT_UPLOAD_INVALID_FILE: "Izaberite PFX/P12 fajl do 5 MB i unesite lozinku.", TEST_POTVRDJEN: "Kontrolni test je potvrđen.", PRODUKCIJA_AKTIVIRANA: "Produkcioni režim je aktiviran.",
  VRACENO_U_TEST: "Firma je vraćena u test.", PRODUKCIONI_ENU_REGISTROVAN: "Produkcioni ENU je registrovan.", ALERT_POTVRDJEN: "Upozorenje je obrađeno.",
  POTVRDA_NIJE_ISPRAVNA: "Kontrolni tekst nije ispravan.", FISKALNI_IDENTITET_SACUVAN: "Fiskalni identitet firme je izmijenjen.", FISKALNI_IDENTITET_OBAVEZNA_POLJA: "Naziv i kontrolni tekst su obavezni."
};

export default async function FiscalCompanyPage({ params, searchParams }: Props) {
  const admin = await requireRole("admin");
  const { firmaId } = await params;
  const query = (await searchParams) ?? {};
  const firma = await prisma.firma.findFirst({ where: { id: firmaId, is_deleted: false }, include: { agencija: true, fiscalCompanyLink: true } });
  if (!firma) notFound();
  const link = firma.fiscalCompanyLink;
  let company: FiscalCompany | null = null, businessUnits: FiscalBusinessUnit[] = [], devices: FiscalDevice[] = [], operators: FiscalOperator[] = [], certificates: FiscalCertificate[] = [];
  let activation: FiscalActivation | null = null, productionProfile: FiscalProductionProfile | null = null, audit: FiscalAuditPage | null = null, alerts: FiscalCertificateAlert[] = [];
  if (link?.fiscal_api_company_id) {
    const actor = { id: admin.id, name: admin.korisnicko_ime };
    const resources = await Promise.allSettled([
      fiscalAdminApi.getCompany(link.fiscal_api_company_id, actor), fiscalAdminApi.listBusinessUnits(link.fiscal_api_company_id, actor),
      fiscalAdminApi.listDevices(link.fiscal_api_company_id, actor), fiscalAdminApi.listOperators(link.fiscal_api_company_id, actor),
      fiscalAdminApi.listCertificates(link.fiscal_api_company_id, actor), fiscalAdminApi.getActivation(link.fiscal_api_company_id, actor),
      fiscalAdminApi.getProductionProfile(link.fiscal_api_company_id, actor), fiscalAdminApi.listAudit(link.fiscal_api_company_id, actor, {
        page: Math.max(1, Number(query.audit_page) || 1), action: query.audit_action, actor: query.audit_actor,
        from: query.audit_from ? new Date(`${query.audit_from}T00:00:00`).toISOString() : undefined,
        to: query.audit_to ? new Date(`${query.audit_to}T23:59:59`).toISOString() : undefined
      }), fiscalAdminApi.listCertificateAlerts(link.fiscal_api_company_id, actor)
    ]);
    if (resources[0].status === "fulfilled") company = resources[0].value.data;
    if (resources[1].status === "fulfilled") businessUnits = resources[1].value.data;
    if (resources[2].status === "fulfilled") devices = resources[2].value.data;
    if (resources[3].status === "fulfilled") operators = resources[3].value.data;
    if (resources[4].status === "fulfilled") certificates = resources[4].value.data;
    if (resources[5].status === "fulfilled") activation = resources[5].value.data;
    if (resources[6].status === "fulfilled") productionProfile = resources[6].value.data;
    if (resources[7].status === "fulfilled") audit = resources[7].value.data;
    if (resources[8].status === "fulfilled") alerts = resources[8].value.data;
  }
  const readiness = link?.last_readiness_result as { isReady?: boolean; issues?: Array<{ code: string; message: string }> } | null;
  const hiddenFirma = <input type="hidden" name="firma_id" value={firma.id} />;
  const activationStatus = String(activation?.status ?? "");
  const controlTestAllowed = Boolean(readiness?.isReady) && link?.fiscal_environment === "Test" && !["TestPassed", "ProductionActive"].includes(activationStatus);
  const controlTestUnit = businessUnits.find((x) => x.isActive), controlTestDevice = devices.find((x) => x.isActive && x.businessUnitId === controlTestUnit?.id), controlTestOperator = operators.find((x) => x.isActive);
  const message = query.poruka ? messages[query.poruka] ?? `Fiscal API: ${query.poruka}` : null;

  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Fiskalna firma</p><h2>{firma.naziv}</h2><p>{firma.agencija.is_fiscal_direct_container ? "Direktan klijent" : firma.agencija.naziv} · PIB {firma.pib || "nije unesen"}</p></div><Link className="table-link" href="/admin/fiskalizacija">Nazad</Link></header>
    {message ? <p className="admin-message">{message}{query.correlation ? ` Correlation ID: ${query.correlation}` : ""}</p> : null}
    <section className="metric-grid"><div className="metric"><span>Onboarding</span><strong>{link?.onboarding_status || "NOT_CONFIGURED"}</strong></div><div className="metric"><span>Okruženje</span><strong>{link?.fiscal_environment || "-"}</strong></div><div className="metric"><span>Pristup</span><strong>{link?.is_suspended ? "Suspendovan" : "Dozvoljen"}</strong></div></section>

    {!link?.fiscal_api_company_id ? <section className="admin-form-section"><h3>Poveži firmu sa Fiscal API-jem</h3><p>Onboarding uvijek počinje u testnom okruženju.</p><form className="admin-form" action={onboardFiscalCompany}>{hiddenFirma}<label><span>Kod softvera PU</span><input name="software_code" required /></label><label><span>Kod održavaoca</span><input name="maintainer_code" required /></label><button type="submit">Kreiraj fiskalni profil</button></form></section> : <>
      <section className="admin-form-section"><h3>Fiskalni identitet firme</h3><p>PIB se ne mijenja ovom rutom. Promjena identiteta je auditovana i zahtijeva kontrolni tekst.</p><form className="admin-form" action={updateFiscalIdentity}>{hiddenFirma}<label><span>Puni naziv</span><input name="legal_name" defaultValue={company?.legalName ?? firma.naziv} required /></label><label><span>Skraćeni naziv</span><input name="short_name" defaultValue={company?.shortName ?? firma.skraceni_naziv ?? ""} /></label><label><span>Adresa</span><input name="address" defaultValue={company?.address ?? firma.adresa ?? ""} /></label><label><span>Grad</span><input name="town" defaultValue={company?.town ?? firma.grad ?? firma.opstina ?? ""} /></label><label><span>Država</span><input name="country" defaultValue={company?.country ?? "MNE"} required /></label><label><span><input type="checkbox" name="is_vat_payer" value="true" defaultChecked={company?.isVatPayer ?? firma.pdv_obveznik} /> PDV obveznik</span></label><label><span>Upiši UPDATE_FISCAL_IDENTITY:{firma.pib}:{link.fiscal_api_company_id}</span><input name="confirmation" required /></label><button type="submit">Sačuvaj fiskalni identitet</button></form></section>

      <ResourceSection title="Poslovne jedinice" create={<form className="admin-form" action={createFiscalBusinessUnit}>{hiddenFirma}<label><span>PU kod</span><input name="code" required /></label><label><span>Naziv</span><input name="name" required /></label><label><span>Adresa</span><input name="address" /></label><label><span>Grad</span><input name="town" /></label><button>Dodaj jedinicu</button></form>}>
        {businessUnits.map((x) => <details key={x.id}><summary>{x.name} ({x.code}) · {x.isActive ? "Aktivna" : "Neaktivna"}</summary><form className="admin-form" action={updateFiscalBusinessUnit}>{hiddenFirma}<input type="hidden" name="resource_id" value={x.id} /><label><span>PU kod</span><input name="code" defaultValue={x.code} required /></label><label><span>Naziv</span><input name="name" defaultValue={x.name} required /></label><label><span>Adresa</span><input name="address" defaultValue={x.address ?? ""} /></label><label><span>Grad</span><input name="town" defaultValue={x.town ?? ""} /></label><button>Sačuvaj</button></form><ToggleForm firmaId={firma.id} resourceId={x.id} active={!x.isActive} action={toggleFiscalBusinessUnit} /></details>)}
      </ResourceSection>

      <ResourceSection title="ENU uređaji" create={<form className="admin-form" action={createFiscalDevice}>{hiddenFirma}<UnitSelect units={businessUnits} /><label><span>TCR/ENU kod</span><input name="tcr_code" required /></label><label><span>Interna oznaka</span><input name="internal_code" required /></label><button>Dodaj ENU</button></form>}>
        {devices.map((x) => <details key={x.id}><summary>{x.internalCode} ({x.tcrCode || "bez TCR-a"}) · {x.isActive ? "Aktivan" : "Neaktivan"}</summary><p>Registracija: {x.registrationStatus ?? "-"}</p><form className="admin-form" action={updateFiscalDevice}>{hiddenFirma}<input type="hidden" name="resource_id" value={x.id} /><UnitSelect units={businessUnits} selected={x.businessUnitId} /><label><span>TCR/ENU kod</span><input name="tcr_code" defaultValue={x.tcrCode ?? ""} /></label><label><span>Interna oznaka</span><input name="internal_code" defaultValue={x.internalCode} required /></label><button>Sačuvaj</button></form><ToggleForm firmaId={firma.id} resourceId={x.id} active={!x.isActive} action={toggleFiscalDevice} /></details>)}
      </ResourceSection>

      <ResourceSection title="Fiskalni operateri" create={<form className="admin-form" action={createFiscalOperator}>{hiddenFirma}<label><span>PU kod operatera</span><input name="operator_code" required /></label><label><span>Ime</span><input name="first_name" /></label><label><span>Prezime</span><input name="last_name" /></label><button>Dodaj operatera</button></form>}>
        {operators.map((x) => <details key={x.id}><summary>{`${x.firstName ?? ""} ${x.lastName ?? ""}`.trim() || "Operater"} ({x.operatorCode}) · {x.isActive ? "Aktivan" : "Neaktivan"}</summary><form className="admin-form" action={updateFiscalOperator}>{hiddenFirma}<input type="hidden" name="resource_id" value={x.id} /><label><span>PU kod</span><input name="operator_code" defaultValue={x.operatorCode} required /></label><label><span>Ime</span><input name="first_name" defaultValue={x.firstName ?? ""} /></label><label><span>Prezime</span><input name="last_name" defaultValue={x.lastName ?? ""} /></label><button>Sačuvaj</button></form><ToggleForm firmaId={firma.id} resourceId={x.id} active={!x.isActive} action={toggleFiscalOperator} /></details>)}
      </ResourceSection>

      <section className="admin-form-section"><h3>Elektronski pečati / sertifikati</h3><p>PFX/P12 i lozinka se neposredno šalju šifrovanom API vaultu.</p><form className="admin-form" action={uploadFiscalCertificate}>{hiddenFirma}<label><span>PFX/P12 (do 5 MB)</span><input name="file" type="file" accept=".pfx,.p12" required /></label><label><span>Lozinka</span><input name="password" type="password" autoComplete="new-password" required /></label><button>Sigurno pošalji</button></form>{certificates.map((x) => <details key={x.id}><summary>{x.fileName} · {x.isActive ? "Aktivan" : "Neaktivan"} · važi do {new Date(x.validTo).toLocaleDateString("sr-Latn-ME")}</summary><p><strong>Serijski broj:</strong> {x.serialNumber || "-"}</p><p><strong>Thumbprint:</strong> <code>{x.thumbprint}</code></p><p><strong>Subject:</strong> {x.subject}</p><p><strong>Izdavalac:</strong> {x.issuer}</p><p><strong>Važenje:</strong> {new Date(x.validFrom).toLocaleString("sr-Latn-ME")} — {new Date(x.validTo).toLocaleString("sr-Latn-ME")}</p><form action={x.isActive ? deactivateFiscalCertificate : activateFiscalCertificate}>{hiddenFirma}<input type="hidden" name="certificate_id" value={x.id} /><button>{x.isActive ? "Deaktiviraj sertifikat" : "Aktiviraj sertifikat"}</button></form></details>)}</section>

      <section className="admin-panel"><div className="panel-header"><h3>Readiness</h3><span>{readiness?.isReady ? "Spremna" : "Nije spremna"}</span></div>{readiness?.issues?.length ? <ul>{readiness.issues.map((x) => <li key={x.code}><strong>{x.code}</strong>: {x.message}</li>)}</ul> : <p>{readiness?.isReady ? "Sve kontrole su prošle." : "Provjera još nije izvršena."}</p>}<form action={refreshFiscalReadiness}>{hiddenFirma}<button>Osvježi readiness</button></form></section>

      <section className="admin-form-section"><h3>Kontrolni testni račun</h3><p>API status: <strong>{activationStatus || "Nije učitan"}</strong>. Kreira testnu uslugu od 1,00 €, fiskalizuje je i potvrđuje test samo nakon JIKR-a.</p><p>Koristi: <strong>{controlTestUnit?.name ?? "nema jedinice"}</strong> · <strong>{controlTestDevice?.internalCode ?? "nema ENU-a"}</strong> · <strong>{controlTestOperator?.operatorCode ?? "nema operatera"}</strong></p><form action={fiscalizeAndConfirmControlTest}>{hiddenFirma}<input type="hidden" name="idempotency_key" value={`control-test:${firma.id}:${randomUUID()}`} /><button disabled={!controlTestAllowed}>Fiskalizuj 1,00 € i potvrdi test</button></form><details><summary>Ručna potvrda ranijeg testa</summary><form className="admin-form" action={confirmFiscalTest}>{hiddenFirma}<label><span>ID računa</span><input name="invoice_id" required /></label><label><span>CONFIRM_TEST:{firma.pib}</span><input name="confirmation" required /></label><button>Potvrdi test</button></form></details></section>

      <section className="admin-form-section"><h3>Kompletan produkcioni profil</h3><p>Čuvanje profila ne uključuje produkciju.</p><form className="admin-form" action={configureFiscalProductionProfile}>{hiddenFirma}<label><span>Kod proizvođača</span><input name="producer_code" defaultValue={String(productionProfile?.producerCode ?? "")} required /></label><label><span>Naziv softvera</span><input name="software_name" defaultValue={String(productionProfile?.softwareName ?? "Summa Fiscal")} required /></label><label><span>Verzija</span><input name="software_version" defaultValue={String(productionProfile?.softwareVersion ?? "1.0")} required /></label><label><span>Produkcioni kod softvera</span><input name="software_code" defaultValue={String(productionProfile?.softwareCode ?? "")} required /></label><label><span>Kod održavaoca</span><input name="maintainer_code" defaultValue={String(productionProfile?.maintainerCode ?? "")} required /></label><label><span><input name="is_software_certified" type="checkbox" value="true" defaultChecked={productionProfile?.isSoftwareCertified ?? true} /> Softver je sertifikovan</span></label><label><span>Kod poslovne jedinice</span><input name="business_unit_code" defaultValue={productionProfile?.businessUnit?.code ?? ""} required /></label><label><span>Naziv jedinice</span><input name="business_unit_name" defaultValue={productionProfile?.businessUnit?.name ?? firma.naziv} required /></label><label><span>Adresa</span><input name="business_unit_address" defaultValue={productionProfile?.businessUnit?.address ?? firma.adresa ?? ""} /></label><label><span>Grad</span><input name="business_unit_town" defaultValue={productionProfile?.businessUnit?.town ?? firma.grad ?? firma.opstina ?? ""} /></label><label><span>PU kod operatera</span><input name="operator_code" defaultValue={productionProfile?.operator?.operatorCode ?? ""} required /></label><label><span>Ime</span><input name="operator_first_name" defaultValue={productionProfile?.operator?.firstName ?? ""} /></label><label><span>Prezime</span><input name="operator_last_name" defaultValue={productionProfile?.operator?.lastName ?? ""} /></label><button>Sačuvaj produkcioni profil</button></form></section>

      <section className="admin-form-section"><h3>Aktivacija okruženja</h3><form className="admin-form" action={activateFiscalProduction}>{hiddenFirma}<label><span>ACTIVATE_PRODUCTION:{firma.pib}</span><input name="confirmation" required /></label><button>Aktiviraj produkciju</button></form><form className="admin-form" action={returnFiscalCompanyToTest}>{hiddenFirma}<label><span>RETURN_TO_TEST:{firma.pib}</span><input name="confirmation" required /></label><button>Vrati u test</button></form></section>
      <section className="admin-form-section"><h3>Registracija produkcionog ENU-a</h3><p>Trenutni TCR: <strong>{String(productionProfile?.device?.tcrCode ?? "nije registrovan")}</strong></p><form className="admin-form" action={registerFiscalProductionEnu}>{hiddenFirma}<label><span>Interna oznaka</span><input name="internal_code" required /></label><label><span>Važi od</span><input name="valid_from" type="date" required /></label><label><span>REGISTER_PRODUCTION_ENU:{firma.pib}:&lt;OZNAKA&gt;</span><input name="confirmation" required /></label><button>Registruj ENU</button></form></section>

      <section className="admin-panel"><div className="panel-header"><h3>Upozorenja sertifikata</h3><span>{alerts.filter((x) => !x.isAcknowledged).length} otvoreno</span></div>{alerts.length ? alerts.map((x) => <div key={x.id}><p>Sertifikat važi do {x.certificateValidTo ? new Date(x.certificateValidTo).toLocaleDateString("sr-Latn-ME") : "-"} · prag {x.thresholdDays ?? "?"} dana · {x.isAcknowledged ? "Obrađeno" : "Otvoreno"}</p>{!x.isAcknowledged ? <form action={acknowledgeFiscalCertificateAlert}>{hiddenFirma}<input type="hidden" name="alert_id" value={x.id} /><button>Označi kao obrađeno</button></form> : null}</div>) : <p>Nema upozorenja.</p>}</section>

      <section className="admin-panel"><div className="panel-header"><h3>Fiskalni audit</h3><span>{audit?.totalCount ?? 0} zapisa</span></div><form className="admin-form" method="get"><label><span>Akcija</span><input name="audit_action" defaultValue={query.audit_action ?? ""} /></label><label><span>Administrator/aplikacija</span><input name="audit_actor" defaultValue={query.audit_actor ?? ""} /></label><label><span>Od</span><input type="date" name="audit_from" defaultValue={query.audit_from ?? ""} /></label><label><span>Do</span><input type="date" name="audit_to" defaultValue={query.audit_to ?? ""} /></label><button>Filtriraj</button></form><div className="table-wrap"><table><thead><tr><th>Vrijeme</th><th>Akcija</th><th>Actor</th><th>Correlation ID</th></tr></thead><tbody>{audit?.items.map((x, i) => <tr key={x.id ?? i}><td>{x.occurredAt ? new Date(x.occurredAt).toLocaleString("sr-Latn-ME") : "-"}</td><td>{x.action}</td><td>{x.actor || "-"}</td><td><code>{x.correlationId || "-"}</code></td></tr>)}</tbody></table></div><div className="admin-actions">{audit && audit.page > 1 ? <Link className="table-link" href={auditHref(query, audit.page - 1)}>Prethodna</Link> : null}{audit && audit.page * audit.pageSize < audit.totalCount ? <Link className="table-link" href={auditHref(query, audit.page + 1)}>Sljedeća</Link> : null}</div></section>

      <section className="admin-form-section"><h3>{link.is_suspended ? "Ponovna aktivacija" : "Globalna suspenzija"}</h3><p>{link.is_suspended ? `Razlog: ${link.suspension_reason || "nije naveden"}` : "Deaktivira firmu za sve aplikacije."}</p><form className="admin-form" action={setFiscalSuspension}>{hiddenFirma}<input type="hidden" name="suspend" value={String(!link.is_suspended)} />{!link.is_suspended ? <label><span>Razlog</span><input name="reason" required /></label> : null}<button>{link.is_suspended ? "Ponovo aktiviraj" : "Suspenduj fiskalizaciju"}</button></form></section>
      <section className="admin-panel"><p>Fiscal API Company ID: <code>{link.fiscal_api_company_id}</code></p></section>
    </>}
  </div>;
}

function ResourceSection({ title, create, children }: { title: string; create: React.ReactNode; children: React.ReactNode }) {
  return <section className="admin-form-section"><h3>{title}</h3>{create}<div className="admin-stack">{children}</div></section>;
}

function UnitSelect({ units, selected }: { units: FiscalBusinessUnit[]; selected?: string }) {
  return <label><span>Poslovna jedinica</span><select name="business_unit_id" defaultValue={selected ?? ""} required><option value="">Izaberi</option>{units.map((x) => <option key={x.id} value={x.id}>{x.name} — {x.code}{x.isActive ? "" : " (neaktivna)"}</option>)}</select></label>;
}

function ToggleForm({ firmaId, resourceId, active, action }: { firmaId: string; resourceId: string; active: boolean; action: (formData: FormData) => Promise<void> }) {
  return <form action={action}><input type="hidden" name="firma_id" value={firmaId} /><input type="hidden" name="resource_id" value={resourceId} /><input type="hidden" name="active" value={String(active)} /><button>{active ? "Aktiviraj" : "Deaktiviraj"}</button></form>;
}

function auditHref(query: Query, page: number) {
  const params = new URLSearchParams();
  params.set("audit_page", String(page));
  if (query.audit_action) params.set("audit_action", query.audit_action);
  if (query.audit_actor) params.set("audit_actor", query.audit_actor);
  if (query.audit_from) params.set("audit_from", query.audit_from);
  if (query.audit_to) params.set("audit_to", query.audit_to);
  return `?${params}`;
}
