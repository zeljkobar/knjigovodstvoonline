import Link from "next/link";
import { saveDefaultCompanyAccount } from "../../actions";
import {
  defaultAccountPurposes,
  invoicePostingDefaultScope,
  invoicePostingDocumentTypes,
  mergeCompanyAccountPlan
} from "@/lib/account-plan";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type PageProps = {
  searchParams?: Promise<{
    firma?: string;
    poruka?: string;
  }>;
};

const messages: Record<string, string> = {
  default_sacuvan: "Podrazumijevano konto je sačuvano.",
  default_konto_nevalidan: "Izabrano konto nije aktivno u kontnom planu firme.",
  default_greska: "Podrazumijevano konto nije sačuvano. Provjerite podatke."
};

export default async function DefaultAccountsSettingsPage({ searchParams }: PageProps) {
  const user = await requireRole("admin_agencije");
  const context = await readWorkContext();
  const params = await searchParams;

  if (!user.agencija_id) {
    return null;
  }

  const companies = await prisma.firma.findMany({
    where: {
      agencija_id: user.agencija_id,
      is_deleted: false,
      aktivan: true
    },
    orderBy: { naziv: "asc" },
    select: { id: true, naziv: true, pib: true }
  });
  const requestedCompanyId = params?.firma ?? context.firmaId ?? "";
  const company =
    companies.find((item) => item.id === requestedCompanyId) ?? companies[0] ?? null;

  const [baseAccounts, companyOverrides, defaults] = company
    ? await Promise.all([
        prisma.konto.findMany({
          where: { aktivan: true },
          orderBy: { sifra: "asc" },
          select: {
            id: true,
            sifra: true,
            naziv: true,
            klasa: true,
            tip_konta: true,
            analitika_obavezna: true,
            sinteticki_konto: true,
            normalni_saldo: true,
            koristi_radnu_jedinicu: true,
            aktivan: true
          }
        }),
        prisma.firmaKonto.findMany({
          where: { firma_id: company.id },
          orderBy: { sifra: "asc" },
          select: {
            id: true,
            konto_id: true,
            sifra: true,
            naziv: true,
            tip_konta: true,
            analitika_obavezna: true,
            sinteticki_konto: true,
            normalni_saldo: true,
            koristi_radnu_jedinicu: true,
            override_type: true,
            napomena: true,
            aktivan: true
          }
        }),
        prisma.firmaPodrazumijevanoKonto.findMany({
          where: {
            firma_id: company.id,
            namjena: { in: defaultAccountPurposes.map(([purpose]) => purpose) },
            dokument_tip: invoicePostingDocumentTypes.general,
            podvrsta: invoicePostingDefaultScope.subtype,
            pdv_stopa_sifra: invoicePostingDefaultScope.vatRate
          },
          select: { namjena: true, sifra_konta: true }
        })
      ])
    : [[], [], []];
  const accounts = mergeCompanyAccountPlan(baseAccounts, companyOverrides).filter(
    (account) => account.aktivan
  );
  const defaultsByPurpose = new Map(
    defaults.map((account) => [account.namjena, account.sifra_konta])
  );
  const message = params?.poruka ? messages[params.poruka] : null;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h1>Podrazumijevana konta</h1>
          <p className="muted-text">
            Konta za zbirne izvještaje kupaca i dobavljača.
          </p>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Firma</h3>
          <span>{company ? `${defaults.length} / 4 podešeno` : "Nema firmi"}</span>
        </div>
        <form
          action="/agencija/podesavanja/podrazumijevana-konta"
          className="compact-form account-filter-form"
        >
          <label>
            <span>Izabrana firma</span>
            <select defaultValue={company?.id ?? ""} name="firma">
              {companies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.naziv}{item.pib ? ` (${item.pib})` : ""}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Prikaži</button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Konta partnera</h3>
          <span>Samo za izvještaje</span>
        </div>
        <p className="muted-text">
          Ova konta određuju koje će se stavke prikazivati u izvještajima Kupci i
          Dobavljači. Ne koriste se u šemama automatskog knjiženja.
        </p>

        {company ? (
          <div className="default-account-grid">
            {defaultAccountPurposes.map(([purpose, label]) => (
              <form
                action={saveDefaultCompanyAccount}
                className="default-account-card"
                key={purpose}
              >
                <input name="firma_id" type="hidden" value={company.id} />
                <input name="namjena" type="hidden" value={purpose} />
                <label>
                  <span>{label}</span>
                  <select
                    defaultValue={defaultsByPurpose.get(purpose) ?? ""}
                    name="sifra_konta"
                    required
                  >
                    <option value="">Izaberite konto</option>
                    {accounts.map((account) => (
                      <option key={`${purpose}-${account.sifra}`} value={account.sifra}>
                        {account.sifra} - {account.naziv}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit">Sačuvaj</button>
              </form>
            ))}
          </div>
        ) : (
          <p className="empty-state">Nema aktivnih firmi za podešavanje.</p>
        )}
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Povezani izvještaji</h3>
        </div>
        <div className="button-row">
          <Link className="secondary-button" href="/agencija/izvjestaji/kupci">
            Otvori kupce
          </Link>
          <Link className="secondary-button" href="/agencija/izvjestaji/dobavljaci">
            Otvori dobavljače
          </Link>
        </div>
      </section>
    </div>
  );
}
