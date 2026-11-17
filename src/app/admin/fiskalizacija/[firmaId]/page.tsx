import Link from "next/link";
import { randomUUID } from "crypto";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { fiscalAdminApi, FiscalAdminApiError, type FiscalActivation, type FiscalAuditPage, type FiscalBusinessUnit, type FiscalCertificate, type FiscalCertificateAlert, type FiscalCompany, type FiscalDevice, type FiscalOperator, type FiscalProductionProfile } from "@/lib/fiscal-admin-api";
import { fiscalActivationLabel, fiscalEnvironmentLabel, fiscalOnboardingLabel } from "@/lib/fiscal-admin-status";
import { FISCAL_CONTROL_TEST_FAILURE } from "@/lib/fiscal-control-test";
import { FISCAL_DEVICE_ID_PATTERN, FISCAL_TCR_PATTERN } from "@/lib/fiscal-production-enu";
import { FISCAL_SETUP_STEPS, SUMMA_FISCAL_SOFTWARE, fiscalSetupProgress, selectFiscalTestResources, type FiscalSetupStep } from "@/lib/fiscal-setup";
import { prisma } from "@/lib/prisma";
import { acknowledgeFiscalCertificateAlert, activateFiscalCertificate, activateFiscalProduction, configureFiscalProductionProfile, confirmFiscalTest, createFiscalBusinessUnit, createFiscalDevice, createFiscalOperator, deactivateFiscalCertificate, fiscalizeAndConfirmControlTest, linkExistingFiscalProductionEnu, onboardFiscalCompany, refreshFiscalReadiness, registerFiscalProductionEnu, returnFiscalCompanyToTest, setFiscalSuspension, toggleFiscalBusinessUnit, toggleFiscalDevice, toggleFiscalOperator, updateFiscalBusinessUnit, updateFiscalDevice, updateFiscalIdentity, updateFiscalOperator, updateFiscalTestCodes, uploadFiscalCertificate } from "../actions";

import { SepPrefill, SepSetupImport } from "./sep-import";
import styles from "./setup.module.css";

type Query = { korak?: string; prikaz?: string; poruka?: string; correlation?: string; enu_retry?: string; audit_page?: string; audit_action?: string; audit_actor?: string; audit_from?: string; audit_to?: string };
type Props = { params: Promise<{ firmaId: string }>; searchParams?: Promise<Query> };

const messages: Record<string, string> = {
  PRODUKCIONI_ENU_POVEZAN: "Postojeći ENU je povezan sa produkcionim profilom i aktivan je.",
  PRODUKCIONI_ENU_NEISPRAVAN_UNOS: "Unesite ENU kod i internu oznaku tačno kako su prikazani na produkcionom SEP-u.",
  PRODUKCIONI_ENU_NEDOSTUPNO: "Postojeći produkcioni ENU se povezuje dok je firma u testnom okruženju i ima dozvoljen fiskalni pristup.",
  PRODUKCIONA_JEDINICA_PROMIJENJENA: "Produkcioni profil je promijenjen. Provjerite poslovnu jedinicu i ponovite povezivanje.",
  PRODUKCIONI_ENU_VEC_POSTOJI: "Produkcioni profil već ima drugi aktivan ENU. Povezivanje nije zamijenilo uređaj.",
  PRODUKCIONI_ENU_PODACI_SE_NE_POKLAPAJU: "Podaci ne odgovaraju sačuvanom ENU-u. Provjerite njegov kod, internu oznaku i poslovnu jedinicu.",
  PRODUKCIONI_ENU_AKTIVAN_U_TESTU: "Taj ENU je aktivan u testnom okruženju. Provjerite da li ste prepisali kod iz produkcionog SEP-a.",
  PRODUKCIONI_ENU_PROVJERA_NIJE_PROSLA: "Fiscal API još ne prikazuje ovaj ENU kao aktivan u produkcionom profilu.",
  PRODUCTION_TCR_REQUIRED: "Prije aktivacije produkcije povežite postojeći ENU sa produkcionog SEP-a ili registrujte novi.",
  CONTROL_TEST_REQUIRED: "Prvo potvrdite kontrolni test sa trenutnim testnim podešavanjima.",
  BUSINESS_UNIT_HAS_ACTIVE_DEVICES: "Poslovna jedinica ima aktivan ENU. Prvo deaktivirajte uređaj koji joj pripada ako se više ne koristi.",
  PRODUCTION_PROFILE_NOT_FOUND: "Prvo sačuvajte kompletan produkcioni profil.",
  FISCAL_DEVICE_CODE_CONFLICT: "ENU sa ovim kodom već postoji. Provjerite kod i vezu sa poslovnom jedinicom.",
  KLIJENT_KREIRAN: "Fiskalni klijent je dodat. Provjerite popunjene kodove i povežite ga sa Fiscal API-jem.",
  CONTROL_TEST_AUTOMATSKI_POTVRDJEN: "Kontrolna usluga od 1,00 € je fiskalizovana u testu, dobila je JIKR i test je potvrđen.",
  CONTROL_TEST_INVALID: "Kontrolni test nema ispravan idempotency ključ.", CONTROL_TEST_CONFIGURATION_MISSING: "Nedostaje aktivna testna poslovna jedinica, ENU ili operater.",
  CONTROL_TEST_NOT_FISCALIZED: "Fiskalizacija kontrolnog računa nije potvrđena.", PRODUCTION_PROFILE_REQUIRED_FIELDS: "Popunite obavezna polja produkcionog profila.",
  COMPANY_NOT_READY: "Podešavanja firme trenutno ne prolaze provjeru spremnosti.",
  TEST_ENVIRONMENT_REQUIRED: "Kontrolni račun može se poslati samo u testnom okruženju.",
  FISCAL_STATE_CHANGED: "Podešavanja firme su promijenjena tokom provjere. Osvježite spremnost ponovo.",
  PRODUKCIONI_PROFIL_SACUVAN: "Produkcioni profil je sačuvan.", KLIJENT_KREIRAN_EMAIL_GRESKA: "Klijent je dodat, ali pozivnica nije poslata.",
  FIRMA_VEC_POSTOJI: "Firma sa tim PIB-om već postoji.", FIRMA_POVEZANA: "Firma je povezana sa Fiscal API-jem.", READINESS_OSVJEZEN: "Provjera spremnosti je osvježena.",
  FIRMA_SUSPENDOVANA: "Fiskalizacija je suspendovana.", FIRMA_AKTIVIRANA: "Firma je ponovo aktivirana.", FIRMA_ILI_PIB_NEDOSTAJE: "Firma nije pronađena ili nema PIB.",
  KODOVI_NEDOSTAJU: "Kod softvera i održavaoca su obavezni.", FIRMA_NIJE_POVEZANA: "Firma nije povezana sa Fiscal API-jem.", RAZLOG_OBAVEZAN: "Razlog suspenzije je obavezan.",
  TEST_KODOVI_SACUVANI: "Testni kodovi su sačuvani.",
  TEST_KODOVI_NEDOSTUPNI: "Testne kodove možete izmijeniti kada je firma aktivna u testnom okruženju.",
  FISCAL_API_NOT_CONFIGURED: "Serverska veza sa Fiscal API-jem nije podešena.", FISCAL_API_UNAVAILABLE: "Fiscal API trenutno nije dostupan.", FISCAL_API_GRESKA: "Fiscal API operacija nije uspjela.",
  JEDINICA_DODATA: "Poslovna jedinica je dodata.", JEDINICA_SACUVANA: "Poslovna jedinica je izmijenjena.", JEDINICA_STATUS_SACUVAN: "Status poslovne jedinice je promijenjen.",
  ENU_DODAT: "ENU uređaj je dodat.", ENU_SACUVAN: "ENU uređaj je izmijenjen.", ENU_STATUS_SACUVAN: "Status ENU uređaja je promijenjen.",
  OPERATER_DODAT: "Operater je dodat.", OPERATER_SACUVAN: "Operater je izmijenjen.", OPERATER_STATUS_SACUVAN: "Status operatera je promijenjen.",
  SERTIFIKAT_DODAT: "Sertifikat je bezbjedno proslijeđen Fiscal API-ju.", SERTIFIKAT_AKTIVIRAN: "Sertifikat je aktiviran.", SERTIFIKAT_DEAKTIVIRAN: "Sertifikat je deaktiviran.",
  CERT_UPLOAD_INVALID_FILE: "Izaberite PFX/P12 fajl do 5 MB i unesite lozinku.", TEST_POTVRDJEN: "Kontrolni test je potvrđen.", PRODUKCIJA_AKTIVIRANA: "Produkcioni režim je aktiviran.",
  CERT_UPLOAD_EXPIRED: "Sertifikat je istekao. Izaberite važeći sertifikat za ovu firmu.",
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
  const showAll = query.prikaz === "sve";
  const baseHref = `/admin/fiskalizacija/${firma.id}`;
  const controlTestFailed = query.poruka === "CONTROL_TEST_NOT_FISCALIZED";
  const correlationId = typeof query.correlation === "string" ? query.correlation : undefined;
  const controlTestFailure = controlTestFailed && correlationId
    ? prisma.auditLog.findFirst({
      where: {
        agencija_id: firma.agencija_id,
        firma_id: firma.id,
        modul: "admin.fiskalizacija",
        akcija: FISCAL_CONTROL_TEST_FAILURE,
        nova_vrijednost: { path: ["correlationId"], equals: correlationId }
      },
      orderBy: { created_at: "desc" },
      select: { napomena: true }
    }).catch(() => null)
    : null;
  let company: FiscalCompany | null = null, businessUnits: FiscalBusinessUnit[] = [], devices: FiscalDevice[] = [], operators: FiscalOperator[] = [], certificates: FiscalCertificate[] = [];
  let activation: FiscalActivation | null = null, productionProfile: FiscalProductionProfile | null = null, audit: FiscalAuditPage | null = null, alerts: FiscalCertificateAlert[] = [];
  let retryEnu: FiscalDevice | undefined;
  let setupUnavailable = false;
  let productionProfileMissing = false;
  if (link?.fiscal_api_company_id) {
    const actor = { id: admin.id, name: admin.korisnicko_ime };
    const resources = await Promise.allSettled([
      fiscalAdminApi.getCompany(link.fiscal_api_company_id, actor), fiscalAdminApi.listBusinessUnits(link.fiscal_api_company_id, actor),
      fiscalAdminApi.listDevices(link.fiscal_api_company_id, actor), fiscalAdminApi.listOperators(link.fiscal_api_company_id, actor),
      fiscalAdminApi.listCertificates(link.fiscal_api_company_id, actor), fiscalAdminApi.getActivation(link.fiscal_api_company_id, actor),
      fiscalAdminApi.getProductionProfile(link.fiscal_api_company_id, actor), showAll ? fiscalAdminApi.listAudit(link.fiscal_api_company_id, actor, {
        page: Math.max(1, Number(query.audit_page) || 1), action: query.audit_action, actor: query.audit_actor,
        from: query.audit_from ? new Date(`${query.audit_from}T00:00:00`).toISOString() : undefined,
        to: query.audit_to ? new Date(`${query.audit_to}T23:59:59`).toISOString() : undefined
      }) : null, showAll ? fiscalAdminApi.listCertificateAlerts(link.fiscal_api_company_id, actor) : null
    ]);
    if (resources[0].status === "fulfilled") company = resources[0].value.data;
    if (resources[1].status === "fulfilled") businessUnits = resources[1].value.data;
    if (resources[2].status === "fulfilled") devices = resources[2].value.data;
    if (resources[3].status === "fulfilled") operators = resources[3].value.data;
    if (resources[4].status === "fulfilled") certificates = resources[4].value.data;
    if (resources[5].status === "fulfilled") activation = resources[5].value.data;
    const profileResult = resources[6];
    if (profileResult.status === "fulfilled") {
      productionProfile = profileResult.value.data;
      productionProfileMissing = productionProfile === null;
    } else {
      productionProfileMissing = profileResult.reason instanceof FiscalAdminApiError && profileResult.reason.code === "PRODUCTION_PROFILE_NOT_FOUND";
    }
    if (resources[7].status === "fulfilled") audit = resources[7].value?.data ?? null;
    if (resources[8].status === "fulfilled") alerts = resources[8].value?.data ?? [];
    setupUnavailable = resources.slice(0, 6).some((result) => result.status === "rejected") || !company || !activation ||
      company.environment !== activation.environment ||
      (profileResult.status === "rejected" && !productionProfileMissing);
    if (query.enu_retry && FISCAL_DEVICE_ID_PATTERN.test(query.enu_retry) &&
        company?.environment === "Test" && productionProfile?.businessUnit && !productionProfile.device) {
      const id = query.enu_retry;
      const known = devices.find((x) => x.id === id);
      const retry = known ?? (await fiscalAdminApi.getDevice(link.fiscal_api_company_id, id, actor).catch(() => null))?.data;
      if (retry?.companyId === link.fiscal_api_company_id && !retry.isActive && retry.registrationStatus === "Registered" &&
          (known || retry.businessUnitId === productionProfile.businessUnit.id)) retryEnu = retry;
    }
  }
  const readiness = activation ?? (link?.last_readiness_result as { isReady?: boolean; issues?: Array<{ code: string; message: string }> } | null);
  const test = selectFiscalTestResources(businessUnits, devices, operators);
  const progress = fiscalSetupProgress({ pib: firma.pib, name: firma.naziv, company, activation, test, certificates, productionProfile, requested: query.korak, suspended: link?.is_suspended, now: Date.now() });
  const step = FISCAL_SETUP_STEPS[progress.index];
  const hiddenFirma = <><input type="hidden" name="firma_id" value={firma.id} />{showAll
    ? <input type="hidden" name="prikaz" value="sve" />
    : <input type="hidden" name="korak" value={step.id} />}</>;
  const stepHref = (id: FiscalSetupStep) => `${baseHref}?korak=${id}`;
  const show = (id: FiscalSetupStep) => showAll || (!setupUnavailable && !progress.productionActive && step.id === id);
  const sepStorageKey = `fiscal-sep:${admin.id}:${firma.id}:${firma.pib}`;
  const prefill = (section: Parameters<typeof SepPrefill>[0]["section"]) => showAll ? null :
    <SepPrefill key={`${sepStorageKey}:${section}`} storageKey={sepStorageKey} section={section}
      units={section === "enu" ? test.units.filter(unit => unit.isActive).map(({ id, code }) => ({ id, code })) : undefined}
      unitCode={section === "produkcioni-enu" ? productionProfile?.businessUnit?.code : undefined} />;
  const shownUnits = showAll ? businessUnits : test.units;
  const shownDevices = showAll ? devices : test.devices;
  const shownOperators = showAll ? operators : test.operators;
  const activationStatus = activation?.status;
  const controlTestAllowed = Boolean(readiness?.isReady) && activation?.environment === "Test" &&
    !link?.is_suspended && Boolean(test.unit && test.device && test.operator) && (activationStatus === "NotTested" || activationStatus === "RetestRequired");
  const productionUnit = productionProfile?.businessUnit;
  const productionEnu = productionProfile?.device;
  const productionSoftware = productionProfile ?? (productionProfileMissing ? SUMMA_FISCAL_SOFTWARE.production : null);
  const canLinkProductionEnu = company?.environment === "Test" && company.isActive && !link?.is_suspended &&
    productionUnit?.environment === "Production" && productionUnit.isActive && !productionEnu;
  const message = typeof query.poruka === "string" && query.poruka
    ? Object.hasOwn(messages, query.poruka) ? messages[query.poruka] : `Fiscal API: ${query.poruka}`
    : null;
  const controlTestReason = (await controlTestFailure)?.napomena;

  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">{showAll ? "Fiskalna firma" : "Podešavanje fiskalizacije"}</p><h2>{firma.naziv}</h2><p>{firma.agencija.is_fiscal_direct_container ? "Direktan klijent" : firma.agencija.naziv} · PIB {firma.pib || "nije unesen"}</p></div><div className="admin-actions"><Link className="table-link" href={showAll ? baseHref : `${baseHref}?prikaz=sve`}>{showAll ? "Otvori vodič" : "Sva podešavanja"}</Link><Link className="table-link" href="/admin/fiskalizacija/korisnici">Fiskalni klijenti</Link></div></header>
    {message ? <p role={controlTestFailed ? "alert" : undefined} className={controlTestFailed ? "status-banner error" : "admin-message"}>{message}
      {controlTestFailed ? <><br />{controlTestReason ?? "Za ovaj pokušaj nije sačuvan detaljan razlog."}</> : null}
      {correlationId ? <><br />Correlation ID: <code>{correlationId}</code></> : null}
    </p> : null}
    <section className="metric-grid">
      <div className="metric"><span>Status fiskalizacije</span><strong className="metric-text">{fiscalOnboardingLabel(link, activation)}</strong></div>
      <div className="metric"><span>Okruženje</span><strong className="metric-text">{fiscalEnvironmentLabel(activation?.environment ?? link?.fiscal_environment)}</strong></div>
      <div className="metric"><span>Pristup</span><strong className="metric-text">{link?.is_suspended ? "Suspendovan" : "Dozvoljen"}</strong></div>
    </section>

    {!showAll && (progress.productionActive && company?.environment === "Production" ? <section className="admin-panel"><h3>Produkcija je aktivirana</h3><p>Vodič je završen. Za izmjene, provjeru sertifikata i pregled aktivnosti otvorite sva podešavanja.</p><ProductionSummary profile={productionProfile} /></section>
      : setupUnavailable ? <section className="admin-panel"><h3>Provjera podešavanja nije dostupna</h3><p>Osvježite stranicu da vodič provjeri sačuvane podatke prije nastavka.</p><a className="table-link" href={query.korak ? stepHref(step.id) : baseHref}>Osvježi stranicu</a></section>
      : <section className={`admin-panel ${styles.guide}`} aria-labelledby="fiscal-step-heading">
        <nav aria-label="Koraci podešavanja fiskalizacije"><ol className={styles.steps}>
          {FISCAL_SETUP_STEPS.map(({ id, title }, index) => {
            const state = index === progress.index ? "current" : index > progress.available ? "locked" : id !== "sep" && progress.complete[id] ? "complete" : "available";
            const label = <><span className={styles.stepNumber} aria-hidden="true">{state === "complete" ? "✓" : index + 1}</span><span>{title}</span>{state === "complete" ? <span className={styles.srOnly}> (završeno)</span> : state === "locked" ? <span className={styles.srOnly}> (zaključano)</span> : null}</>;
            return <li className={styles.step} data-state={state} key={id}>{index <= progress.available && index !== progress.index
              ? <Link href={stepHref(id)}>{label}</Link>
              : <span className={styles.stepLabel} aria-current={state === "current" ? "step" : undefined}>{label}</span>}</li>;
          })}
        </ol></nav>
        <div className={styles.instruction}>
          <p className="eyebrow">Korak {progress.index + 1} od {FISCAL_SETUP_STEPS.length}</p>
          <h3 id="fiscal-step-heading">{step.title}</h3><p>{step.help}</p>
          {["softver", "jedinica", "enu", "operater"].includes(step.id) ? <a href="https://efitest.tax.gov.me/self-care/" target="_blank" rel="noreferrer">Otvori testni SEP ↗</a> : null}
          {["produkcioni-profil", "produkcioni-enu"].includes(step.id) ? <a href="https://sep.tax.gov.me/self-care/" target="_blank" rel="noreferrer">Otvori produkcioni SEP ↗</a> : null}
        </div>
      </section>)}

    {!showAll && show("sep") ? <SepSetupImport key={sepStorageKey} firmaId={firma.id} storageKey={sepStorageKey} hasFiscalProfile={Boolean(company)} /> : null}
    {!link?.fiscal_api_company_id ? <>
      {show("firma") && !showAll ? <section className="admin-panel">
        <dl className={styles.summary}>
          <div><dt>Naziv</dt><dd>{firma.naziv}</dd></div>
          <div><dt>PIB</dt><dd>{firma.pib || "Nije unesen"}</dd></div>
          <div><dt>Adresa</dt><dd>{[firma.adresa, firma.grad ?? firma.opstina].filter(Boolean).join(", ") || "Nije unesena"}</dd></div>
          <div><dt>PDV obveznik</dt><dd>{firma.pdv_obveznik ? "Da" : "Ne"}</dd></div>
        </dl>
        <p>Ako podaci nijesu tačni, ispravite ih u matičnim podacima firme prije nastavka.</p>
      </section> : null}
      {show("softver") ? <section className="admin-form-section"><h3>Poveži firmu sa Fiscal API-jem</h3><p>Povezivanje otvara fiskalni profil u testnom okruženju.</p>
        <TestSoftwareForm fields={hiddenFirma} prefill={prefill("novi-profil")} identity={showAll ? undefined : <>
          <label><span>Puni naziv</span><input name="legal_name" defaultValue={firma.naziv} required /></label>
          <label><span>Skraćeni naziv</span><input name="short_name" defaultValue={firma.skraceni_naziv ?? ""} /></label>
          <label><span>Adresa</span><input name="address" defaultValue={firma.adresa ?? ""} /></label>
          <label><span>Grad</span><input name="town" defaultValue={firma.grad ?? firma.opstina ?? ""} /></label>
          <label><span><input type="checkbox" name="is_vat_payer" value="true" defaultChecked={firma.pdv_obveznik} /> PDV obveznik</span></label>
        </>} />
      </section> : null}
    </> : <>
      {show("firma") ? <section className="admin-form-section"><h3>Fiskalni identitet firme</h3><p>PIB se ne mijenja ovom rutom. Promjena identiteta je auditovana i zahtijeva kontrolni tekst.</p><form className="admin-form" action={updateFiscalIdentity}>{hiddenFirma}{prefill("firma")}<label><span>Puni naziv</span><input name="legal_name" defaultValue={company?.legalName ?? firma.naziv} required /></label><label><span>Skraćeni naziv</span><input name="short_name" defaultValue={company?.shortName ?? firma.skraceni_naziv ?? ""} /></label><label><span>Adresa</span><input name="address" defaultValue={company?.address ?? firma.adresa ?? ""} /></label><label><span>Grad</span><input name="town" defaultValue={company?.town ?? firma.grad ?? firma.opstina ?? ""} /></label><label><span>Država</span><input name="country" defaultValue={company?.country ?? "MNE"} required /></label><label><span><input type="checkbox" name="is_vat_payer" value="true" defaultChecked={company?.isVatPayer ?? firma.pdv_obveznik} /> PDV obveznik</span></label><label><span>Upiši UPDATE_FISCAL_IDENTITY:{firma.pib}:{link.fiscal_api_company_id}</span><input name="confirmation" required /></label><button type="submit">Sačuvaj fiskalni identitet</button></form></section> : null}

      {!showAll && show("softver") && company?.environment === "Test" ? <section className="admin-form-section">
        <h3>Kodovi iz testnog SEP-a</h3><TestSoftwareForm fields={hiddenFirma} company={company} />
      </section> : null}

      {show("jedinica") ? <ResourceSection title="Poslovne jedinice" create={<form className="admin-form" action={createFiscalBusinessUnit}>{hiddenFirma}{prefill("jedinica")}<label><span>PU kod</span><input name="code" required /></label><label><span>Naziv</span><input name="name" required /></label><label><span>Adresa</span><input name="address" /></label><label><span>Grad</span><input name="town" /></label><button>Dodaj jedinicu</button></form>}>
        {shownUnits.map((x) => <details key={x.id}><summary>{x.name} ({x.code}) · {x.isActive ? "Aktivna" : "Neaktivna"}</summary><form className="admin-form" action={updateFiscalBusinessUnit}>{hiddenFirma}<input type="hidden" name="resource_id" value={x.id} /><label><span>PU kod</span><input name="code" defaultValue={x.code} required /></label><label><span>Naziv</span><input name="name" defaultValue={x.name} required /></label><label><span>Adresa</span><input name="address" defaultValue={x.address ?? ""} /></label><label><span>Grad</span><input name="town" defaultValue={x.town ?? ""} /></label><button>Sačuvaj</button></form><ToggleForm fields={hiddenFirma} resourceId={x.id} active={!x.isActive} action={toggleFiscalBusinessUnit} /></details>)}
      </ResourceSection> : null}

      {show("enu") ? <ResourceSection title="ENU uređaji" create={<form className="admin-form" action={createFiscalDevice}>{hiddenFirma}{prefill("enu")}<UnitSelect units={shownUnits.filter((unit) => unit.isActive)} selected={!showAll ? test.unit?.id : undefined} /><label><span>TCR/ENU kod</span><input name="tcr_code" required /></label><label><span>Interna oznaka</span><input name="internal_code" required /></label><button>Dodaj ENU</button></form>}>
        {shownDevices.map((x) => <details key={x.id}><summary>{x.internalCode} ({x.tcrCode || "bez TCR-a"}) · {x.isActive ? "Aktivan" : "Neaktivan"}</summary><p>Registracija: {x.registrationStatus ?? "-"}</p><form className="admin-form" action={updateFiscalDevice}>{hiddenFirma}<input type="hidden" name="resource_id" value={x.id} /><UnitSelect units={shownUnits} selected={x.businessUnitId} /><label><span>TCR/ENU kod</span><input name="tcr_code" defaultValue={x.tcrCode ?? ""} /></label><label><span>Interna oznaka</span><input name="internal_code" defaultValue={x.internalCode} required /></label><button>Sačuvaj</button></form><ToggleForm fields={hiddenFirma} resourceId={x.id} active={!x.isActive} action={toggleFiscalDevice} /></details>)}
      </ResourceSection> : null}

      {show("operater") ? <ResourceSection title="Fiskalni operateri" create={<form className="admin-form" action={createFiscalOperator}>{hiddenFirma}{prefill("operater")}<label><span>PU kod operatera</span><input name="operator_code" required /></label><label><span>Ime</span><input name="first_name" /></label><label><span>Prezime</span><input name="last_name" /></label><button>Dodaj operatera</button></form>}>
        {shownOperators.map((x) => <details key={x.id}><summary>{`${x.firstName ?? ""} ${x.lastName ?? ""}`.trim() || "Operater"} ({x.operatorCode}) · {x.isActive ? "Aktivan" : "Neaktivan"}</summary><form className="admin-form" action={updateFiscalOperator}>{hiddenFirma}<input type="hidden" name="resource_id" value={x.id} /><label><span>PU kod</span><input name="operator_code" defaultValue={x.operatorCode} required /></label><label><span>Ime</span><input name="first_name" defaultValue={x.firstName ?? ""} /></label><label><span>Prezime</span><input name="last_name" defaultValue={x.lastName ?? ""} /></label><button>Sačuvaj</button></form><ToggleForm fields={hiddenFirma} resourceId={x.id} active={!x.isActive} action={toggleFiscalOperator} /></details>)}
      </ResourceSection> : null}

      {show("sertifikat") ? <section className="admin-form-section"><h3>Elektronski pečati / sertifikati</h3><p>PFX/P12 i lozinka se neposredno šalju šifrovanom API vaultu.</p><form className="admin-form" action={uploadFiscalCertificate}>{hiddenFirma}<label><span>PFX/P12 (do 5 MB)</span><input name="file" type="file" accept=".pfx,.p12" required /></label><label><span>Lozinka</span><input name="password" type="password" autoComplete="new-password" required /></label><button>Sigurno pošalji</button></form>{certificates.map((x) => <details key={x.id}><summary>{x.fileName} · {x.isActive ? "Aktivan" : "Neaktivan"} · važi do {new Date(x.validTo).toLocaleDateString("sr-Latn-ME")}</summary><p><strong>Serijski broj:</strong> {x.serialNumber || "-"}</p><p><strong>Thumbprint:</strong> <code>{x.thumbprint}</code></p><p><strong>Subject:</strong> {x.subject}</p><p><strong>Izdavalac:</strong> {x.issuer}</p><p><strong>Važenje:</strong> {new Date(x.validFrom).toLocaleString("sr-Latn-ME")} — {new Date(x.validTo).toLocaleString("sr-Latn-ME")}</p><form action={x.isActive ? deactivateFiscalCertificate : activateFiscalCertificate}>{hiddenFirma}<input type="hidden" name="certificate_id" value={x.id} /><button>{x.isActive ? "Deaktiviraj sertifikat" : "Aktiviraj sertifikat"}</button></form></details>)}</section> : null}

      {show("test") ? <>
      <section className="admin-panel">
        <div className="panel-header"><h3>Provjera spremnosti</h3><span>{readiness?.isReady === undefined ? "Nije provjerena" : readiness.isReady ? "Spremna" : "Nije spremna"}</span></div>
        {readiness?.issues?.length ? <ul>{readiness.issues.map((x) => <li key={x.code}><strong>{x.code}</strong>: {x.message}</li>)}</ul> : <p>{readiness?.isReady ? "Provjere podešavanja su prošle. Ishod kontrolnog računa prikazan je zasebno." : readiness?.isReady === false ? "Provjere podešavanja nijesu prošle." : "Rezultat provjere nije dostupan."}</p>}
        <form action={refreshFiscalReadiness}>{hiddenFirma}<button>Osvježi provjeru</button></form>
      </section>

      <section className="admin-form-section">
        <h3>Kontrolni testni račun</h3>
        <p>Status: <strong>{fiscalActivationLabel(activationStatus)}</strong>. Kreira testnu uslugu od 1,00 €, fiskalizuje je i potvrđuje test samo nakon JIKR-a.</p>
        {progress.complete.test ? <p>Potvrđen JIKR: <code>{activation?.testJikr}</code></p> : null}
        {activation?.environment === "Test" ? <p>Koristi: <strong>{test.unit ? `${test.unit.name} (${test.unit.code})` : "nema jedinice"}</strong> · <strong>{test.device ? `${test.device.internalCode} (${test.device.tcrCode})` : "nema ENU-a"}</strong> · <strong>{test.operator?.operatorCode ?? "nema operatera"}</strong></p> : null}
        <form action={fiscalizeAndConfirmControlTest}>{hiddenFirma}<input type="hidden" name="idempotency_key" value={`control-test:${firma.id}:${randomUUID()}`} /><button disabled={!controlTestAllowed}>Fiskalizuj 1,00 € i potvrdi test</button></form>
        {showAll || controlTestAllowed ? <details><summary>Ručna potvrda ranijeg testa</summary><form className="admin-form" action={confirmFiscalTest}>{hiddenFirma}<label><span>ID računa</span><input name="invoice_id" required /></label><label><span>CONFIRM_TEST:{firma.pib}</span><input name="confirmation" required /></label><button>Potvrdi test</button></form></details> : null}
      </section>
      </> : null}

      {show("produkcioni-profil") ? <section className="admin-form-section">
        <h3>Kompletan produkcioni profil</h3>
        {productionProfileMissing ? <p>Podaci za Summa Fiscal su unaprijed popunjeni. Dodajte poslovnu jedinicu i operatera za ovu firmu.</p> : null}
        <p>Čuvanje profila ne uključuje produkciju.</p>
        <form className="admin-form" action={configureFiscalProductionProfile}>
          {hiddenFirma}{prefill("produkcioni-profil")}
          <label><span>Kod proizvođača</span><input name="producer_code" defaultValue={productionSoftware?.producerCode ?? ""} required /></label>
          <label><span>Naziv softvera</span><input name="software_name" defaultValue={productionSoftware?.softwareName ?? ""} required /></label>
          <label><span>Verzija</span><input name="software_version" defaultValue={productionSoftware?.softwareVersion ?? ""} required /></label>
          <label><span>Produkcioni kod softvera</span><input name="software_code" defaultValue={productionSoftware?.softwareCode ?? ""} required /></label>
          <label><span>Kod održavaoca</span><input name="maintainer_code" defaultValue={productionSoftware?.maintainerCode ?? ""} required /></label>
          <label><span><input name="is_software_certified" type="checkbox" value="true" defaultChecked={productionSoftware?.isSoftwareCertified ?? false} /> Softver je sertifikovan</span></label>
          <label><span>Kod poslovne jedinice</span><input name="business_unit_code" defaultValue={productionUnit?.code ?? ""} required /></label>
          <label><span>Naziv jedinice</span><input name="business_unit_name" defaultValue={productionUnit?.name ?? firma.naziv} required /></label>
          <label><span>Adresa</span><input name="business_unit_address" defaultValue={productionUnit?.address ?? firma.adresa ?? ""} /></label>
          <label><span>Grad</span><input name="business_unit_town" defaultValue={productionUnit?.town ?? firma.grad ?? firma.opstina ?? ""} /></label>
          <label><span>PU kod operatera</span><input name="operator_code" defaultValue={productionProfile?.operator?.operatorCode ?? ""} required /></label>
          <label><span>Ime</span><input name="operator_first_name" defaultValue={productionProfile?.operator?.firstName ?? ""} /></label>
          <label><span>Prezime</span><input name="operator_last_name" defaultValue={productionProfile?.operator?.lastName ?? ""} /></label>
          <button>Sačuvaj produkcioni profil</button>
        </form>
      </section> : null}

      {show("produkcioni-enu") ? <section className="admin-form-section" id="produkcioni-enu">
        <h3>Produkcioni ENU</h3>
        {productionUnit ? <p>Poslovna jedinica: <strong>{productionUnit.name} ({productionUnit.code})</strong></p> :
          <p>Sačuvajte produkcioni profil da bi aplikacija mogla da učita poslovnu jedinicu.</p>}
        {productionEnu ? <p>Povezani ENU: <strong>{productionEnu.internalCode} · {productionEnu.tcrCode ?? "bez TCR koda"}</strong></p> : null}
        {!showAll && productionEnu && !progress.complete["produkcioni-enu"] ? <p>Provjerite status uređaja u <Link href={`${baseHref}?prikaz=sve#produkcioni-enu`}>svim podešavanjima</Link>. Za nastavak je potreban aktivan i registrovan ENU iz ove produkcione jedinice.</p> : null}
        {canLinkProductionEnu && productionUnit ? <>
          <p>Ako ste ENU već registrovali na produkcionom SEP-u za ovu poslovnu jedinicu, prepišite njegova polja <strong>Kod</strong> i <strong>Interna oznaka ENU</strong>.</p>
          {retryEnu ? <p>Povezivanje nije potvrđeno. Ponovite ga sa istim podacima.</p> : null}
          <form className="admin-form" action={linkExistingFiscalProductionEnu}>
            {hiddenFirma}
            {prefill("produkcioni-enu")}
            <input type="hidden" name="business_unit_id" value={productionUnit.id} />
            <input type="hidden" name="business_unit_code" value={productionUnit.code} />
            {retryEnu ? <input type="hidden" name="retry_device_id" value={retryEnu.id} /> : null}
            <label><span>ENU kod iz SEP-a</span><input name="tcr_code" pattern={FISCAL_TCR_PATTERN} maxLength={10} defaultValue={retryEnu?.tcrCode ?? ""} required /></label>
            <label><span>Interna oznaka iz SEP-a</span><input name="internal_code" defaultValue={retryEnu?.internalCode ?? ""} required /></label>
            <button type="submit">Poveži postojeći ENU</button>
          </form>
          <details>
            <summary>Registruj novi produkcioni ENU</summary>
            <p>Koristite ovu opciju ako uređaj još nije registrovan u SEP-u.</p>
            <form className="admin-form" action={registerFiscalProductionEnu}>
              {hiddenFirma}
              <label><span>Interna oznaka</span><input name="internal_code" required /></label>
              <label><span>Važi od</span><input name="valid_from" type="date" required /></label>
              <label><span>REGISTER_PRODUCTION_ENU:{firma.pib}:&lt;OZNAKA&gt;</span><input name="confirmation" required /></label>
              <button type="submit">Registruj novi ENU</button>
            </form>
          </details>
        </> : null}
      </section> : null}
      {show("aktivacija") ? <section className="admin-form-section">
        <h3>Aktivacija okruženja</h3>
        {!showAll ? <><ProductionSummary profile={productionProfile} /><p>Aktivacija prebacuje firmu u produkciju. Ovaj korak ne šalje račun.</p></> : null}
        <form className="admin-form" action={activateFiscalProduction}>{hiddenFirma}<label><span>ACTIVATE_PRODUCTION:{firma.pib}</span><input name="confirmation" required /></label><button disabled={!showAll && !progress.canActivate}>Aktiviraj produkciju</button></form>
        {showAll ? <form className="admin-form" action={returnFiscalCompanyToTest}>{hiddenFirma}<label><span>RETURN_TO_TEST:{firma.pib}</span><input name="confirmation" required /></label><button>Vrati u test</button></form> : null}
      </section> : null}

      {showAll ? <>
      <section className="admin-panel"><div className="panel-header"><h3>Upozorenja sertifikata</h3><span>{alerts.filter((x) => !x.isAcknowledged).length} otvoreno</span></div>{alerts.length ? alerts.map((x) => <div key={x.id}><p>Sertifikat važi do {x.certificateValidTo ? new Date(x.certificateValidTo).toLocaleDateString("sr-Latn-ME") : "-"} · prag {x.thresholdDays ?? "?"} dana · {x.isAcknowledged ? "Obrađeno" : "Otvoreno"}</p>{!x.isAcknowledged ? <form action={acknowledgeFiscalCertificateAlert}>{hiddenFirma}<input type="hidden" name="alert_id" value={x.id} /><button>Označi kao obrađeno</button></form> : null}</div>) : <p>Nema upozorenja.</p>}</section>

      <section className="admin-panel"><div className="panel-header"><h3>Fiskalni audit</h3><span>{audit?.totalCount ?? 0} zapisa</span></div><form className="admin-form" method="get"><input type="hidden" name="prikaz" value="sve" /><label><span>Akcija</span><input name="audit_action" defaultValue={query.audit_action ?? ""} /></label><label><span>Administrator/aplikacija</span><input name="audit_actor" defaultValue={query.audit_actor ?? ""} /></label><label><span>Od</span><input type="date" name="audit_from" defaultValue={query.audit_from ?? ""} /></label><label><span>Do</span><input type="date" name="audit_to" defaultValue={query.audit_to ?? ""} /></label><button>Filtriraj</button></form><div className="table-wrap"><table><thead><tr><th>Vrijeme</th><th>Akcija</th><th>Actor</th><th>Correlation ID</th></tr></thead><tbody>{audit?.items.map((x, i) => <tr key={x.id ?? i}><td>{x.occurredAt ? new Date(x.occurredAt).toLocaleString("sr-Latn-ME") : "-"}</td><td>{x.action}</td><td>{x.actor || "-"}</td><td><code>{x.correlationId || "-"}</code></td></tr>)}</tbody></table></div><div className="admin-actions">{audit && audit.page > 1 ? <Link className="table-link" href={auditHref(query, audit.page - 1)}>Prethodna</Link> : null}{audit && audit.page * audit.pageSize < audit.totalCount ? <Link className="table-link" href={auditHref(query, audit.page + 1)}>Sljedeća</Link> : null}</div></section>

      <section className="admin-form-section"><h3>{link.is_suspended ? "Ponovna aktivacija" : "Globalna suspenzija"}</h3><p>{link.is_suspended ? `Razlog: ${link.suspension_reason || "nije naveden"}` : "Deaktivira firmu za sve aplikacije."}</p><form className="admin-form" action={setFiscalSuspension}>{hiddenFirma}<input type="hidden" name="suspend" value={String(!link.is_suspended)} />{!link.is_suspended ? <label><span>Razlog</span><input name="reason" required /></label> : null}<button>{link.is_suspended ? "Ponovo aktiviraj" : "Suspenduj fiskalizaciju"}</button></form></section>
      <section className="admin-panel"><p>Fiscal API Company ID: <code>{link.fiscal_api_company_id}</code></p></section>
      </> : null}
    </>}
    {!showAll && !setupUnavailable && !progress.productionActive ? <section className={`admin-panel ${styles.navigation}`} aria-label="Kretanje kroz podešavanje">
      {progress.index > 0 ? <Link className="table-link" href={stepHref(FISCAL_SETUP_STEPS[progress.index - 1].id)}>← Nazad</Link> : null}
      <p>{step.id === "sep" ? "Ako SEP ne vrati podatke, možeš nastaviti ručno." : progress.index < FISCAL_SETUP_STEPS.length - 1 ? progress.complete[step.id]
        ? "Korak je završen. Ako ste nešto izmijenili, prvo sačuvajte promjene."
        : "Završite ovaj korak da biste mogli da nastavite."
        : link?.is_suspended ? "Fiskalni pristup je suspendovan. Otvorite sva podešavanja za ponovnu aktivaciju." : "Posljednji korak: potvrdite aktivaciju kada budete spremni."}</p>
      {progress.index < FISCAL_SETUP_STEPS.length - 1
        ? progress.index < progress.available
          ? <Link className="primary-link" prefetch={step.id === "sep" ? false : undefined} href={stepHref(FISCAL_SETUP_STEPS[progress.index + 1].id)}>Dalje →</Link>
          : <button className={`primary-link ${styles.disabled}`} type="button" disabled>Dalje →</button>
        : null}
    </section> : null}
  </div>;
}

function TestSoftwareForm({ fields, company, prefill, identity }: { fields: React.ReactNode; company?: FiscalCompany; prefill?: React.ReactNode; identity?: React.ReactNode }) {
  const defaults = SUMMA_FISCAL_SOFTWARE.test;
  const useDefaults = !company?.softwareCode?.trim() && !company?.maintainerCode?.trim();
  const software = useDefaults ? defaults : company;
  return <>
    {useDefaults ? <p>Unaprijed popunjeno za {defaults.softwareName} · {defaults.softwareVersion}. Kod proizvođača u testnom SEP-u: <strong>{defaults.producerCode}</strong>.</p> : null}
    <form className="admin-form" action={company ? updateFiscalTestCodes : onboardFiscalCompany}>
      {fields}{prefill}{identity}
      <label><span>Kod verzije softvera</span><input name="software_code" defaultValue={software?.softwareCode ?? ""} required /></label>
      <label><span>Kod održavaoca</span><input name="maintainer_code" defaultValue={software?.maintainerCode ?? ""} required /></label>
      <button type="submit">{company ? "Sačuvaj testne kodove" : "Kreiraj fiskalni profil"}</button>
    </form>
  </>;
}

function ProductionSummary({ profile }: { profile: FiscalProductionProfile | null }) {
  if (!profile) return null;
  return <dl className={styles.summary}>
    <div><dt>Poslovna jedinica</dt><dd>{profile.businessUnit?.name ?? "—"}{profile.businessUnit ? ` (${profile.businessUnit.code})` : ""}</dd></div>
    <div><dt>ENU</dt><dd>{profile.device?.internalCode ?? "—"}{profile.device?.tcrCode ? ` (${profile.device.tcrCode})` : ""}</dd></div>
    <div><dt>Operater</dt><dd>{profile.operator?.operatorCode ?? "—"}</dd></div>
  </dl>;
}

function ResourceSection({ title, create, children }: { title: string; create: React.ReactNode; children: React.ReactNode }) {
  return <section className="admin-form-section"><h3>{title}</h3>{create}<div className="admin-stack">{children}</div></section>;
}

function UnitSelect({ units, selected }: { units: FiscalBusinessUnit[]; selected?: string }) {
  return <label><span>Poslovna jedinica</span><select name="business_unit_id" defaultValue={selected ?? ""} required><option value="">Izaberi</option>{units.map((x) => <option key={x.id} value={x.id}>{x.name} — {x.code}{x.isActive ? "" : " (neaktivna)"}</option>)}</select></label>;
}

function ToggleForm({ fields, resourceId, active, action }: { fields: React.ReactNode; resourceId: string; active: boolean; action: (formData: FormData) => Promise<void> }) {
  return <form action={action}>{fields}<input type="hidden" name="resource_id" value={resourceId} /><input type="hidden" name="active" value={String(active)} /><button>{active ? "Aktiviraj" : "Deaktiviraj"}</button></form>;
}

function auditHref(query: Query, page: number) {
  const params = new URLSearchParams({ prikaz: "sve" });
  params.set("audit_page", String(page));
  if (query.audit_action) params.set("audit_action", query.audit_action);
  if (query.audit_actor) params.set("audit_actor", query.audit_actor);
  if (query.audit_from) params.set("audit_from", query.audit_from);
  if (query.audit_to) params.set("audit_to", query.audit_to);
  return `?${params}`;
}
