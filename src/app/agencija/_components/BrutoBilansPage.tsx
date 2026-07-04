import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AutoSubmitFilterForm } from "@/components/AutoSubmitFilterForm";
import { BalanceLevelCheckboxes } from "@/components/BalanceLevelCheckboxes";
import { requireAnyRole } from "@/lib/auth";
import { standardJournalTypes } from "@/lib/journals";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type BrutoBilansPageProps = {
  searchParams?: Promise<{
    datum_do?: string;
    datum_od?: string;
    klasa?: string;
    konto?: string;
    nivo?: string;
    samo_zbir?: string;
  }>;
  basePath?: string;
};

function money(value: number) {
  return value.toLocaleString("sr-Latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseDateFilter(value?: string) {
  if (!value) {
    return null;
  }

  return new Date(`${value}T00:00:00.000Z`);
}

function analyticsHref(
  accountPrefix: string,
  params?: Awaited<BrutoBilansPageProps["searchParams"]>
) {
  const query = new URLSearchParams({
    konto_prefix: accountPrefix
  });

  if (params?.datum_od) {
    query.set("datum_od", params.datum_od);
  }

  if (params?.datum_do) {
    query.set("datum_do", params.datum_do);
  }

  return `/agencija/nalozi/analiticke-kartice?${query.toString()}`;
}

function printHref(params?: Awaited<BrutoBilansPageProps["searchParams"]>) {
  const query = new URLSearchParams();

  if (params?.klasa) {
    query.set("klasa", params.klasa);
  }

  if (params?.konto) {
    query.set("konto", params.konto);
  }

  if (params?.datum_od) {
    query.set("datum_od", params.datum_od);
  }

  if (params?.datum_do) {
    query.set("datum_do", params.datum_do);
  }

  if (params?.nivo) {
    query.set("nivo", params.nivo);
  }

  if (params?.samo_zbir) {
    query.set("samo_zbir", params.samo_zbir);
  }

  const suffix = query.toString();

  return `/stampa/bruto-bilans${suffix ? `?${suffix}` : ""}`;
}

function parseAggregationLevel(value?: string) {
  if (!value) {
    return null;
  }

  const level = Number(value);

  return [1, 2, 3, 4].includes(level) ? level : null;
}

const openingBalanceType = standardJournalTypes[0][0];

export async function BrutoBilansPage({
  basePath = "/agencija/nalozi/bruto-bilans",
  searchParams
}: BrutoBilansPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();
  const params = await searchParams;
  const selectedAccount = params?.konto ?? "";
  const selectedClass = params?.klasa ?? "";
  const aggregationLevel = parseAggregationLevel(params?.nivo);
  const summaryOnly = params?.samo_zbir === "1" && aggregationLevel !== null;
  const dateFrom = parseDateFilter(params?.datum_od);
  const dateTo = parseDateFilter(params?.datum_do);

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return (
      <div className="admin-stack">
        <header className="admin-header">
          <div>
            <h1>Bruto bilans</h1>
          </div>
        </header>
        <section className="admin-card">
          <p className="muted">Izaberite firmu i poslovnu godinu u gornjem izboru.</p>
        </section>
      </div>
    );
  }

  const [firma, godina, accounts, stavke] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: workContext.firmaId,
        agencija_id: user.agencija_id,
        is_deleted: false,
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
        naziv: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: workContext.poslovnaGodinaId,
        firma_id: workContext.firmaId
      },
      select: {
        godina: true
      }
    }),
    prisma.firmaKonto.findMany({
      where: {
        firma_id: workContext.firmaId,
        aktivan: true
      },
      orderBy: {
        sifra: "asc"
      },
      select: {
        id: true,
        sifra: true,
        naziv: true
      }
    }),
    prisma.stavkaNaloga.findMany({
      where: {
        nalog: {
          firma_id: workContext.firmaId,
          poslovna_godina_id: workContext.poslovnaGodinaId,
          status: "POSTED",
          is_deleted: false,
          ...(dateFrom || dateTo
            ? {
                datum: {
                  ...(dateFrom ? { gte: dateFrom } : {}),
                  ...(dateTo ? { lte: dateTo } : {})
                }
              }
            : {})
        },
        ...(selectedAccount && selectedAccount !== "ALL"
          ? {
              konto_id: selectedAccount
            }
          : {}),
        ...(selectedClass && selectedClass !== "ALL"
          ? {
              firma_konto: {
                sifra: {
                  startsWith: selectedClass
                }
              }
            }
          : {})
      } satisfies Prisma.StavkaNalogaWhereInput,
      select: {
        duguje: true,
        potrazuje: true,
        nalog: {
          select: {
            vrsta_naloga: {
              select: {
                sifra: true
              }
            }
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
  ]);

  if (!firma || !godina) {
    return null;
  }

  const classes = Array.from(
    new Set(accounts.map((account) => account.sifra.charAt(0)).filter(Boolean))
  ).sort();
  const accountNamesByCode = new Map(
    accounts.map((account) => [account.sifra, account.naziv])
  );

  const detailedRows = Array.from(
    stavke
      .reduce((map, stavka) => {
        const key = stavka.firma_konto.sifra;
        const isOpeningBalance = stavka.nalog.vrsta_naloga.sifra === openingBalanceType;
        const existing = map.get(key) ?? {
          naziv: stavka.firma_konto.naziv,
          sifra: key,
          pocetnoDuguje: 0,
          pocetnoPotrazuje: 0,
          duguje: 0,
          potrazuje: 0
        };

        if (isOpeningBalance) {
          existing.pocetnoDuguje += Number(stavka.duguje);
          existing.pocetnoPotrazuje += Number(stavka.potrazuje);
        } else {
          existing.duguje += Number(stavka.duguje);
          existing.potrazuje += Number(stavka.potrazuje);
        }

        map.set(key, existing);

        return map;
      }, new Map<string, { sifra: string; naziv: string; pocetnoDuguje: number; pocetnoPotrazuje: number; duguje: number; potrazuje: number }>())
      .values()
  ).sort((a, b) => a.sifra.localeCompare(b.sifra));
  const summaryRows =
    aggregationLevel === null
      ? []
      : Array.from(
          detailedRows
            .reduce((map, row) => {
              const key = row.sifra.slice(0, aggregationLevel);
              const existing = map.get(key) ?? {
                naziv:
                  accountNamesByCode.get(key) ??
                  (aggregationLevel === 1 ? `Zbir klase ${key}` : `Zbir konta ${key}`),
                sifra: key,
                pocetnoDuguje: 0,
                pocetnoPotrazuje: 0,
                duguje: 0,
                potrazuje: 0
              };

              existing.pocetnoDuguje += row.pocetnoDuguje;
              existing.pocetnoPotrazuje += row.pocetnoPotrazuje;
              existing.duguje += row.duguje;
              existing.potrazuje += row.potrazuje;
              map.set(key, existing);

              return map;
            }, new Map<string, { sifra: string; naziv: string; pocetnoDuguje: number; pocetnoPotrazuje: number; duguje: number; potrazuje: number }>())
            .values()
        ).sort((a, b) => a.sifra.localeCompare(b.sifra));
  const displayRows = summaryOnly
    ? summaryRows.map((row) => ({
        ...row,
        kind: "summary" as const
      }))
    : aggregationLevel === null
      ? detailedRows.map((row) => ({
          ...row,
          kind: "detail" as const
        }))
    : detailedRows.flatMap((row, index, allRows) => {
        const currentPrefix = row.sifra.slice(0, aggregationLevel);
        const nextPrefix = allRows[index + 1]?.sifra.slice(0, aggregationLevel);
        const subtotal = summaryRows.find((summary) => summary.sifra === currentPrefix);
        const detailRow = {
          ...row,
          kind: "detail" as const
        };

        if (currentPrefix !== nextPrefix && subtotal) {
          return [
            detailRow,
            {
              ...subtotal,
              kind: "summary" as const
            }
          ];
        }

        return [detailRow];
      });

  const totalOpeningDebit = detailedRows.reduce((sum, row) => sum + row.pocetnoDuguje, 0);
  const totalOpeningCredit = detailedRows.reduce((sum, row) => sum + row.pocetnoPotrazuje, 0);
  const totalDebit = detailedRows.reduce((sum, row) => sum + row.duguje, 0);
  const totalCredit = detailedRows.reduce((sum, row) => sum + row.potrazuje, 0);
  const totalBalance = totalOpeningDebit + totalDebit - totalOpeningCredit - totalCredit;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h1>Bruto bilans</h1>
        </div>
        <Link className="secondary-button" href={printHref(params)} target="_blank">
          Štampa
        </Link>
      </header>

      <section className="stats-grid">
        <article className="stat-card">
          <span>Firma</span>
          <strong>{firma.naziv}</strong>
        </article>
        <article className="stat-card">
          <span>Godina</span>
          <strong>{godina.godina}</strong>
        </article>
        <article className="stat-card">
          <span>Promet</span>
          <strong>
            {money(totalDebit)} / {money(totalCredit)}
          </strong>
        </article>
        <article className="stat-card">
          <span>Saldo</span>
          <strong>{money(totalBalance)}</strong>
        </article>
      </section>

      <section className="admin-card">
        <div className="card-header">
          <h2>Filteri</h2>
          <span>
            {summaryOnly ? summaryRows.length : detailedRows.length} konta
          </span>
        </div>
        <AutoSubmitFilterForm
          action={basePath}
          className="admin-form journal-filter-form balance-filter-form"
        >
          <label>
            <span>Klasa</span>
            <select name="klasa" defaultValue={selectedClass || "ALL"}>
              <option value="ALL">Sve klase</option>
              {classes.map((accountClass) => (
                <option key={accountClass} value={accountClass ?? ""}>
                  Klasa {accountClass}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Konto</span>
            <select name="konto" defaultValue={selectedAccount || "ALL"}>
              <option value="ALL">Sva konta</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.sifra} - {account.naziv}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Datum od</span>
            <input defaultValue={params?.datum_od ?? ""} name="datum_od" type="date" />
          </label>
          <label>
            <span>Datum do</span>
            <input defaultValue={params?.datum_do ?? ""} name="datum_do" type="date" />
          </label>
          <BalanceLevelCheckboxes
            defaultLevel={aggregationLevel}
            defaultSummaryOnly={summaryOnly}
          />
        </AutoSubmitFilterForm>
      </section>

      <section className="admin-card">
        <div className="card-header">
          <h2>Pregled po kontima</h2>
          <span>
            {summaryOnly
              ? "Samo zbir"
              : aggregationLevel === null
                ? "Bruto bilans bez zbirova"
                : "Detaljno sa zbirom"}{" "}
            · {displayRows.length} redova
          </span>
        </div>
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Konto</th>
                <th>Naziv</th>
                <th>Početno duguje</th>
                <th>Početno potražuje</th>
                <th>Duguje</th>
                <th>Potražuje</th>
                <th>Saldo duguje</th>
                <th>Saldo potražuje</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => {
                const saldo =
                  row.pocetnoDuguje + row.duguje - row.pocetnoPotrazuje - row.potrazuje;

                return (
                  <tr
                    className={row.kind === "summary" ? "balance-summary-row" : undefined}
                    key={`${row.kind}-${row.sifra}`}
                  >
                    <td>
                      <Link className="table-link" href={analyticsHref(row.sifra, params)}>
                        {row.sifra}
                      </Link>
                    </td>
                    <td>
                      <Link className="table-link" href={analyticsHref(row.sifra, params)}>
                        {row.naziv}
                      </Link>
                    </td>
                    <td>{money(row.pocetnoDuguje)}</td>
                    <td>{money(row.pocetnoPotrazuje)}</td>
                    <td>{money(row.duguje)}</td>
                    <td>{money(row.potrazuje)}</td>
                    <td>{saldo > 0 ? money(saldo) : "0,00"}</td>
                    <td>{saldo < 0 ? money(Math.abs(saldo)) : "0,00"}</td>
                  </tr>
                );
              })}
              {displayRows.length === 0 ? (
                <tr>
                  <td colSpan={8}>Nema proknjiženih stavki za izabrane uslove.</td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr className="balance-total-row">
                <td colSpan={2}>Ukupno</td>
                <td>{money(totalOpeningDebit)}</td>
                <td>{money(totalOpeningCredit)}</td>
                <td>{money(totalDebit)}</td>
                <td>{money(totalCredit)}</td>
                <td>{totalBalance > 0 ? money(totalBalance) : "0,00"}</td>
                <td>{totalBalance < 0 ? money(Math.abs(totalBalance)) : "0,00"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}
