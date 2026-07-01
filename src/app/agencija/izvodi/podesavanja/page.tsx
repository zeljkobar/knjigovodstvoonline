import { saveBankStatementAccountSettings } from "../actions";
import { getIzvodiContext, MissingContext } from "../_shared";
import { mergeCompanyAccountPlan } from "@/lib/account-plan";
import { prisma } from "@/lib/prisma";

type PodesavanjaIzvodaPageProps = {
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

const messages: Record<string, string> = {
  godina_zakljucena: "Poslovna godina je zaključena.",
  podesavanja_greska: "Podešavanja nije moguće sačuvati.",
  podesavanja_sacuvana: "Podešavanja izvoda su sačuvana."
};

export default async function PodesavanjaIzvodaPage({
  searchParams
}: PodesavanjaIzvodaPageProps) {
  const { user, firma, godina } = await getIzvodiContext();
  const params = await searchParams;

  if (!user.agencija_id || !firma || !godina) {
    return <MissingContext title="Podešavanja izvoda" />;
  }

  const [bankAccounts, settings, baseAccounts, companyOverrides, journalTypes] =
    await Promise.all([
      prisma.firmaBankovniRacun.findMany({
        where: {
          agencija_id: user.agencija_id,
          firma_id: firma.id,
          is_deleted: false,
          aktivan: true
        },
        orderBy: [
          {
            glavni: "desc"
          },
          {
            naziv_banke: "asc"
          }
        ],
        select: {
          id: true,
          naziv_banke: true,
          broj_racuna: true,
          glavni: true
        }
      }),
      prisma.bankStatementAccountSetting.findMany({
        where: {
          agencija_id: user.agencija_id,
          firma_id: firma.id
        },
        include: {
          bank_account_konto: {
            select: {
              sifra: true
            }
          },
          journal_type: {
            select: {
              id: true
            }
          }
        }
      }),
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
      prisma.vrstaNaloga.findMany({
        where: {
          aktivan: true,
          OR: [
            {
              agencija_id: user.agencija_id
            },
            {
              agencija_id: null
            },
            {
              firma_id: firma.id
            }
          ]
        },
        orderBy: {
          naziv: "asc"
        },
        select: {
          id: true,
          sifra: true,
          naziv: true,
          prefiks: true
        }
      })
    ]);
  const accountOptions = mergeCompanyAccountPlan(baseAccounts, companyOverrides).filter(
    (account) => account.aktivan && account.tip_konta === "analiticko"
  );
  const settingByBankAccount = new Map(
    settings.map((setting) => [setting.company_bank_account_id, setting])
  );

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Podešavanja izvoda</h2>
          <p>Uparivanje bankovnog računa firme sa kontom banke i vrstom naloga.</p>
        </div>
      </header>

      {params?.poruka ? <p className="admin-message">{messages[params.poruka] ?? params.poruka}</p> : null}

      <section className="admin-panel">
        {bankAccounts.length === 0 ? (
          <p className="empty-state">Firma nema aktivnih bankovnih računa.</p>
        ) : (
          <form action={saveBankStatementAccountSettings}>
            <div className="responsive-table">
              <table>
                <thead>
                  <tr>
                    <th>Bankovni račun</th>
                    <th>Konto banke</th>
                    <th>Vrsta naloga</th>
                  </tr>
                </thead>
                <tbody>
                  {bankAccounts.map((bankAccount) => {
                    const setting = settingByBankAccount.get(bankAccount.id);

                    return (
                      <tr key={bankAccount.id}>
                        <td>
                          <strong>{bankAccount.naziv_banke}</strong>
                          <small>
                            {bankAccount.broj_racuna}
                            {bankAccount.glavni ? " · glavni" : ""}
                          </small>
                          <input name="company_bank_account_id" type="hidden" value={bankAccount.id} />
                        </td>
                        <td>
                          <select
                            defaultValue={setting?.bank_account_konto?.sifra ?? ""}
                            name="bank_account_konto_code"
                          >
                            <option value="">Izaberite konto</option>
                            {accountOptions.map((account) => (
                              <option key={`${account.sifra}-${account.id}`} value={account.sifra}>
                                {account.sifra} - {account.naziv}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select defaultValue={setting?.journal_type?.id ?? ""} name="journal_type_id">
                            <option value="">Podrazumijevano: Izvodi</option>
                            {journalTypes.map((journalType) => (
                              <option key={journalType.id} value={journalType.id}>
                                {journalType.naziv} {journalType.prefiks ? `(${journalType.prefiks})` : ""}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button className="primary-button" type="submit">
              Sačuvaj podešavanja
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
