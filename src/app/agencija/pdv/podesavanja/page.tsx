import { effectivePdvSettings } from "@/lib/posting-template";
import { PostingTemplateNotice } from "@/components/PostingTemplateNotice";
import { AccountSearchSelect } from "@/components/AccountSearchSelect";
import { savePdvSettings } from "../actions";
import { mergeCompanyAccountPlan } from "@/lib/account-plan";
import { requireRole } from "@/lib/auth";
import { buildPdvPostingFields } from "@/lib/pdv";
import { prisma } from "@/lib/prisma";
import { requirePdvContext } from "@/lib/pdv-service";

const poruke: Record<string, string> = {
  podesavanja_sacuvana: "PDV podešavanja su sačuvana."
};

type PageProps = {
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

export default async function PdvPodesavanjaPage({ searchParams }: PageProps) {
  await requireRole("admin_agencije");
  const params = await searchParams;
  const context = await requirePdvContext("manage");
  const [settings, journalTypes, baseAccounts, companyAccounts, vatRates] = await Promise.all([
    effectivePdvSettings(prisma, context.firma.id, context.poslovnaGodina.id),
    prisma.vrstaNaloga.findMany({
      where: {
        aktivan: true,
        OR: [
          {
            firma_id: context.firma.id
          },
          {
            firma_id: null
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
    }),
    prisma.pdvStopa.findMany({
      where: {
        agencija_id: context.agencijaId,
        aktivna: true
      },
      orderBy: [
        {
          procenat: "desc"
        },
        {
          redosljed: "asc"
        }
      ],
      select: {
        naziv: true,
        procenat: true,
        sifra: true
      }
    })
  ]);
  const accounts = mergeCompanyAccountPlan(baseAccounts, companyAccounts).filter(
    (account) => account.aktivan
  );
  const postingRows = buildPdvPostingFields(vatRates);
  const ruleMap = new Map(settings?.pravila.map((rule) => [rule.polje_sifra, rule]) ?? []);

  return (
    <div className="admin-stack">
      {context.firma.id ? <PostingTemplateNotice companyId={context.firma.id!}/> : null}
      <header className="admin-header">
        <div>
          <h2>Podešavanja PDV-a</h2>
          <p>Vrsta naloga i konta za knjiženje mjesečne PDV prijave.</p>
        </div>
      </header>

      {params?.poruka && poruke[params.poruka] ? (
        <p className="admin-message">{poruke[params.poruka]}</p>
      ) : null}

      <section className="admin-panel">
        <form className="admin-form pdv-settings-form" action={savePdvSettings}>
          <label className="form-wide">
            <span>Vrsta naloga za PDV prijavu</span>
            <select name="vrsta_naloga_id" defaultValue={settings?.vrsta_naloga_id ?? ""}>
              <option value="">Izaberite vrstu naloga</option>
              {journalTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.sifra} - {type.naziv}
                </option>
              ))}
            </select>
          </label>

          <div className="form-wide">
            <span>Šema knjiženja PDV prijave</span>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Stavka</th>
                  <th>Smjer</th>
                  <th>Konto</th>
                </tr>
              </thead>
              <tbody>
                {postingRows.map((row) => (
                  <tr key={row.code}>
                    <td>{row.label}</td>
                    <td>
                      <input name="polje_sifra" type="hidden" value={row.code} />
                      <input name="polje_naziv" type="hidden" value={row.label} />
                      <input name="pdv_stopa_sifra" type="hidden" value={row.rateCode ?? ""} />
                      <input name="redosljed" type="hidden" value={row.order} />
                      <select
                        name="smjer"
                        defaultValue={ruleMap.get(row.code)?.smjer ?? row.defaultDirection}
                      >
                        <option value="D">Duguje</option>
                        <option value="P">Potražuje</option>
                      </select>
                    </td>
                    <td>
                      <AccountSearchSelect
                        name="konto_id"
                        defaultValue={
                          ruleMap.get(row.code)?.inherited
                            ? (() => { const account = accounts.find(account => account.sifra === ruleMap.get(row.code)?.konto?.sifra); return account?.companyAccountId ? `company:${account.companyAccountId}` : account?.baseAccountId ? `base:${account.baseAccountId}` : ""; })()
                            : ruleMap.get(row.code)?.konto_id
                            ? `company:${ruleMap.get(row.code)?.konto_id}`
                            : ""
                        }
                      >
                        <option value="">Izaberite konto</option>
                        {accounts.map((account) => {
                          const accountValue = account.companyAccountId
                            ? `company:${account.companyAccountId}`
                            : `base:${account.baseAccountId}`;

                          return (
                            <option key={accountValue} value={accountValue}>
                              {account.sifra} - {account.naziv}
                            </option>
                          );
                        })}
                      </AccountSearchSelect>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label>
            <span>Opis naloga</span>
            <input
              name="opis_naloga"
              defaultValue={settings?.opis_naloga ?? "PDV prijava za period {period}"}
            />
          </label>

          <button className="primary-button" type="submit">
            Sačuvaj podešavanja
          </button>
        </form>
      </section>
    </div>
  );
}
