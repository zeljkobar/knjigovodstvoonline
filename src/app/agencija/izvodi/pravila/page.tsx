import Link from "next/link";
import { displayDate, getIzvodiContext, MissingContext } from "../_shared";
import { prisma } from "@/lib/prisma";

const directionLabels: Record<string, string> = {
  INFLOW: "Priliv",
  OUTFLOW: "Odliv"
};

export default async function PravilaIzvodaPage() {
  const { user, firma, godina } = await getIzvodiContext();

  if (!user.agencija_id || !firma || !godina) {
    return <MissingContext title="Pravila knjiženja" />;
  }

  const rules = await prisma.bankPostingRule.findMany({
    where: {
      agencija_id: user.agencija_id,
      firma_id: firma.id,
      active: true
    },
    orderBy: [
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
  });

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Pravila knjiženja</h2>
          <p>Zapamćena pravila po kontra žiro računu za automatsko popunjavanje konta.</p>
        </div>
      </header>

      <section className="admin-panel">
        <div className="section-title-row">
          <div>
            <h3>Pravila po žiro računu</h3>
            <p>Pravilo se upiše ili ažurira kada sačuvate predlog naloga izvoda.</p>
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
                  <th>Konto</th>
                  <th>Partner</th>
                  <th>Upotreba</th>
                  <th>Zadnji put</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id}>
                    <td>
                      <strong>{rule.counterparty_account_number}</strong>
                      <small>{rule.counterparty_account_number_normalized}</small>
                    </td>
                    <td>{directionLabels[rule.direction] ?? rule.direction}</td>
                    <td>
                      <strong>{rule.account.sifra}</strong>
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
