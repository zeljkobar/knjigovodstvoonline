import Link from "next/link";
import { requireAnyRole } from "@/lib/auth";
import { journalStatusLabel, journalStatuses } from "@/lib/journals";
import {
  accountClassFilter,
  buildOpeningBalanceLines,
  openingBalanceJournalType,
  openingBalanceTotals
} from "@/lib/opening-balance";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";
import { generateOpeningBalance } from "./actions";

type PageProps = {
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

const messages: Record<string, string> = {
  godina_zakljucena: "Izabrana poslovna godina je zaključana.",
  greska: "Nalog početnog stanja nije kreiran.",
  kontekst: "Izaberite firmu i poslovnu godinu u gornjoj traci.",
  nema_salda: "Prethodna godina nema saldo na kontima klasa 0–4.",
  pocetno_postoji: "Za ovu firmu i godinu već postoji nalog početnog stanja.",
  prethodna_godina: "Prethodna poslovna godina nije otvorena za ovu firmu.",
  prava: "Nemate pravo za kreiranje naloga ove firme.",
  saldo_nebalansiran:
    "Konta klasa 0–4 nijesu izbalansirana. Prvo završite zaključna knjiženja prethodne godine.",
  vrsta_naloga: "Nedostaje aktivna sistemska vrsta naloga Početno stanje."
};

function money(cents: number) {
  return (cents / 100).toLocaleString("sr-Latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export default async function PocetnoStanjePage({ searchParams }: PageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();
  const params = await searchParams;
  const message = params?.poruka ? messages[params.poruka] : null;

  if (!user.agencija_id) {
    return null;
  }

  if (!workContext.firmaId || !workContext.poslovnaGodinaId) {
    return (
      <div className="admin-stack">
        <header className="admin-header">
          <div>
            <h1>Početno stanje</h1>
            <p>Izaberite firmu i poslovnu godinu u gornjoj traci.</p>
          </div>
        </header>
      </div>
    );
  }

  const accessFilter =
    user.rola === "admin_agencije"
      ? {}
      : {
          korisnici: {
            some: {
              korisnik_id: user.id,
              is_deleted: false
            }
          }
        };
  const targetYear = await prisma.poslovnaGodina.findFirst({
    where: {
      id: workContext.poslovnaGodinaId,
      firma_id: workContext.firmaId,
      firma: {
        agencija_id: user.agencija_id,
        is_deleted: false,
        aktivan: true,
        ...accessFilter
      }
    },
    select: {
      id: true,
      godina: true,
      zakljucena: true,
      firma: {
        select: {
          id: true,
          naziv: true
        }
      }
    }
  });

  if (!targetYear) {
    return null;
  }

  const [sourceYear, journalType, existingJournal, canCreateOpening] = await Promise.all([
    prisma.poslovnaGodina.findUnique({
      where: {
        firma_id_godina: {
          firma_id: targetYear.firma.id,
          godina: targetYear.godina - 1
        }
      },
      select: {
        id: true,
        godina: true,
        zakljucena: true
      }
    }),
    prisma.vrstaNaloga.findFirst({
      where: {
        sifra: openingBalanceJournalType,
        aktivan: true,
        OR: [
          {
            sistemska: true
          },
          {
            agencija_id: user.agencija_id
          },
          {
            firma_id: targetYear.firma.id
          }
        ]
      },
      select: {
        id: true
      }
    }),
    prisma.nalog.findFirst({
      where: {
        firma_id: targetYear.firma.id,
        poslovna_godina_id: targetYear.id,
        is_deleted: false,
        vrsta_naloga: {
          sifra: openingBalanceJournalType
        }
      },
      orderBy: {
        created_at: "desc"
      },
      select: {
        id: true,
        sifra: true,
        status: true
      }
    }),
    hasPermission(user, {
      firmaId: targetYear.firma.id,
      modul: "nalozi",
      akcija: "create"
    })
  ]);
  const sourceLines = sourceYear
    ? await prisma.stavkaNaloga.findMany({
        where: {
          nalog: {
            firma_id: targetYear.firma.id,
            poslovna_godina_id: sourceYear.id,
            status: journalStatuses.posted,
            is_deleted: false
          },
          firma_konto: {
            firma_id: targetYear.firma.id
          },
          OR: accountClassFilter(["0", "1", "2", "3", "4", "5", "6"])
        },
        select: {
          duguje: true,
          potrazuje: true,
          komitent_id: true,
          komitent: {
            select: {
              naziv: true
            }
          },
          firma_konto: {
            select: {
              id: true,
              sifra: true,
              naziv: true
            }
          }
        }
      })
    : [];
  const openingLines = buildOpeningBalanceLines(
    sourceLines.filter((line) => /^[0-4]/.test(line.firma_konto.sifra))
  );
  const unclosedResultLines = buildOpeningBalanceLines(
    sourceLines.filter((line) => /^[56]/.test(line.firma_konto.sifra))
  );
  const totals = openingBalanceTotals(openingLines);
  const difference = totals.debitCents - totals.creditCents;
  const canGenerate =
    !targetYear.zakljucena &&
    canCreateOpening &&
    Boolean(sourceYear) &&
    Boolean(journalType) &&
    !existingJournal &&
    openingLines.length > 0 &&
    totals.debitCents > 0 &&
    difference === 0;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h1>Početno stanje</h1>
          <p>
            {targetYear.firma.naziv} / {targetYear.godina}
          </p>
        </div>
        <Link className="secondary-button" href="/agencija/nalozi/bruto-bilans">
          Bruto bilans
        </Link>
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h2>Automatski prenos</h2>
            <span>
              Prenose se završna salda konta klasa 0, 1, 2, 3 i 4 iz{" "}
              {sourceYear?.godina ?? targetYear.godina - 1}. godine.
            </span>
          </div>
          {sourceYear ? (
            <span
              className={
                sourceYear.zakljucena
                  ? "status-pill status-pill--success"
                  : "status-pill status-pill--warning"
              }
            >
              Prethodna godina {sourceYear.zakljucena ? "zaključana" : "otvorena"}
            </span>
          ) : null}
        </div>

        <div className="stats-grid">
          <article className="stat-card">
            <span>Stavki za prenos</span>
            <strong>{openingLines.length}</strong>
          </article>
          <article className="stat-card">
            <span>Ukupno duguje</span>
            <strong>{money(totals.debitCents)}</strong>
          </article>
          <article className="stat-card">
            <span>Ukupno potražuje</span>
            <strong>{money(totals.creditCents)}</strong>
          </article>
          <article className="stat-card">
            <span>Razlika</span>
            <strong>{money(Math.abs(difference))}</strong>
          </article>
        </div>

        {!sourceYear ? (
          <p className="admin-message">
            Za firmu nije pronađena poslovna godina {targetYear.godina - 1}.
          </p>
        ) : !sourceYear.zakljucena ? (
          <p className="admin-message">
            Prethodna godina još nije zaključana. Prenos je dozvoljen, ali se nalog mora
            ponovo provjeriti ako se prethodna godina naknadno mijenja.
          </p>
        ) : null}

        {targetYear.zakljucena ? (
          <p className="admin-message">
            Poslovna godina {targetYear.godina} je zaključana i početno stanje se ne može
            kreirati.
          </p>
        ) : null}

        {!journalType ? (
          <p className="admin-message">
            Nedostaje aktivna sistemska vrsta naloga Početno stanje.
          </p>
        ) : null}

        {!canCreateOpening ? (
          <p className="admin-message">
            Nemate pravo za kreiranje naloga ove firme.
          </p>
        ) : null}

        {sourceYear && openingLines.length === 0 ? (
          <p className="admin-message">
            U {sourceYear.godina}. godini nema salda na kontima klasa 0–4 za prenos.
          </p>
        ) : null}

        {difference !== 0 ? (
          <p className="admin-message">
            Salda klasa 0–4 nijesu izbalansirana za {money(Math.abs(difference))}. Prvo
            završite zatvaranje konta klasa 5 i 6 u prethodnoj godini.
          </p>
        ) : null}

        {unclosedResultLines.length > 0 ? (
          <p className="admin-message">
            Klase 5 i 6 nijesu zatvorene. Saldo imaju konta{" "}
            {Array.from(new Set(unclosedResultLines.map((line) => line.accountCode))).join(", ")}.
            Ta konta se neće prenijeti; provjerite zaključna knjiženja prethodne godine.
          </p>
        ) : null}

        {existingJournal ? (
          <div className="admin-message">
            Početno stanje već postoji:{" "}
            <Link href={`/agencija/nalozi/${existingJournal.id}`}>
              {existingJournal.sifra ?? "otvori nalog"}
            </Link>{" "}
            ({journalStatusLabel(existingJournal.status)}).
          </div>
        ) : (
          <form action={generateOpeningBalance}>
            <input name="firma_id" type="hidden" value={targetYear.firma.id} />
            <input name="poslovna_godina_id" type="hidden" value={targetYear.id} />
            <button className="primary-button" disabled={!canGenerate} type="submit">
              Kreiraj nalog početnog stanja
            </button>
          </form>
        )}
      </section>

      {openingLines.length > 0 ? (
        <section className="admin-panel">
          <div className="panel-header">
            <div>
              <h2>Predlog stavki</h2>
              <span>Nalog će biti kreiran kao nacrt za pregled i knjiženje.</span>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Konto</th>
                  <th>Naziv</th>
                  <th>Partner</th>
                  <th className="num-cell">Duguje</th>
                  <th className="num-cell">Potražuje</th>
                </tr>
              </thead>
              <tbody>
                {openingLines.map((line) => (
                  <tr key={`${line.accountId}:${line.partnerId ?? ""}`}>
                    <td>{line.accountCode}</td>
                    <td>{line.accountName}</td>
                    <td>{line.partnerName ?? "-"}</td>
                    <td className="num-cell">
                      {line.debitCents > 0 ? money(line.debitCents) : ""}
                    </td>
                    <td className="num-cell">
                      {line.creditCents > 0 ? money(line.creditCents) : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={3}>Ukupno</th>
                  <th className="num-cell">{money(totals.debitCents)}</th>
                  <th className="num-cell">{money(totals.creditCents)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
