import type { Prisma } from "@prisma/client";
import { PrintButton } from "@/components/PrintButton";
import { requireAnyRole } from "@/lib/auth";
import { hasAnyPermissionSet } from "@/lib/permissions";
import { formatJournalCode } from "@/lib/journals";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type KarticaKontaPrintPageProps = {
  searchParams?: Promise<{
    datum_do?: string;
    datum_od?: string;
    konto?: string;
    partner?: string;
    partner_q?: string;
    jedinica?: string;
  }>;
};

function money(value: number) {
  return value.toLocaleString("sr-Latn-ME", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseDateFilter(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function displayDate(value: Date | string) {
  const date = typeof value === "string" ? parseDateFilter(value) : value;
  return date?.toLocaleDateString("sr-Latn-ME") ?? "-";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function balance(value: number) {
  if (value > 0) return `D ${money(value)}`;
  if (value < 0) return `P ${money(Math.abs(value))}`;
  return "0,00";
}

function PrintMessage({ children }: { children: React.ReactNode }) {
  return (
    <main className="print-page">
      <section className="account-card-print-document">
        <h1>Kartica konta</h1>
        <p>{children}</p>
      </section>
    </main>
  );
}

export default async function KarticaKontaPrintPage({
  searchParams
}: KarticaKontaPrintPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();
  const params = await searchParams;
  const selectedAccount = params?.konto ?? "";
  const selectedPartner = params?.partner ?? "";
  const selectedPartnerQuery = params?.partner_q?.trim() ?? "";
  const dateFrom = parseDateFilter(params?.datum_od);
  const dateTo = parseDateFilter(params?.datum_do);
  const selectedBusinessUnit = params?.jedinica ?? "ALL";

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return <PrintMessage>Izaberite firmu i poslovnu godinu prije štampe.</PrintMessage>;
  }

  const printAllowed = await hasAnyPermissionSet(user, [
    [
      { firmaId: workContext.firmaId, modul: "nalozi", akcija: "view" },
      { firmaId: workContext.firmaId, modul: "nalozi", akcija: "export" }
    ],
    [
      { firmaId: workContext.firmaId, modul: "izvjestaji", akcija: "view" },
      { firmaId: workContext.firmaId, modul: "izvjestaji", akcija: "export" }
    ]
  ]);

  if (!printAllowed) {
    return <PrintMessage>Nemate pravo štampe kartice konta.</PrintMessage>;
  }

  if (!isUuid(selectedAccount)) {
    return <PrintMessage>Izaberite konto čiju karticu želite da štampate.</PrintMessage>;
  }

  if (selectedPartner && selectedPartner !== "ALL" && !isUuid(selectedPartner)) {
    return <PrintMessage>Izabrani partner nije ispravan.</PrintMessage>;
  }

  if (selectedBusinessUnit !== "ALL" && selectedBusinessUnit !== "NONE" && !isUuid(selectedBusinessUnit)) {
    return <PrintMessage>Izabrana poslovna jedinica nije ispravna.</PrintMessage>;
  }

  const firmaId = workContext.firmaId;
  const poslovnaGodinaId = workContext.poslovnaGodinaId;

  const [firma, godina, account] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: firmaId,
        agencija_id: user.agencija_id,
        aktivan: true,
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
        naziv: true,
        pib: true
      }
    }),
    prisma.poslovnaGodina.findFirst({
      where: {
        id: poslovnaGodinaId,
        firma_id: firmaId
      },
      select: {
        godina: true
      }
    }),
    prisma.firmaKonto.findFirst({
      where: {
        id: selectedAccount,
        firma_id: firmaId,
        aktivan: true
      },
      select: {
        id: true,
        sifra: true,
        naziv: true
      }
    })
  ]);

  if (!firma || !godina || !account) {
    return <PrintMessage>Konto nije pronađen u izabranoj firmi i poslovnoj godini.</PrintMessage>;
  }

  const scopedPartner =
    selectedPartner && selectedPartner !== "ALL" && isUuid(selectedPartner)
      ? await prisma.komitent.findFirst({
          where: {
            id: selectedPartner,
            aktivan: true,
            OR: [
              { scope: "GLOBAL" },
              { scope: "AGENCY", agencija_id: user.agencija_id },
              { scope: "COMPANY", firma_id: firmaId }
            ]
          },
          select: {
            id: true,
            naziv: true,
            pib: true
          }
        })
      : null;

  if (selectedPartner && selectedPartner !== "ALL" && !scopedPartner) {
    return <PrintMessage>Izabrani partner nije dostupan u ovoj firmi.</PrintMessage>;
  }

  const accountId = account.id;
  const partnerQueryDigits = selectedPartnerQuery.replace(/\D/g, "");
  const partnerFilter: Prisma.StavkaNalogaWhereInput = scopedPartner
    ? { komitent_id: scopedPartner.id }
    : selectedPartnerQuery.length >= 2
      ? {
          komitent: {
            OR: [
              {
                naziv: {
                  contains: selectedPartnerQuery,
                  mode: "insensitive"
                }
              },
              ...(partnerQueryDigits
                ? [
                    {
                      pib: {
                        contains: partnerQueryDigits
                      }
                    }
                  ]
                : [])
            ]
          }
        }
      : {};

  function linesWhere(dateFilter?: Prisma.DateTimeFilter): Prisma.StavkaNalogaWhereInput {
    return {
      konto_id: accountId,
      ...partnerFilter,
      ...(selectedBusinessUnit !== "ALL"
        ? { poslovna_jedinica_id: selectedBusinessUnit === "NONE" ? null : selectedBusinessUnit }
        : {}),
      nalog: {
        firma_id: firmaId,
        poslovna_godina_id: poslovnaGodinaId,
        status: "POSTED",
        is_deleted: false,
        ...(dateFilter ? { datum: dateFilter } : {})
      }
    };
  }

  const [openingTotals, lines] = await Promise.all([
    dateFrom
      ? prisma.stavkaNaloga.aggregate({
          where: linesWhere({ lt: dateFrom }),
          _sum: {
            duguje: true,
            potrazuje: true
          }
        })
      : Promise.resolve({ _sum: { duguje: null, potrazuje: null } }),
    prisma.stavkaNaloga.findMany({
      where: linesWhere({
        ...(dateFrom ? { gte: dateFrom } : {}),
        ...(dateTo ? { lte: dateTo } : {})
      }),
      orderBy: [
        { nalog: { datum: "asc" } },
        { nalog: { created_at: "asc" } },
        { redni_broj: "asc" }
      ],
      select: {
        id: true,
        broj_dokumenta: true,
        duguje: true,
        opis: true,
        potrazuje: true,
        komitent: {
          select: {
            naziv: true,
            pib: true
          }
        },
        nalog: {
          select: {
            broj: true,
            datum: true,
            opis: true,
            sifra: true,
            poslovna_godina: {
              select: {
                godina: true
              }
            },
            vrsta_naloga: {
              select: {
                naziv: true,
                prefiks: true
              }
            }
          }
        }
      }
    })
  ]);

  const openingBalance =
    Number(openingTotals._sum.duguje ?? 0) - Number(openingTotals._sum.potrazuje ?? 0);
  let runningBalance = openingBalance;
  const rows = lines.map((line) => {
    const debit = Number(line.duguje);
    const credit = Number(line.potrazuje);
    runningBalance += debit - credit;

    return {
      ...line,
      credit,
      debit,
      journalCode:
        line.nalog.sifra ||
        formatJournalCode(
          line.nalog.vrsta_naloga.prefiks,
          line.nalog.poslovna_godina.godina,
          line.nalog.broj
        ),
      runningBalance
    };
  });
  const totalDebit = rows.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = rows.reduce((sum, row) => sum + row.credit, 0);
  const closingBalance = openingBalance + totalDebit - totalCredit;
  const periodLabel =
    dateFrom || dateTo
      ? `${dateFrom ? displayDate(dateFrom) : "Početak godine"} — ${
          dateTo ? displayDate(dateTo) : "Kraj godine"
        }`
      : "Cijela godina";
  const partnerLabel = scopedPartner
    ? `${scopedPartner.naziv}${scopedPartner.pib ? ` · PIB ${scopedPartner.pib}` : ""}`
    : selectedPartnerQuery || "Svi partneri";

  return (
    <main className="print-page account-card-print-page">
      <style>{`@page { size: A4 landscape; margin: 10mm; }`}</style>
      <div className="print-toolbar account-card-print-toolbar">
        <PrintButton label="Štampaj karticu" />
      </div>
      <section className="account-card-print-document">
        <header className="account-card-print-header">
          <div>
            <p>Kartica konta</p>
            <h1>
              {account.sifra} — {account.naziv}
            </h1>
            <span>
              {firma.naziv}
              {firma.pib ? ` · PIB ${firma.pib}` : ""} · {godina.godina}
            </span>
          </div>
          <div className="account-card-print-period">
            <span>Period</span>
            <strong>{periodLabel}</strong>
            <small>{partnerLabel}</small>
          </div>
        </header>

        <section className="account-card-print-summary" aria-label="Sažetak kartice">
          <div>
            <span>Početni saldo</span>
            <strong>{balance(openingBalance)}</strong>
          </div>
          <div>
            <span>Duguje u periodu</span>
            <strong>{money(totalDebit)}</strong>
          </div>
          <div>
            <span>Potražuje u periodu</span>
            <strong>{money(totalCredit)}</strong>
          </div>
          <div>
            <span>Krajnji saldo</span>
            <strong>{balance(closingBalance)}</strong>
          </div>
        </section>

        <table className="account-card-print-table">
          <colgroup>
            <col className="account-card-print-col-date" />
            <col className="account-card-print-col-journal" />
            <col className="account-card-print-col-partner" />
            <col className="account-card-print-col-document" />
            <col className="account-card-print-col-description" />
            <col className="account-card-print-col-amount" span={3} />
          </colgroup>
          <thead>
            <tr>
              <th>Datum</th>
              <th>Nalog</th>
              <th>Partner</th>
              <th>Dokument</th>
              <th>Opis</th>
              <th>Duguje</th>
              <th>Potražuje</th>
              <th>Saldo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{displayDate(row.nalog.datum)}</td>
                <td>
                  <strong>{row.journalCode}</strong>
                  <small>{row.nalog.vrsta_naloga.naziv}</small>
                </td>
                <td>
                  {row.komitent?.naziv ?? "-"}
                  {row.komitent?.pib ? <small>PIB {row.komitent.pib}</small> : null}
                </td>
                <td>{row.broj_dokumenta || "-"}</td>
                <td>{row.opis || row.nalog.opis || "-"}</td>
                <td>{money(row.debit)}</td>
                <td>{money(row.credit)}</td>
                <td>{balance(row.runningBalance)}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8}>Nema proknjiženih stavki za izabrane uslove.</td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>Ukupno za period</td>
              <td>{money(totalDebit)}</td>
              <td>{money(totalCredit)}</td>
              <td>{balance(closingBalance)}</td>
            </tr>
          </tfoot>
        </table>
      </section>
    </main>
  );
}
