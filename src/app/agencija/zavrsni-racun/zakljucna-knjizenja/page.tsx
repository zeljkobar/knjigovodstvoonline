import Link from "next/link";
import { JournalEntryForm } from "@/components/JournalEntryForm";
import {
  JournalLinesEditor,
  type JournalLineInitialValue
} from "@/components/JournalLinesEditor";
import { mergeCompanyAccountPlan } from "@/lib/account-plan";
import { requireAnyRole } from "@/lib/auth";
import { standardJournalTypes } from "@/lib/journals";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { createFinalClosingJournal } from "../actions";

type PageProps = {
  searchParams?: Promise<{
    detalj?: string;
    poruka?: string;
  }>;
};

type ClosingBalanceRow = {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
};

const messages: Record<string, string> = {
  godina_zakljucena: "Poslovna godina je zaključana.",
  konto_nevalidno: "Konto ne postoji ili je deaktiviran za firmu.",
  nalog_greska: "Nalog nije sačuvan.",
  nalog_nebalansiran: "Nalog nije izbalansiran.",
  nalog_obavezno: "Nedostaju firma, godina, datum ili vrsta naloga.",
  partner_obavezan: "Analitika je obavezna za konto.",
  prava: "Nemate pravo za završni račun.",
  stavka_iznos: "Jedna stavka mora imati samo duguje ili samo potražuje.",
  stavke_nevalidne: "Provjerite konta i iznose na stavkama.",
  stavke_obavezne: "Nalog mora imati bar jednu stavku."
};

const finalAccountTypeCode = standardJournalTypes[8][0];
const finalAccountCode = "5990";
const incomeAccountCode = "6990";

function money(value: number) {
  return value.toLocaleString("sr-Latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function inputMoney(value: number) {
  return value.toFixed(2);
}

function dateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function closingDescription(year: number) {
  return `Zaključno knjiženje klasa 5 i 6 za ${year}. godinu`;
}

function addClosingLine(
  lines: JournalLineInitialValue[],
  accountCode: string,
  description: string,
  debit: number,
  credit: number
) {
  if (Math.abs(debit - credit) < 0.005 && debit === 0) {
    return;
  }

  lines.push({
    accountCode,
    credit: credit > 0 ? inputMoney(credit) : "",
    debit: debit > 0 ? inputMoney(debit) : "",
    description
  });
}

function buildClosingLines(rows: ClosingBalanceRow[]) {
  const lines: JournalLineInitialValue[] = [];
  let class5Debit = 0;
  let class5Credit = 0;
  let class6Debit = 0;
  let class6Credit = 0;

  for (const row of rows) {
    const saldo = row.debit - row.credit;

    if (Math.abs(saldo) < 0.005) {
      continue;
    }

    const debit = saldo < 0 ? Math.abs(saldo) : 0;
    const credit = saldo > 0 ? saldo : 0;

    addClosingLine(
      lines,
      row.accountCode,
      `Zatvaranje salda ${row.accountCode} - ${row.accountName}`,
      debit,
      credit
    );

    if (row.accountCode.startsWith("5")) {
      class5Debit += debit;
      class5Credit += credit;
    } else if (row.accountCode.startsWith("6")) {
      class6Debit += debit;
      class6Credit += credit;
    }
  }

  const class5NetCredit = class5Credit - class5Debit;
  const class6NetDebit = class6Debit - class6Credit;

  addClosingLine(
    lines,
    finalAccountCode,
    "Prenos rashoda na rezultat",
    class5NetCredit > 0 ? class5NetCredit : 0,
    class5NetCredit < 0 ? Math.abs(class5NetCredit) : 0
  );
  addClosingLine(
    lines,
    incomeAccountCode,
    "Prenos prihoda na rezultat",
    class6NetDebit < 0 ? Math.abs(class6NetDebit) : 0,
    class6NetDebit > 0 ? class6NetDebit : 0
  );

  return lines;
}

export default async function ZakljucnaKnjizenjaPage({ searchParams }: PageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();
  const params = await searchParams;
  const message =
    params?.poruka === "partner_obavezan" && params.detalj
      ? `Analitika za konto ${params.detalj} je obavezna.`
      : params?.poruka
        ? messages[params.poruka]
        : null;

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return (
      <div className="admin-stack">
        <header className="admin-header">
          <div>
            <h2>Zaključna knjiženja</h2>
            <p>Izaberite firmu i poslovnu godinu u gornjoj traci.</p>
          </div>
        </header>
      </div>
    );
  }

  const allowed = await hasPermission(user, {
    firmaId: workContext.firmaId,
    modul: "zavrsni_racun",
    akcija: "manage"
  });

  if (!allowed) {
    return (
      <div className="admin-stack">
        <section className="admin-card">
          <p className="empty-state">Nemate pravo za zaključna knjiženja.</p>
        </section>
      </div>
    );
  }

  const [
    firma,
    godina,
    finalJournalType,
    baseAccounts,
    companyOverrides,
    postedLines,
    existingFinalJournals
  ] = await Promise.all([
    prisma.firma.findFirst({
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
        naziv: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId
      },
      select: {
        id: true,
        godina: true,
        datum_do: true,
        zakljucena: true
      }
    }),
    prisma.vrstaNaloga.findFirst({
      where: {
        sifra: finalAccountTypeCode,
        aktivan: true,
        OR: [
          {
            sistemska: true
          },
          {
            agencija_id: user.agencija_id
          },
          {
            firma_id: workContext.firmaId
          }
        ]
      },
      select: {
        id: true,
        naziv: true,
        prefiks: true
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
        firma_id: workContext.firmaId
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
    prisma.stavkaNaloga.findMany({
      where: {
        nalog: {
          firma_id: workContext.firmaId,
          poslovna_godina_id: workContext.poslovnaGodinaId,
          status: "POSTED",
          is_deleted: false,
          vrsta_naloga: {
            sifra: {
              not: finalAccountTypeCode
            }
          }
        },
        OR: [
          {
            firma_konto: {
              sifra: {
                startsWith: "5"
              }
            }
          },
          {
            firma_konto: {
              sifra: {
                startsWith: "6"
              }
            }
          }
        ]
      },
      select: {
        duguje: true,
        potrazuje: true,
        firma_konto: {
          select: {
            sifra: true,
            naziv: true
          }
        }
      }
    }),
    prisma.nalog.findMany({
      where: {
        firma_id: workContext.firmaId,
        poslovna_godina_id: workContext.poslovnaGodinaId,
        is_deleted: false,
        vrsta_naloga: {
          sifra: finalAccountTypeCode
        }
      },
      orderBy: {
        broj: "desc"
      },
      select: {
        id: true,
        sifra: true,
        status: true
      }
    })
  ]);

  if (!firma || !godina) {
    return null;
  }

  const accounts = mergeCompanyAccountPlan(baseAccounts, companyOverrides).filter(
    (account) => account.aktivan && account.tip_konta === "analiticko"
  );
  const requiredAnalyticsAccounts = accounts
    .filter((account) => account.analitika_obavezna)
    .map((account) => account.sifra);
  const accountCodes = new Set(accounts.map((account) => account.sifra));
  const missingResultAccounts = [finalAccountCode, incomeAccountCode].filter(
    (code) => !accountCodes.has(code)
  );
  const balanceRows = Array.from(
    postedLines
      .reduce((map, line) => {
        const code = line.firma_konto.sifra;

        if (code === finalAccountCode || code === incomeAccountCode) {
          return map;
        }

        const existing = map.get(code) ?? {
          accountCode: code,
          accountName: line.firma_konto.naziv,
          credit: 0,
          debit: 0
        };

        existing.debit += Number(line.duguje);
        existing.credit += Number(line.potrazuje);
        map.set(code, existing);

        return map;
      }, new Map<string, ClosingBalanceRow>())
      .values()
  )
    .filter((row) => Math.abs(row.debit - row.credit) >= 0.005)
    .sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  const initialLines = buildClosingLines(balanceRows);
  const totalDebit = initialLines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const totalCredit = initialLines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  const defaultDate = dateInputValue(godina.datum_do);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Zaključna knjiženja</h2>
          <p>
            {firma.naziv} · {godina.godina}
          </p>
        </div>
        <div className="header-actions">
          <Link className="secondary-button" href="/agencija/zavrsni-racun/bruto-bilans">
            Bruto bilans
          </Link>
          <Link className="secondary-button" href="/agencija/nalozi">
            Pregled naloga
          </Link>
        </div>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      {existingFinalJournals.length > 0 ? (
        <section className="admin-panel">
          <div className="panel-header">
            <div>
              <h3>Postojeći nalozi završnog računa</h3>
              <span>
                Ako je završni nalog već proknjižen, novi predlog ispod izuzima te naloge iz
                obračuna.
              </span>
            </div>
          </div>
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Nalog</th>
                  <th>Status</th>
                  <th>Akcija</th>
                </tr>
              </thead>
              <tbody>
                {existingFinalJournals.map((journal) => (
                  <tr key={journal.id}>
                    <td>{journal.sifra ?? "-"}</td>
                    <td>{journal.status}</td>
                    <td>
                      <Link className="table-button" href={`/agencija/nalozi/${journal.id}`}>
                        Otvori
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {godina.zakljucena ? (
        <section className="admin-panel">
          <h3>Godina je zaključana</h3>
          <p className="empty-state">
            Za {firma.naziv} / {godina.godina} nije moguće kreirati zaključni nalog.
          </p>
        </section>
      ) : !finalJournalType ? (
        <section className="admin-panel">
          <h3>Vrsta naloga nije podešena</h3>
          <p className="empty-state">
            Nedostaje aktivna vrsta naloga `FINAL_ACCOUNT` za završni račun.
          </p>
        </section>
      ) : initialLines.length === 0 ? (
        <section className="admin-panel">
          <h3>Nema salda za zatvaranje</h3>
          <p className="empty-state">
            Klase 5 i 6 nemaju saldo za zaključni nalog, nakon izuzimanja postojećih
            naloga završnog računa.
          </p>
        </section>
      ) : (
        <JournalEntryForm
          action={createFinalClosingJournal}
          className="journal-form"
          requiredAnalyticsAccounts={requiredAnalyticsAccounts}
        >
          <section className="stats-grid">
            <article className="stat-card">
              <span>Stavki</span>
              <strong>{initialLines.length}</strong>
            </article>
            <article className="stat-card">
              <span>Ukupno duguje</span>
              <strong>{money(totalDebit)}</strong>
            </article>
            <article className="stat-card">
              <span>Ukupno potražuje</span>
              <strong>{money(totalCredit)}</strong>
            </article>
            <article className="stat-card">
              <span>Razlika</span>
              <strong>{money(Math.abs(totalDebit - totalCredit))}</strong>
            </article>
          </section>

          {missingResultAccounts.length > 0 ? (
            <p className="admin-message">
              Provjerite kontni plan: nijesu pronađena konta {missingResultAccounts.join(", ")} u
              spojenom planu firme.
            </p>
          ) : null}

          <section className="admin-form-section">
            <h3>Zaglavlje</h3>
            <div className="admin-form journal-header-form">
              <input name="vrsta_naloga_id" type="hidden" value={finalJournalType.id} />
              <label>
                <span>Vrsta naloga</span>
                <input
                  readOnly
                  value={`${finalJournalType.naziv}${
                    finalJournalType.prefiks ? ` (${finalJournalType.prefiks})` : ""
                  }`}
                />
              </label>
              <label>
                <span>Datum naloga</span>
                <input defaultValue={defaultDate} name="datum" required type="date" />
              </label>
              <label className="form-wide">
                <span>Opis naloga</span>
                <input
                  defaultValue={closingDescription(godina.godina)}
                  name="opis"
                  placeholder="Opis naloga"
                />
              </label>
            </div>
          </section>

          <section className="admin-panel">
            <div className="panel-header">
              <div>
                <h3>Predlog stavki</h3>
                <span>
                  Saldo svake petice i šestice knjiži se kontra; 5990 i 6990 zatvaraju zbir.
                </span>
              </div>
            </div>

            <JournalLinesEditor
              accounts={accounts}
              datalistId="final-closing-account-options"
              initialLines={initialLines}
              minimumRows={initialLines.length + 2}
            />

            <div className="journal-actions">
              <button type="submit">Sačuvaj nacrt zaključnog naloga</button>
            </div>
          </section>
        </JournalEntryForm>
      )}
    </div>
  );
}
