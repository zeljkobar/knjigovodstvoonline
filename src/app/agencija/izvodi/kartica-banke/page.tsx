import Link from "next/link";
import {
  displayDate,
  getIzvodiContext,
  MissingContext,
  money,
  statementStatusLabels
} from "../_shared";
import { prisma } from "@/lib/prisma";

type KarticaBankePageProps = {
  searchParams?: Promise<{
    racun?: string;
  }>;
};

export default async function KarticaBankePage({ searchParams }: KarticaBankePageProps) {
  const { user, firma, godina } = await getIzvodiContext();
  const params = await searchParams;
  const selectedAccount = params?.racun ?? "";

  if (!user.agencija_id || !firma || !godina) {
    return <MissingContext title="Kartica banke" />;
  }

  const [bankAccounts, statements] = await Promise.all([
    prisma.firmaBankovniRacun.findMany({
      where: {
        agencija_id: user.agencija_id,
        firma_id: firma.id,
        is_deleted: false,
        aktivan: true
      },
      orderBy: {
        naziv_banke: "asc"
      },
      select: {
        id: true,
        naziv_banke: true,
        broj_racuna: true
      }
    }),
    prisma.bankStatement.findMany({
      where: {
        agencija_id: user.agencija_id,
        firma_id: firma.id,
        poslovna_godina_id: godina.id,
        is_deleted: false,
        ...(selectedAccount
          ? {
              company_bank_account_id: selectedAccount
            }
          : {})
      },
      orderBy: [
        {
          statement_date: "asc"
        },
        {
          statement_number: "asc"
        }
      ],
      include: {
        company_bank_account: {
          select: {
            naziv_banke: true,
            broj_racuna: true
          }
        },
        journal: {
          select: {
            sifra: true,
            is_deleted: true
          }
        }
      }
    })
  ]);
  const totalInflow = statements.reduce((sum, statement) => sum + Number(statement.total_inflow), 0);
  const totalOutflow = statements.reduce((sum, statement) => sum + Number(statement.total_outflow), 0);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Kartica banke</h2>
          <p>Pregled uvezenih izvoda po bankovnom računu firme.</p>
        </div>
      </header>

      <section className="admin-panel">
        <form className="admin-form" method="get">
          <label>
            <span>Bankovni račun</span>
            <select name="racun" defaultValue={selectedAccount}>
              <option value="">Svi računi</option>
              {bankAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.naziv_banke} - {account.broj_racuna}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button" type="submit">
            Prikaži
          </button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="journal-balance-summary">
          <div>
            <span>Ukupan priliv</span>
            <strong>{money(totalInflow)}</strong>
          </div>
          <div>
            <span>Ukupan odliv</span>
            <strong>{money(totalOutflow)}</strong>
          </div>
          <div>
            <span>Razlika</span>
            <strong>{money(totalInflow - totalOutflow)}</strong>
          </div>
        </div>

        {statements.length === 0 ? (
          <p className="empty-state">Nema uvezenih izvoda za izabrani filter.</p>
        ) : (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Banka</th>
                  <th>Broj</th>
                  <th>Prethodno</th>
                  <th>Odliv</th>
                  <th>Priliv</th>
                  <th>Tekuće</th>
                  <th>Status</th>
                  <th>Nalog</th>
                  <th>Akcija</th>
                </tr>
              </thead>
              <tbody>
                {statements.map((statement) => (
                  <tr key={statement.id}>
                    <td>{displayDate(statement.statement_date)}</td>
                    <td>
                      <strong>{statement.company_bank_account.naziv_banke}</strong>
                      <small>{statement.company_bank_account.broj_racuna}</small>
                    </td>
                    <td>{statement.statement_number}</td>
                    <td>{money(Number(statement.opening_balance))}</td>
                    <td>{money(Number(statement.total_outflow))}</td>
                    <td>{money(Number(statement.total_inflow))}</td>
                    <td>{money(Number(statement.closing_balance))}</td>
                    <td>{statementStatusLabels[statement.status] ?? statement.status}</td>
                    <td>{statement.journal && !statement.journal.is_deleted ? statement.journal.sifra : "-"}</td>
                    <td>
                      <Link className="secondary-button compact-button" href={`/agencija/izvodi?izvod=${statement.id}`}>
                        Otvori
                      </Link>
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
