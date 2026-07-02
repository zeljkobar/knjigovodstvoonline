import Link from "next/link";
import {
  displayDate,
  getIzvodiContext,
  lineStatusLabels,
  MissingContext,
  money
} from "../_shared";
import { prisma } from "@/lib/prisma";

export default async function ObradaIzvodaPage() {
  const { user, firma, godina } = await getIzvodiContext();

  if (!user.agencija_id || !firma || !godina) {
    return <MissingContext title="Obrada stavki" />;
  }

  const lines = await prisma.bankStatementLine.findMany({
    where: {
      posting_status: {
        notIn: ["READY", "IGNORED"]
      },
      bank_statement: {
        agencija_id: user.agencija_id,
        firma_id: firma.id,
        poslovna_godina_id: godina.id,
        status: {
          not: "POSTED"
        },
        is_deleted: false
      }
    },
    orderBy: [
      {
        posting_date: "desc"
      },
      {
        line_number: "asc"
      }
    ],
    include: {
      bank_statement: {
        select: {
          id: true,
          statement_number: true,
          statement_date: true,
          company_bank_account: {
            select: {
              naziv_banke: true,
              broj_racuna: true
            }
          }
        }
      },
      partner: {
        select: {
          naziv: true,
          pib: true
        }
      },
      debit_account: {
        select: {
          sifra: true,
          naziv: true
        }
      },
      credit_account: {
        select: {
          sifra: true,
          naziv: true
        }
      }
    }
  });

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Obrada stavki</h2>
          <p>Neriješene stavke izvoda za aktivnu firmu i godinu.</p>
        </div>
      </header>

      <section className="admin-panel">
        <div className="section-title-row">
          <div>
            <h3>Stavke za provjeru</h3>
            <p>{lines.length} stavki čeka izbor partnera, konta ili ignorisanje.</p>
          </div>
        </div>

        {lines.length === 0 ? (
          <p className="empty-state">Nema stavki izvoda za obradu.</p>
        ) : (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Izvod</th>
                  <th>Datum</th>
                  <th>Opis</th>
                  <th>Partner</th>
                  <th>Konto</th>
                  <th>Odliv</th>
                  <th>Priliv</th>
                  <th>Status</th>
                  <th>Akcija</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const account = line.direction === "INFLOW" ? line.credit_account : line.debit_account;

                  return (
                    <tr key={line.id}>
                      <td>
                        <strong>{line.bank_statement.statement_number}</strong>
                        <small>
                          {line.bank_statement.company_bank_account.naziv_banke} ·{" "}
                          {line.bank_statement.company_bank_account.broj_racuna}
                        </small>
                      </td>
                      <td>{displayDate(line.posting_date)}</td>
                      <td>
                        <strong>{line.description}</strong>
                        <small>
                          {line.counterparty_account_number ?? "-"}
                          {line.payment_code ? ` · šifra ${line.payment_code}` : ""}
                        </small>
                      </td>
                      <td>
                        {line.partner ? (
                          <>
                            <strong>{line.partner.naziv}</strong>
                            <small>{line.partner.pib}</small>
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>{account ? `${account.sifra} - ${account.naziv}` : "-"}</td>
                      <td>{money(Number(line.outflow_amount))}</td>
                      <td>{money(Number(line.inflow_amount))}</td>
                      <td>{lineStatusLabels[line.posting_status] ?? line.posting_status}</td>
                      <td>
                        <Link
                          className="secondary-button compact-button"
                          href={`/agencija/izvodi?izvod=${line.bank_statement.id}&tab=nalog`}
                        >
                          Otvori
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
