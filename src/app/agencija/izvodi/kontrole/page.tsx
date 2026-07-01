import Link from "next/link";
import {
  getIzvodiContext,
  MissingContext,
  statementBalanceOk,
  statementStatusLabels
} from "../_shared";
import { prisma } from "@/lib/prisma";

type Issue = {
  actionHref: string;
  description: string;
  severity: "Greška" | "Upozorenje";
  statementNumber: string;
  status: string;
};

export default async function KontroleIzvodaPage() {
  const { user, firma, godina } = await getIzvodiContext();

  if (!user.agencija_id || !firma || !godina) {
    return <MissingContext title="Kontrole izvoda" />;
  }

  const statements = await prisma.bankStatement.findMany({
    where: {
      agencija_id: user.agencija_id,
      firma_id: firma.id,
      poslovna_godina_id: godina.id,
      is_deleted: false
    },
    include: {
      journal: {
        select: {
          id: true,
          is_deleted: true,
          status: true,
          sifra: true
        }
      },
      lines: {
        select: {
          id: true,
          posting_status: true,
          direction: true,
          partner_id: true,
          debit_account_id: true,
          credit_account_id: true
        }
      }
    },
    orderBy: [
      {
        statement_date: "desc"
      },
      {
        statement_number: "desc"
      }
    ]
  });
  const issues: Issue[] = [];

  for (const statement of statements) {
    const href = `/agencija/izvodi?izvod=${statement.id}&tab=nalog`;

    if (!statementBalanceOk(statement)) {
      issues.push({
        actionHref: href,
        description: "Početno stanje + priliv - odliv nije jednako krajnjem stanju.",
        severity: "Greška",
        statementNumber: statement.statement_number,
        status: statement.status
      });
    }

    const unresolved = statement.lines.filter(
      (line) => !["READY", "IGNORED"].includes(line.posting_status)
    );

    if (unresolved.length > 0) {
      issues.push({
        actionHref: href,
        description: `${unresolved.length} stavki nije spremno za knjiženje.`,
        severity: "Upozorenje",
        statementNumber: statement.statement_number,
        status: statement.status
      });
    }

    const missingAccounts = statement.lines.filter(
      (line) =>
        line.posting_status !== "IGNORED" &&
        (line.direction === "INFLOW" ? !line.credit_account_id : !line.debit_account_id)
    );

    if (missingAccounts.length > 0) {
      issues.push({
        actionHref: href,
        description: `${missingAccounts.length} stavki nema izabran konto.`,
        severity: "Greška",
        statementNumber: statement.statement_number,
        status: statement.status
      });
    }

    if (statement.status === "POSTED" && (!statement.journal || statement.journal.is_deleted)) {
      issues.push({
        actionHref: href,
        description: "Izvod je označen kao proknjižen, ali nalog ne postoji ili je obrisan.",
        severity: "Greška",
        statementNumber: statement.statement_number,
        status: statement.status
      });
    }
  }

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Kontrole izvoda</h2>
          <p>Provjere stanja, neriješenih stavki i veze izvoda sa nalogom.</p>
        </div>
      </header>

      <section className="admin-panel">
        {issues.length === 0 ? (
          <p className="empty-state">Nema otvorenih kontrolnih upozorenja za izvode.</p>
        ) : (
          <div className="responsive-table">
            <table>
              <thead>
                <tr>
                  <th>Tip</th>
                  <th>Izvod</th>
                  <th>Status</th>
                  <th>Opis</th>
                  <th>Akcija</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue, index) => (
                  <tr key={`${issue.statementNumber}-${index}`}>
                    <td>{issue.severity}</td>
                    <td>{issue.statementNumber}</td>
                    <td>{statementStatusLabels[issue.status] ?? issue.status}</td>
                    <td>{issue.description}</td>
                    <td>
                      <Link className="secondary-button compact-button" href={issue.actionHref}>
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
