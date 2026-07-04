import Link from "next/link";
import { createBankPostingRule, deleteBankPostingRule } from "../actions";
import { displayDate, getIzvodiContext, MissingContext } from "../_shared";
import { mergeCompanyAccountPlan } from "@/lib/account-plan";
import { prisma } from "@/lib/prisma";

const directionLabels: Record<string, string> = {
  INFLOW: "Priliv",
  OUTFLOW: "Odliv"
};

type PravilaIzvodaPageProps = {
  searchParams?: Promise<{
    poruka?: string;
    pravilo?: string;
  }>;
};

const messages: Record<string, string> = {
  godina_zakljucena: "Poslovna godina je zaključana.",
  pravilo_obavezno: "Pravilo nije pronađeno ili nije moguće izmijeniti ga.",
  pravilo_obrisano: "Pravilo je obrisano.",
  pravilo_sacuvano: "Pravilo je sačuvano."
};

export default async function PravilaIzvodaPage({ searchParams }: PravilaIzvodaPageProps) {
  const params = await searchParams;
  const { user, firma, godina } = await getIzvodiContext();

  if (!user.agencija_id || !firma || !godina) {
    return <MissingContext title="Pravila knjiženja" />;
  }

  const selectedRuleId = params?.pravilo ?? null;
  const [rules, selectedRule, baseAccounts, companyOverrides] = await Promise.all([
    prisma.bankPostingRule.findMany({
      where: {
        agencija_id: user.agencija_id,
        active: true,
        OR: [
          {
            firma_id: firma.id
          },
          {
            firma_id: {
              equals: null
            }
          }
        ]
      },
      orderBy: [
        {
          priority: "desc"
        },
        {
          last_used_at: "desc"
        },
        {
          updated_at: "desc"
        }
      ],
      include: {
        account: {
          select: {
            sifra: true,
            naziv: true
          }
        },
        partner: {
          select: {
            naziv: true,
            pib: true
          }
        }
      }
    }),
    selectedRuleId
      ? prisma.bankPostingRule.findFirst({
          where: {
            id: selectedRuleId,
            agencija_id: user.agencija_id,
            active: true,
            OR: [
              {
                firma_id: firma.id
              },
              {
                firma_id: {
                  equals: null
                }
              }
            ]
          },
          include: {
            account: {
              select: {
                sifra: true
              }
            }
          }
        })
      : null,
    prisma.konto.findMany({
      where: {
        aktivan: true,
        tip_konta: "analiticko"
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
        firma_id: firma.id
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
  ]);
  const accountOptions = mergeCompanyAccountPlan(baseAccounts, companyOverrides).filter(
    (account) => account.aktivan && account.tip_konta === "analiticko"
  );
  const editingSharedRule = Boolean(selectedRule && !selectedRule.firma_id);
  const selectedAccountCode = selectedRule?.account_code ?? selectedRule?.account.sifra ?? "";

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Pravila knjiženja</h2>
          <p>Zapamćena pravila po kontra žiro računu za automatsko popunjavanje konta.</p>
        </div>
      </header>

      {params?.poruka ? <p className="admin-message">{messages[params.poruka] ?? params.poruka}</p> : null}

      <section className="admin-panel">
        <div className="section-title-row">
          <div>
            <h3>{selectedRule ? "Izmjena pravila" : "Novo pravilo"}</h3>
            <p>
              {editingSharedRule
                ? "Izmjena zajedničkog pravila se podrazumijevano čuva kao pravilo za aktivnu firmu."
                : "Precizna pravila imaju veći prioritet od običnog pravila po žiro računu."}
            </p>
          </div>
          {selectedRule ? (
            <Link className="secondary-button compact-button" href="/agencija/izvodi/pravila">
              Novo pravilo
            </Link>
          ) : null}
        </div>

        <form action={createBankPostingRule} className="admin-form">
          <input name="rule_id" type="hidden" value={selectedRule?.id ?? ""} />
          <label>
            <span>Primjena</span>
            <select name="scope" defaultValue={selectedRule && !selectedRule.firma_id ? "FIRM" : selectedRule?.firma_id ? "FIRM" : "AGENCY"}>
              <option value="AGENCY">Sve firme agencije</option>
              <option value="FIRM">Samo aktivna firma</option>
            </select>
          </label>
          <label>
            <span>Smjer</span>
            <select name="direction" required defaultValue={selectedRule?.direction ?? "OUTFLOW"}>
              <option value="OUTFLOW">Odliv</option>
              <option value="INFLOW">Priliv</option>
            </select>
          </label>
          <label>
            <span>Žiro račun</span>
            <input
              name="counterparty_account_number"
              placeholder="npr. 540-000000000853066"
              defaultValue={selectedRule?.counterparty_account_number ?? ""}
            />
          </label>
          <label>
            <span>Opis sadrži</span>
            <input
              name="description_contains"
              placeholder="npr. ATM, Naknada, POREZ"
              defaultValue={selectedRule?.description_contains ?? ""}
            />
          </label>
          <label>
            <span>Šifra plaćanja</span>
            <input name="payment_code" placeholder="npr. 220" defaultValue={selectedRule?.payment_code ?? ""} />
          </label>
          <label>
            <span>Poziv sadrži</span>
            <input
              name="reference_contains"
              placeholder="dio poziva na broj"
              defaultValue={selectedRule?.reference_contains ?? ""}
            />
          </label>
          <label>
            <span>Prioritet</span>
            <input defaultValue={selectedRule?.priority ?? 10} min="0" name="priority" step="1" type="number" />
          </label>
          <label className="full-span">
            <span>Konto</span>
            <select name="account_code" required defaultValue={selectedAccountCode}>
              <option value="">Izaberite konto</option>
              {accountOptions.map((account) => (
                <option key={`${account.sifra}-${account.id}`} value={account.sifra}>
                  {account.sifra} - {account.naziv}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button" type="submit">
            {selectedRule ? "Sačuvaj izmjenu" : "Sačuvaj pravilo"}
          </button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="section-title-row">
          <div>
            <h3>Aktivna pravila</h3>
            <p>Pravila se primjenjuju po prioritetu, pa zatim po konkretnosti uslova.</p>
          </div>
          <Link className="secondary-button compact-button" href="/agencija/izvodi/obrada">
            Obradi stavke
          </Link>
        </div>

        {rules.length === 0 ? (
          <p className="empty-state">Još nema zapamćenih pravila. Sačuvajte predlog naloga za stavku izvoda.</p>
        ) : (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Žiro račun</th>
                  <th>Smjer</th>
                  <th>Uslovi</th>
                  <th>Primjena</th>
                  <th>Prioritet</th>
                  <th>Konto</th>
                  <th>Partner</th>
                  <th>Upotreba</th>
                  <th>Zadnji put</th>
                  <th>Akcija</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td>
                      <strong>{rule.counterparty_account_number ?? "-"}</strong>
                      <small>{rule.counterparty_account_number_normalized ?? ""}</small>
                    </td>
                    <td>{directionLabels[rule.direction] ?? rule.direction}</td>
                    <td>
                      {rule.description_contains ? <small>Opis: {rule.description_contains}</small> : null}
                      {rule.payment_code ? <small>Šifra: {rule.payment_code}</small> : null}
                      {rule.reference_contains ? <small>Poziv: {rule.reference_contains}</small> : null}
                      {!rule.description_contains && !rule.payment_code && !rule.reference_contains ? (
                        <small>Samo žiro račun</small>
                      ) : null}
                    </td>
                    <td>{rule.firma_id ? "Firma" : "Agencija"}</td>
                    <td>{rule.priority}</td>
                    <td>
                      <strong>{rule.account_code ?? rule.account.sifra}</strong>
                      <small>{rule.account.naziv}</small>
                    </td>
                    <td>
                      {rule.partner ? (
                        <>
                          <strong>{rule.partner.naziv}</strong>
                          <small>{rule.partner.pib}</small>
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>{rule.times_used}</td>
                    <td>{rule.last_used_at ? displayDate(rule.last_used_at) : "-"}</td>
                    <td>
                      <div className="table-actions">
                        <Link href={`/agencija/izvodi/pravila?pravilo=${rule.id}`}>Ispravi</Link>
                        <form action={deleteBankPostingRule}>
                          <input name="rule_id" type="hidden" value={rule.id} />
                          <button className="table-button table-button-danger" type="submit">
                            Obriši
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
