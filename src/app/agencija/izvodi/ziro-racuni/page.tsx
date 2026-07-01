import { getIzvodiContext, MissingContext } from "../_shared";
import { prisma } from "@/lib/prisma";

export default async function ZiroRacuniKomitenataPage() {
  const { user, firma, godina } = await getIzvodiContext();

  if (!user.agencija_id || !firma || !godina) {
    return <MissingContext title="Žiro računi komitenata" />;
  }

  const [learnedAccounts, usedPartnerAccounts, mappedStatementLines] = await Promise.all([
    prisma.partnerBankAccount.findMany({
      where: {
        agencija_id: user.agencija_id,
        OR: [
          {
            firma_id: firma.id
          },
          {
            firma_id: null
          }
        ],
        is_active: true
      },
      orderBy: {
        updated_at: "desc"
      },
      take: 200,
      include: {
        partner: {
          select: {
            naziv: true,
            pib: true
          }
        }
      }
    }),
    prisma.komitentZiroRacun.findMany({
      where: {
        aktivan: true,
        komitent: {
          bank_statement_lines: {
            some: {
              bank_statement: {
                agencija_id: user.agencija_id,
                firma_id: firma.id,
                poslovna_godina_id: godina.id,
                is_deleted: false
              }
            }
          }
        }
      },
      orderBy: {
        broj_racuna: "asc"
      },
      take: 200,
      include: {
        banka: {
          select: {
            naziv: true
          }
        },
        komitent: {
          select: {
            naziv: true,
            pib: true
          }
        }
      }
    }),
    prisma.bankStatementLine.findMany({
      where: {
        partner_id: {
          not: null
        },
        counterparty_account_number_normalized: {
          not: null
        },
        bank_statement: {
          agencija_id: user.agencija_id,
          firma_id: firma.id,
          poslovna_godina_id: godina.id,
          is_deleted: false
        }
      },
      orderBy: {
        updated_at: "desc"
      },
      take: 300,
      include: {
        partner: {
          select: {
            naziv: true,
            pib: true
          }
        }
      }
    })
  ]);
  const uniqueMappedLines = [
    ...new Map(
      mappedStatementLines.map((line) => [
        `${line.partner_id}:${line.counterparty_account_number_normalized}`,
        line
      ])
    ).values()
  ];

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Žiro računi komitenata</h2>
          <p>Računi koji se koriste za automatsko prepoznavanje partnera u izvodima.</p>
        </div>
      </header>

      <section className="admin-panel">
        <h3>Naučeni računi iz izvoda</h3>
        {learnedAccounts.length === 0 ? (
          <p className="empty-state">Još nema ručno naučenih žiro računa iz izvoda.</p>
        ) : (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Partner</th>
                  <th>PIB</th>
                  <th>Žiro račun</th>
                  <th>Banka</th>
                  <th>Izvor</th>
                </tr>
              </thead>
              <tbody>
                {learnedAccounts.map((account) => (
                  <tr key={account.id}>
                    <td>{account.partner.naziv}</td>
                    <td>{account.partner.pib ?? "-"}</td>
                    <td>{account.account_number}</td>
                    <td>{account.bank_name ?? "-"}</td>
                    <td>{account.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-panel">
        <h3>Mapirani računi na stavkama izvoda</h3>
        {uniqueMappedLines.length === 0 ? (
          <p className="empty-state">Nema ručno mapiranih žiro računa na stavkama izvoda.</p>
        ) : (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Partner</th>
                  <th>PIB</th>
                  <th>Žiro račun</th>
                  <th>Opis sa izvoda</th>
                </tr>
              </thead>
              <tbody>
                {uniqueMappedLines.map((line) => (
                  <tr key={`${line.partner_id}:${line.counterparty_account_number_normalized}`}>
                    <td>{line.partner?.naziv ?? "-"}</td>
                    <td>{line.partner?.pib ?? "-"}</td>
                    <td>{line.counterparty_account_number ?? line.counterparty_account_number_normalized}</td>
                    <td>{line.counterparty_name ?? line.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-panel">
        <h3>Postojeći računi komitenata korišćeni u izvodima</h3>
        {usedPartnerAccounts.length === 0 ? (
          <p className="empty-state">Nema postojećih žiro računa koji su povezani sa uvezenim izvodima.</p>
        ) : (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Partner</th>
                  <th>PIB</th>
                  <th>Žiro račun</th>
                  <th>Banka</th>
                  <th>Glavni</th>
                </tr>
              </thead>
              <tbody>
                {usedPartnerAccounts.map((account) => (
                  <tr key={account.id}>
                    <td>{account.komitent.naziv}</td>
                    <td>{account.komitent.pib ?? "-"}</td>
                    <td>{account.broj_racuna}</td>
                    <td>{account.banka?.naziv ?? "-"}</td>
                    <td>{account.glavni ? "Da" : "Ne"}</td>
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
