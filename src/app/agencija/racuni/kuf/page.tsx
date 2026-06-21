import { createKufEntry } from "../actions";
import { KufTaxLinesForm } from "@/components/KufTaxLinesForm";
import { mergeCompanyAccountPlan } from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type KufPageProps = {
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

const poruke: Record<string, string> = {
  kuf_sacuvan: "KUF red je dodat.",
  kuf_kontekst: "Izaberite aktivnu firmu i poslovnu godinu.",
  kuf_obavezno: "Dobavljac, konto troska, ukupan iznos, broj racuna, datum racuna i datum prijema su obavezni.",
  kuf_iznosi: "Provjerite osnovice i PDV iznose.",
  kuf_ukupno: "Ukupno racuna se ne slaze sa zbirom osnovica i PDV-a.",
  kuf_konto: "Konto troska mora biti aktivno analiticko konto klase 5.",
  kuf_greska: "KUF red nije sacuvan. Provjerite podatke."
};

function decimalText(value: { toString(): string }) {
  return Number(value.toString()).toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function inputDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function displayDate(date: Date) {
  return date.toLocaleDateString("sr-Latn-ME");
}

export default async function KufPage({ searchParams }: KufPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const params = await searchParams;
  const message = params?.poruka ? poruke[params.poruka] : null;
  const workContext = await readWorkContext();

  if (!user.agencija_id) {
    return null;
  }

  const activeCompany = workContext.firmaId
    ? await prisma.firma.findFirst({
        where: {
          id: workContext.firmaId,
          agencija_id: user.agencija_id,
          is_deleted: false,
          aktivan: true,
          ...(user.rola === "admin_agencije"
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
        select: {
          id: true,
          naziv: true,
          pib: true,
          pdv_obveznik: true
        }
      })
    : null;

  const activeYear =
    activeCompany && workContext.poslovnaGodinaId
      ? await prisma.poslovnaGodina.findFirst({
          where: {
            id: workContext.poslovnaGodinaId,
            firma_id: activeCompany.id
          },
          select: {
            id: true,
            godina: true,
            zakljucena: true
          }
        })
      : null;

  const [partners, vatRates, kufEntries, baseAccounts, companyOverrides] =
    activeCompany && activeYear
      ? await Promise.all([
          prisma.komitent.findMany({
            where: {
              aktivan: true,
              OR: [
                {
                  scope: "GLOBAL"
                },
                {
                  scope: "AGENCY",
                  agencija_id: user.agencija_id
                },
                {
                  scope: "COMPANY",
                  firma_id: activeCompany.id
                }
              ]
            },
            orderBy: {
              naziv: "asc"
            },
            select: {
              id: true,
              naziv: true,
              pib: true
            }
          }),
          prisma.pdvStopa.findMany({
            where: {
              agencija_id: user.agencija_id,
              aktivna: true
            },
            orderBy: [
              {
                redosljed: "asc"
              },
              {
                procenat: "desc"
              }
            ],
            select: {
              id: true,
              sifra: true,
              naziv: true,
              procenat: true
            }
          }),
          prisma.kufEntry.findMany({
            where: {
              agencija_id: user.agencija_id,
              firma_id: activeCompany.id,
              poslovna_godina_id: activeYear.id,
              is_deleted: false
            },
            orderBy: {
              redni_broj: "desc"
            },
            select: {
              id: true,
              internal_kuf_number: true,
              supplier_invoice_number: true,
              invoice_date: true,
              receipt_date: true,
              total_base: true,
              total_input_vat: true,
              deductible_vat: true,
              non_deductible_vat: true,
              total_gross: true,
              status: true,
              posting_status: true,
              note: true,
              expense_account: {
                select: {
                  sifra: true,
                  naziv: true
                }
              },
              dobavljac: {
                select: {
                  naziv: true,
                  pib: true
                }
              },
              tax_lines: {
                orderBy: {
                  vat_rate_percent: "desc"
                },
                select: {
                  id: true,
                  vat_rate_code: true,
                  vat_rate_percent: true,
                  tax_base: true,
                  input_vat_amount: true,
                  deductible_vat_amount: true,
                  non_deductible_vat_amount: true
                }
              }
            }
          }),
          prisma.konto.findMany({
            where: {
              aktivan: true,
              tip_konta: "analiticko",
              klasa: "5"
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
              firma_id: activeCompany.id,
              sifra: {
                startsWith: "5"
              }
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
      : [[], [], [], [], []];

  const expenseAccounts = mergeCompanyAccountPlan(baseAccounts, companyOverrides).filter(
    (account) =>
      account.aktivan &&
      account.tip_konta === "analiticko" &&
      account.sifra.startsWith("5")
  );

  const totalBase = kufEntries.reduce(
    (sum, entry) => sum + Number(entry.total_base.toString()),
    0
  );
  const totalVat = kufEntries.reduce(
    (sum, entry) => sum + Number(entry.total_input_vat.toString()),
    0
  );
  const totalGross = kufEntries.reduce(
    (sum, entry) => sum + Number(entry.total_gross.toString()),
    0
  );

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>KUF</h2>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      {!activeCompany || !activeYear ? (
        <section className="admin-panel">
          <h3>Izaberite firmu i godinu</h3>
          <p className="empty-state">
            KUF se vodi za aktivnu firmu i poslovnu godinu iz gornje trake.
          </p>
        </section>
      ) : (
        <>
          <section className="metric-grid">
            <div className="metric">
              <span>Firma</span>
              <strong className="metric-text">{activeCompany.naziv}</strong>
              <small>{activeCompany.pib ?? "Bez PIB-a"}</small>
            </div>
            <div className="metric">
              <span>Godina</span>
              <strong>{activeYear.godina}</strong>
              <small>{activeYear.zakljucena ? "Zaključena" : "Otvorena"}</small>
            </div>
            <div className="metric">
              <span>Ukupno KUF</span>
              <strong>{totalGross.toLocaleString("de-DE", { minimumFractionDigits: 2 })}</strong>
              <small>
                Osnovica {totalBase.toLocaleString("de-DE", { minimumFractionDigits: 2 })} ·
                PDV {totalVat.toLocaleString("de-DE", { minimumFractionDigits: 2 })}
              </small>
            </div>
          </section>

          <section className="admin-form-section">
            <div className="panel-header">
              <h3>Unos ulaznog računa</h3>
              <span>{activeCompany.pdv_obveznik ? "Firma je PDV obveznik" : "Firma nije PDV obveznik"}</span>
            </div>

            {activeYear.zakljucena ? (
              <p className="admin-message">Poslovna godina je zaključana i unos nije dozvoljen.</p>
            ) : null}

            {vatRates.length === 0 ? (
              <p className="admin-message">
                Nema aktivnih PDV stopa. Prvo ih podesite u podešavanjima.
              </p>
            ) : null}

            <form className="admin-form kuf-entry-form" action={createKufEntry}>
              <label>
                <span>Dobavljač</span>
                <select name="dobavljac_id" required disabled={activeYear.zakljucena}>
                  <option value="">Izaberite dobavljača</option>
                  {partners.map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.naziv}
                      {partner.pib ? ` (${partner.pib})` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Broj računa dobavljača</span>
                <input name="supplier_invoice_number" required disabled={activeYear.zakljucena} />
              </label>
              <label>
                <span>Datum računa</span>
                <input
                  name="invoice_date"
                  type="date"
                  defaultValue={inputDate()}
                  required
                  disabled={activeYear.zakljucena}
                />
              </label>
              <label>
                <span>Datum prijema</span>
                <input
                  name="receipt_date"
                  type="date"
                  defaultValue={inputDate()}
                  required
                  disabled={activeYear.zakljucena}
                />
              </label>
              <label>
                <span>Datum dospijeća</span>
                <input name="due_date" type="date" disabled={activeYear.zakljucena} />
              </label>
              <label>
                <span>Konto troška</span>
                <select name="expense_account_code" required disabled={activeYear.zakljucena}>
                  <option value="">Izaberite konto</option>
                  {expenseAccounts.map((account) => (
                    <option key={`${account.source}-${account.id}`} value={account.sifra}>
                      {account.sifra} - {account.naziv}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-wide">
                <span>Napomena</span>
                <input name="note" placeholder="Opis ili interna napomena" disabled={activeYear.zakljucena} />
              </label>

              <KufTaxLinesForm
                disabled={activeYear.zakljucena}
                rates={vatRates.map((rate) => ({
                  id: rate.id,
                  naziv: rate.naziv,
                  procenat: rate.procenat.toString()
                }))}
              />

              <button type="submit" disabled={activeYear.zakljucena || vatRates.length === 0}>
                Unesi u KUF
              </button>
            </form>
          </section>

          <section className="admin-panel">
            <div className="panel-header">
              <h3>Knjiga ulaznih faktura</h3>
              <span>{kufEntries.length} redova</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>KUF broj</th>
                    <th>Dobavljač</th>
                    <th>Račun</th>
                    <th>Konto troška</th>
                    <th>Datumi</th>
                    <th>Osnovica</th>
                    <th>PDV</th>
                    <th>Ukupno</th>
                    <th>Razrada</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {kufEntries.length === 0 ? (
                    <tr>
                      <td colSpan={10}>Nema unesenih KUF redova za izabranu firmu i godinu.</td>
                    </tr>
                  ) : (
                    kufEntries.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <strong>{entry.internal_kuf_number}</strong>
                          {entry.note ? <small>{entry.note}</small> : null}
                        </td>
                        <td>
                          {entry.dobavljac.naziv}
                          <small>{entry.dobavljac.pib ?? ""}</small>
                        </td>
                        <td>{entry.supplier_invoice_number}</td>
                        <td>
                          {entry.expense_account
                            ? `${entry.expense_account.sifra} - ${entry.expense_account.naziv}`
                            : "-"}
                        </td>
                        <td>
                          {displayDate(entry.invoice_date)}
                          <small>prijem {displayDate(entry.receipt_date)}</small>
                        </td>
                        <td>{decimalText(entry.total_base)}</td>
                        <td>
                          {decimalText(entry.total_input_vat)}
                          {Number(entry.non_deductible_vat.toString()) > 0 ? (
                            <small>neodbitni {decimalText(entry.non_deductible_vat)}</small>
                          ) : null}
                        </td>
                        <td>{decimalText(entry.total_gross)}</td>
                        <td>
                          {entry.tax_lines.map((line) => (
                            <small key={line.id}>
                              {decimalText(line.vat_rate_percent)}%: {decimalText(line.tax_base)} +{" "}
                              {decimalText(line.input_vat_amount)}
                            </small>
                          ))}
                        </td>
                        <td>
                          {entry.status}
                          <small>{entry.posting_status}</small>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
