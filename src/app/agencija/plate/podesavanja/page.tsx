import { Fragment } from "react";
import Link from "next/link";
import { getPlateContext, MissingPlateContext } from "../_shared";
import { savePayrollBasisRule, savePayrollPostingSettings } from "../actions";
import { mergeCompanyAccountPlan, type CombinedAccount } from "@/lib/account-plan";
import {
  isPayrollCategory,
  payrollCategories,
  payrollCategoryLabel,
  payrollCategoryOptions
} from "@/lib/payroll";
import {
  payrollPostingComponents,
  payrollPostingDefault
} from "@/lib/payroll-posting";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams?: Promise<{
    poruka?: string;
    sekcija?: string;
    kategorija?: string;
  }>;
};

function dateInput(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function percentValue(value: unknown, multiplier = 1) {
  const numeric = Number(value ?? 0) * multiplier;

  return Number.isFinite(numeric) ? numeric.toFixed(2) : "0.00";
}

function accountValue(account: CombinedAccount | undefined) {
  if (!account) {
    return "";
  }

  return account.companyAccountId
    ? `company:${account.companyAccountId}`
    : `base:${account.baseAccountId}`;
}

function AccountSelect({
  accounts,
  name,
  defaultValue
}: {
  accounts: CombinedAccount[];
  name: string;
  defaultValue: string;
}) {
  return (
    <select name={name} defaultValue={defaultValue}>
      <option value="">Nije podešeno</option>
      {accounts.map((account) => {
        const value = accountValue(account);

        return (
          <option key={value} value={value}>
            {account.sifra} - {account.naziv}
          </option>
        );
      })}
    </select>
  );
}

export default async function PayrollSettingsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const context = await getPlateContext("view");
  const activeSection =
    params?.sekcija === "ioppd" || params?.sekcija === "knjizenje"
      ? params.sekcija
      : null;
  const postingCategory =
    params?.kategorija && isPayrollCategory(params.kategorija)
      ? params.kategorija
      : payrollCategories.regularWork;

  if (!context.firma || !context.godina || !context.user.agencija_id) {
    return <MissingPlateContext title="Podešavanja plata" />;
  }

  if (!context.allowed) {
    return (
      <section className="admin-panel">
        <p className="empty-state">Nemate pravo za pregled podešavanja plata.</p>
      </section>
    );
  }

  const payrollBases =
    activeSection === "ioppd"
      ? await prisma.plateOsnovaObracuna.findMany({
          where: {
            aktivan: true
          },
          include: {
            sifre_primanja: {
              where: {
                aktivan: true,
                agencija_id: null,
                firma_id: null
              },
              orderBy: {
                sifra: "asc"
              }
            },
            pravila: {
              where: {
                aktivan: true
              },
              include: {
                stope: {
                  where: {
                    aktivan: true
                  },
                  orderBy: {
                    tip: "asc"
                  }
                }
              },
              orderBy: {
                valid_from: "desc"
              },
              take: 1
            }
          },
          orderBy: {
            sifra: "asc"
          }
        })
      : [];
  const [postingSettings, journalTypes, baseAccounts, companyAccounts] =
    activeSection === "knjizenje"
      ? await Promise.all([
          prisma.plateKontiranjePodesavanje.findUnique({
            where: {
              firma_id_poslovna_godina_id_kategorija: {
                firma_id: context.firma.id,
                poslovna_godina_id: context.godina.id,
                kategorija: postingCategory
              }
            },
            include: {
              pravila: {
                orderBy: {
                  redosljed: "asc"
                }
              }
            }
          }),
          prisma.vrstaNaloga.findMany({
            where: {
              aktivan: true,
              OR: [
                {
                  firma_id: context.firma.id
                },
                {
                  firma_id: null,
                  agencija_id: context.user.agencija_id
                },
                {
                  firma_id: null,
                  agencija_id: null
                }
              ]
            },
            orderBy: {
              sifra: "asc"
            }
          }),
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
              firma_id: context.firma.id
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
          })
        ])
      : [null, [], [], []];
  const postingAccounts = mergeCompanyAccountPlan(baseAccounts, companyAccounts).filter(
    (account) => account.aktivan
  );
  const postingRuleMap = new Map(
    postingSettings?.pravila.map((rule) => [rule.komponenta, rule]) ?? []
  );
  const defaultJournalTypeId =
    postingSettings?.vrsta_naloga_id ??
    journalTypes.find((journalType) => journalType.sifra === "PAYROLL")?.id ??
    "";

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Podešavanja plata</h2>
          <p>Izaberite grupu podešavanja koju želite da otvorite.</p>
        </div>
      </header>

      <section className="payroll-settings-menu" aria-label="Grupe podešavanja plata">
        <Link
          className={`payroll-settings-option${activeSection === "ioppd" ? " active" : ""}`}
          href="/agencija/plate/podesavanja?sekcija=ioppd"
        >
          <span className="payroll-settings-option-icon">IOPPD</span>
          <span>
            <strong>Podešavanje IOPPD šifri</strong>
            <small>Osnove za obračun, stope, rokovi i pravila po šiframa.</small>
          </span>
        </Link>
        <Link
          className={`payroll-settings-option${activeSection === "knjizenje" ? " active" : ""}`}
          href="/agencija/plate/podesavanja?sekcija=knjizenje"
        >
          <span className="payroll-settings-option-icon">K</span>
          <span>
            <strong>Podešavanje knjiženja</strong>
            <small>Vrsta naloga i konta za automatsko knjiženje obračuna.</small>
          </span>
        </Link>
      </section>

      {params?.poruka === "osnova_sacuvana" ? (
        <section className="status-banner success">Osnova za obračun je sačuvana.</section>
      ) : null}
      {params?.poruka === "osnova_nevalidna" ? (
        <section className="status-banner error">Unesite šifru, naziv i datum važenja osnove.</section>
      ) : null}
      {params?.poruka === "osnova_ne_postoji" ? (
        <section className="status-banner error">Izabrana osnova za obračun više ne postoji.</section>
      ) : null}
      {params?.poruka === "kontiranje_sacuvano" ? (
        <section className="status-banner success">Podešavanje knjiženja je sačuvano.</section>
      ) : null}
      {params?.poruka === "kontiranje_nevalidno" ? (
        <section className="status-banner error">
          Podešavanje knjiženja nije sačuvano. Provjerite kategoriju i vrstu naloga.
        </section>
      ) : null}
      {params?.poruka === "godina_zakljucena" ? (
        <section className="status-banner error">
          Poslovna godina je zaključana i podešavanja se ne mogu mijenjati.
        </section>
      ) : null}

      {activeSection === "ioppd" ? (
        <section className="admin-panel">
          <div className="panel-header">
            <div>
              <h3>Podešavanje IOPPD šifri</h3>
              <span>Osnove za obračun i pravila po IOPPD šiframa.</span>
            </div>
            <span>{payrollBases.length} aktivno</span>
          </div>
          <p className="muted-text">
            Matrica iz specifikacije povezuje IOPPD šifru sa osnovicom, stopama i rokom. Originalni red iz
            zvaničnog dokumenta se čuva uz pravilo, a strukturisana polja služe za obračun i kontrole.
          </p>
          <div className="settings-grid">
            {payrollBases.map((basis) => {
              const rule = basis.pravila[0];
              const taxRate = rule?.stope.find((rate) => rate.tip === "POREZ");

              return (
                <details className="settings-card" key={basis.id}>
                  <summary>
                    <strong>
                      {basis.sifra} - {basis.naziv}
                    </strong>
                    <span>
                      {basis.kategorija ?? "OSTALO"} / {rule?.osnovica_porez_tip ?? "bez poreza"}{" "}
                      {taxRate ? `/ porez ${percentValue(taxRate.stopa, 100)}%` : ""}
                    </span>
                  </summary>
                  <form action={savePayrollBasisRule}>
                    <input type="hidden" name="osnova_id" value={basis.id} />
                    <input type="hidden" name="pravilo_id" value={rule?.id ?? ""} />
                    <label className="checkbox-card compact">
                      <input type="checkbox" name="aktivan" defaultChecked={basis.aktivan} />
                      Aktivan
                    </label>

                    <div className="admin-form compact-form">
                      <label>
                        <span>Naziv</span>
                        <input name="naziv" defaultValue={basis.naziv} />
                      </label>
                      <label>
                        <span>Kategorija</span>
                        <input name="kategorija" defaultValue={basis.kategorija ?? ""} />
                      </label>
                      <label>
                        <span>M-4 kategorija</span>
                        <select name="m4_kategorija" defaultValue={basis.m4_kategorija}>
                          <option value="NE_ULAZI">Ne ulazi u M-4</option>
                          <option value="ZARADA_OSNOVICA">Zarada / osnovica</option>
                          <option value="NAKNADA_ZDRAVSTVENO_RODITELJSKO">
                            Naknada - zdravstvo / roditeljsko
                          </option>
                          <option value="STAZ_SA_UVECANIM_TRAJANJEM">Staž sa uvećanim trajanjem</option>
                        </select>
                      </label>
                      <label>
                        <span>Važi od</span>
                        <input type="date" name="valid_from" defaultValue={dateInput(rule?.valid_from ?? basis.valid_from)} />
                      </label>
                      <label>
                        <span>Važi do</span>
                        <input type="date" name="valid_to" defaultValue={dateInput(rule?.valid_to ?? basis.valid_to)} />
                      </label>
                      <label>
                        <span>Tip porezne osnovice</span>
                        <select name="osnovica_porez_tip" defaultValue={rule?.osnovica_porez_tip ?? ""}>
                          <option value="">Nema porezne osnovice</option>
                          <option value="BRUTO">Bruto</option>
                          <option value="NETO">Neto</option>
                          <option value="PROCENAT_BRUTO">Procenat bruto iznosa</option>
                          <option value="PROCENAT_NETO">Procenat neto iznosa</option>
                          <option value="OPISNO">Opisno pravilo</option>
                        </select>
                      </label>
                      <label>
                        <span>Osnovica poreza %</span>
                        <input
                          name="osnovica_porez_proc"
                          inputMode="decimal"
                          defaultValue={percentValue(rule?.osnovica_porez_proc)}
                        />
                      </label>
                      <label>
                        <span>Stopa poreza %</span>
                        <input name="porez_stopa" inputMode="decimal" defaultValue={percentValue(taxRate?.stopa, 100)} />
                      </label>
                      <label>
                        <span>Rok</span>
                        <input name="porez_rok" defaultValue={rule?.porez_rok ?? ""} />
                      </label>
                      <label className="form-span-2">
                        <span>Opis</span>
                        <textarea name="opis" defaultValue={basis.opis ?? ""} />
                      </label>
                      <label className="form-span-2">
                        <span>Napomena pravila</span>
                        <textarea name="napomena" defaultValue={rule?.napomena ?? ""} />
                      </label>
                      <label className="checkbox-card compact">
                        <input type="checkbox" name="pravilo_aktivan" defaultChecked={rule?.aktivan ?? true} />
                        Pravilo aktivno
                      </label>
                      <button type="submit">Sačuvaj osnovu</button>
                    </div>
                  </form>
                  {basis.sifre_primanja.length > 0 ? (
                    <div className="table-wrap payroll-basis-income-types">
                      <table>
                        <thead>
                          <tr>
                            <th>Obračunska šifra</th>
                            <th>Koeficijent</th>
                            <th>Osnovica poreza</th>
                            <th>Fond sati</th>
                          </tr>
                        </thead>
                        <tbody>
                          {basis.sifre_primanja.map((incomeType) => (
                            <tr key={incomeType.id}>
                              <td>
                                <strong>{incomeType.sifra}</strong> — {incomeType.naziv}
                              </td>
                              <td>
                                {incomeType.koeficijent_tip === "NE_PRIMJENJUJE"
                                  ? "—"
                                  : `${incomeType.obracunski_koeficijent.toString()} (${incomeType.koeficijent_tip.toLowerCase()})`}
                              </td>
                              <td>
                                {incomeType.osnovica_porez_proc_override === null
                                  ? "pravilo osnove"
                                  : `${incomeType.osnovica_porez_proc_override.toString()}%`}
                              </td>
                              <td>{incomeType.ulazi_u_fond_sati ? "Da" : "Ne"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </details>
              );
            })}
          </div>
        </section>
      ) : null}

      {activeSection === "knjizenje" ? (
        <section className="admin-panel">
          <div className="panel-header">
            <div>
              <h3>Podešavanje knjiženja</h3>
              <span>Posebna šema po kategoriji obračuna za aktivnu firmu i godinu.</span>
            </div>
            <span>
              {postingSettings
                ? `${postingSettings.pravila.filter((rule) => rule.aktivan).length} aktivno`
                : "Početni predlog"}
            </span>
          </div>
          <p className="muted-text">
            Svaka komponenta ima svoje duguje i potražuje konto. Početni predlog za redovan
            rad prati kontiranje iz stare baze, prilagođeno našem kontnom planu. Zbirne stavke
            su isključene da se iznosi ne bi knjižili dvaput.
          </p>

          <nav className="payroll-posting-categories" aria-label="Kategorije knjiženja plata">
            {payrollCategoryOptions.map((category) => (
              <Link
                className={postingCategory === category.value ? "active" : ""}
                href={`/agencija/plate/podesavanja?sekcija=knjizenje&kategorija=${category.value}`}
                key={category.value}
              >
                {category.label}
              </Link>
            ))}
          </nav>

          <form className="payroll-posting-form" action={savePayrollPostingSettings}>
            <input name="kategorija" type="hidden" value={postingCategory} />
            <div className="admin-form compact-form payroll-posting-header">
              <label>
                <span>Kategorija obračuna</span>
                <input value={payrollCategoryLabel(postingCategory)} readOnly />
              </label>
              <label>
                <span>Vrsta naloga</span>
                <select name="vrsta_naloga_id" defaultValue={defaultJournalTypeId}>
                  <option value="">Izaberite vrstu naloga</option>
                  {journalTypes.map((journalType) => (
                    <option value={journalType.id} key={journalType.id}>
                      {journalType.sifra} - {journalType.naziv}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-span-2">
                <span>Opis naloga</span>
                <input
                  name="opis_naloga"
                  defaultValue={
                    postingSettings?.opis_naloga ??
                    "Obračun {kategorija} za {mjesec}/{godina}"
                  }
                />
              </label>
            </div>

            <div className="table-wrap payroll-posting-table">
              <table>
                <thead>
                  <tr>
                    <th>Aktivno</th>
                    <th>Komponenta obračuna</th>
                    <th>Duguje</th>
                    <th>Potražuje</th>
                  </tr>
                </thead>
                <tbody>
                  {payrollPostingComponents.map((component, index) => {
                    const rule = postingRuleMap.get(component.code);
                    const defaults = payrollPostingDefault(postingCategory, component.code);
                    const previousGroup = payrollPostingComponents[index - 1]?.group;
                    const debitDefault = rule
                      ? rule.duguje_konto_id
                        ? `company:${rule.duguje_konto_id}`
                        : ""
                      : accountValue(
                          postingAccounts.find(
                            (account) => account.sifra === defaults.debitCode
                          )
                        );
                    const creditDefault = rule
                      ? rule.potrazuje_konto_id
                        ? `company:${rule.potrazuje_konto_id}`
                        : ""
                      : accountValue(
                          postingAccounts.find(
                            (account) => account.sifra === defaults.creditCode
                          )
                        );

                    return (
                      <Fragment key={component.code}>
                        {component.group !== previousGroup ? (
                          <tr className="payroll-posting-group">
                            <th colSpan={4}>{component.group}</th>
                          </tr>
                        ) : null}
                        <tr className={component.aggregate ? "payroll-posting-aggregate" : ""}>
                          <td>
                            <input
                              aria-label={`Aktiviraj ${component.label}`}
                              name={`aktivan_${component.code}`}
                              type="checkbox"
                              defaultChecked={rule?.aktivan ?? defaults.active}
                            />
                          </td>
                          <td>
                            <strong>{component.label}</strong>
                            {component.aggregate ? (
                              <small>Alternativna zbirna stavka</small>
                            ) : null}
                          </td>
                          <td>
                            <AccountSelect
                              accounts={postingAccounts}
                              name={`duguje_${component.code}`}
                              defaultValue={debitDefault}
                            />
                          </td>
                          <td>
                            <AccountSelect
                              accounts={postingAccounts}
                              name={`potrazuje_${component.code}`}
                              defaultValue={creditDefault}
                            />
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="payroll-posting-note">
              Alternativne zbirne stavke uključujte samo ako isključite odgovarajuće detaljne
              redove. Time se sprečava dvostruko knjiženje bruto iznosa ili doprinosa.
            </p>
            <button type="submit">Sačuvaj podešavanje za ovu kategoriju</button>
          </form>
        </section>
      ) : null}

      {!activeSection ? (
        <section className="admin-panel payroll-settings-placeholder">
          <p className="empty-state">Izaberite jednu grupu podešavanja iznad.</p>
        </section>
      ) : null}
    </div>
  );
}
