import Link from "next/link";
import {
  createCompanyCustomAccount,
  deactivateCompanyAccount,
  restoreCompanyAccount,
  saveCompanyAccountOverride,
  saveDefaultCompanyAccount
} from "../../actions";
import {
  defaultAccountPurposes,
  mergeCompanyAccountPlan
} from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type KontniPlanPageProps = {
  searchParams?: Promise<{
    poruka?: string;
    firma?: string;
    q?: string;
  }>;
};

const poruke: Record<string, string> = {
  konto_kreiran: "Specificno konto je dodato za firmu.",
  konto_sacuvan: "Izmjena konta je sacuvana.",
  konto_deaktiviran: "Konto je deaktivirano za firmu.",
  konto_vracen: "Konto je vraceno u upotrebu.",
  konto_obavezno: "Sifra i naziv konta su obavezni.",
  konto_postoji: "Konto sa ovom sifrom vec postoji. Za osnovno konto koristite izmjenu naziva.",
  konto_tip_nevalidan: "Tip konta nije validan.",
  konto_greska: "Kontni plan nije sacuvan. Provjerite podatke.",
  default_sacuvan: "Podrazumijevano konto je sacuvano.",
  default_konto_nevalidan: "Izabrano konto nije aktivno u kontnom planu firme.",
  default_greska: "Podrazumijevano konto nije sacuvano."
};

function accountTypeLabel(tip: string) {
  return tip === "sinteticko" ? "Sinteticko" : "Analiticko";
}

export default async function KontniPlanPage({ searchParams }: KontniPlanPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const params = await searchParams;
  const message = params?.poruka ? poruke[params.poruka] : null;
  const selectedCompanyId = params?.firma ?? "";
  const query = (params?.q ?? "").trim().toLowerCase();
  const canManage = user.rola === "admin_agencije";

  if (!user.agencija_id) {
    return null;
  }

  const firme = await prisma.firma.findMany({
    where: {
      agencija_id: user.agencija_id,
      is_deleted: false,
      aktivan: true,
      ...(canManage
        ? {}
        : {
            korisnici: {
              some: {
                korisnik_id: user.id,
                is_deleted: false
              }
            }
          })
    },
    orderBy: {
      naziv: "asc"
    },
    select: {
      id: true,
      naziv: true,
      pib: true
    }
  });
  const selectedCompany = firme.find((firma) => firma.id === selectedCompanyId) ?? firme[0];

  const [baseAccounts, companyOverrides, defaultAccounts] = selectedCompany
    ? await Promise.all([
        prisma.konto.findMany({
          where: {
            aktivan: true
          },
          orderBy: {
            sifra: "asc"
          },
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
          where: {
            firma_id: selectedCompany.id
          },
          orderBy: {
            sifra: "asc"
          },
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
            firma_id: selectedCompany.id
          },
          select: {
            id: true,
            namjena: true,
            sifra_konta: true,
            napomena: true
          }
        })
      ])
    : [[], [], []];

  const combinedAccounts = mergeCompanyAccountPlan(baseAccounts, companyOverrides);
  const filteredAccounts = query
    ? combinedAccounts.filter(
        (account) =>
          account.sifra.toLowerCase().includes(query) ||
          account.naziv.toLowerCase().includes(query)
      )
    : combinedAccounts;
  const activeAccounts = combinedAccounts.filter((account) => account.aktivan);
  const defaultAccountByPurpose = new Map(
    defaultAccounts.map((account) => [account.namjena, account])
  );

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Firme</p>
          <h2>Kontni plan</h2>
        </div>
        <Link className="table-link" href="/agencija/firme">
          Lista firmi
        </Link>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Izbor firme i pretraga</h3>
          <span>{filteredAccounts.length} konta</span>
        </div>
        <form className="compact-form account-filter-form" action="/agencija/firme/kontni-plan">
          <label>
            <span>Firma</span>
            <select name="firma" defaultValue={selectedCompany?.id ?? ""}>
              {firme.map((firma) => (
                <option key={firma.id} value={firma.id}>
                  {firma.naziv}
                  {firma.pib ? ` (${firma.pib})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Pretraga</span>
            <input name="q" placeholder="Sifra ili naziv konta" defaultValue={params?.q ?? ""} />
          </label>
          <button type="submit">Prikazi</button>
        </form>
      </section>

      {selectedCompany && canManage ? (
        <section className="admin-form-section">
          <h3>Dodaj specificno konto za firmu</h3>
          <form className="admin-form" action={createCompanyCustomAccount}>
            <input name="firma_id" type="hidden" value={selectedCompany.id} />
            <label>
              <span>Sifra konta</span>
              <input name="sifra" placeholder="npr. 2021" required />
            </label>
            <label>
              <span>Naziv konta</span>
              <input name="naziv" required />
            </label>
            <label>
              <span>Tip konta</span>
              <select name="tip_konta" defaultValue="analiticko" required>
                <option value="analiticko">Analiticko</option>
                <option value="sinteticko">Sinteticko</option>
              </select>
            </label>
            <label>
              <span>Sinteticko konto</span>
              <input name="sinteticki_konto" placeholder="opciono" />
            </label>
            <label>
              <span>Normalni saldo</span>
              <select name="normalni_saldo" defaultValue="">
                <option value="">Nije definisano</option>
                <option value="D">Duguje</option>
                <option value="P">Potrazuje</option>
              </select>
            </label>
            <label className="single-checkbox form-checkbox">
              <input name="analitika_obavezna" type="checkbox" />
              <span>Analitika obavezna</span>
            </label>
            <label className="single-checkbox form-checkbox">
              <input name="koristi_radnu_jedinicu" type="checkbox" />
              <span>Radna jedinica</span>
            </label>
            <label className="form-wide">
              <span>Napomena</span>
              <textarea name="napomena" />
            </label>
            <button type="submit">Dodaj konto</button>
          </form>
        </section>
      ) : null}

      {selectedCompany ? (
        <section className="admin-panel">
          <div className="panel-header">
            <h3>Podrazumijevana konta</h3>
            <span>{defaultAccounts.length} podeseno</span>
          </div>

          {canManage ? (
            <div className="default-account-grid">
              {defaultAccountPurposes.map(([purpose, label]) => {
                const selected = defaultAccountByPurpose.get(purpose);

                return (
                  <form key={purpose} className="default-account-card" action={saveDefaultCompanyAccount}>
                    <input name="firma_id" type="hidden" value={selectedCompany.id} />
                    <input name="namjena" type="hidden" value={purpose} />
                    <label>
                      <span>{label}</span>
                      <select name="sifra_konta" defaultValue={selected?.sifra_konta ?? ""} required>
                        <option value="">Izaberite konto</option>
                        {activeAccounts.map((account) => (
                          <option key={`${purpose}-${account.sifra}`} value={account.sifra}>
                            {account.sifra} - {account.naziv}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit">Sacuvaj</button>
                  </form>
                );
              })}
            </div>
          ) : (
            <dl className="detail-list">
              {defaultAccountPurposes.map(([purpose, label]) => {
                const selected = defaultAccountByPurpose.get(purpose);

                return (
                  <div key={purpose}>
                    <dt>{label}</dt>
                    <dd>{selected?.sifra_konta ?? "-"}</dd>
                  </div>
                );
              })}
            </dl>
          )}
        </section>
      ) : null}

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Kombinovani kontni plan firme</h3>
          <span>
            Osnovni plan + izmjene firme
            {selectedCompany ? `: ${selectedCompany.naziv}` : ""}
          </span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Sifra</th>
                <th>Naziv</th>
                <th>Tip</th>
                <th>Saldo</th>
                <th>Izvor</th>
                <th>Status</th>
                {canManage ? <th>Izmjena naziva</th> : null}
                {canManage ? <th>Akcija</th> : null}
              </tr>
            </thead>
            <tbody>
              {!selectedCompany || filteredAccounts.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 8 : 6}>Nema konta za prikaz.</td>
                </tr>
              ) : (
                filteredAccounts.map((account) => (
                  <tr key={`${account.source}-${account.id}`}>
                    <td>
                      <strong>{account.sifra}</strong>
                      <small>Klasa {account.klasa ?? account.sifra.slice(0, 1)}</small>
                    </td>
                    <td>
                      {account.naziv}
                      {account.napomena ? <small>{account.napomena}</small> : null}
                    </td>
                    <td>
                      {accountTypeLabel(account.tip_konta)}
                      {account.analitika_obavezna ? <small>Analitika obavezna</small> : null}
                      {account.koristi_radnu_jedinicu ? <small>Radna jedinica</small> : null}
                    </td>
                    <td>{account.normalni_saldo ?? "-"}</td>
                    <td>{account.sourceLabel}</td>
                    <td>{account.aktivan ? "Aktivno" : "Neaktivno"}</td>
                    {canManage ? (
                      <td>
                        <form className="table-inline-form" action={saveCompanyAccountOverride}>
                          <input name="firma_id" type="hidden" value={selectedCompany.id} />
                          {account.baseAccountId ? (
                            <input name="konto_id" type="hidden" value={account.baseAccountId} />
                          ) : null}
                          {account.companyAccountId ? (
                            <input
                              name="firma_konto_id"
                              type="hidden"
                              value={account.companyAccountId}
                            />
                          ) : null}
                          <input name="naziv" defaultValue={account.naziv} required />
                          <button className="table-button" type="submit">
                            Sacuvaj
                          </button>
                        </form>
                      </td>
                    ) : null}
                    {canManage ? (
                      <td className="table-actions">
                        {account.companyAccountId && account.source !== "base" ? (
                          <form action={restoreCompanyAccount}>
                            <input name="firma_id" type="hidden" value={selectedCompany.id} />
                            <input
                              name="firma_konto_id"
                              type="hidden"
                              value={account.companyAccountId}
                            />
                            <button className="table-button" type="submit">
                              Vrati
                            </button>
                          </form>
                        ) : null}
                        {account.aktivan ? (
                          <form action={deactivateCompanyAccount}>
                            <input name="firma_id" type="hidden" value={selectedCompany.id} />
                            {account.baseAccountId ? (
                              <input name="konto_id" type="hidden" value={account.baseAccountId} />
                            ) : null}
                            {account.companyAccountId ? (
                              <input
                                name="firma_konto_id"
                                type="hidden"
                                value={account.companyAccountId}
                              />
                            ) : null}
                            <button className="table-button" type="submit">
                              Deaktiviraj
                            </button>
                          </form>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
