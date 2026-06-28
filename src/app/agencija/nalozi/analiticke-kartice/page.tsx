import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AutoSubmitFilterForm } from "@/components/AutoSubmitFilterForm";
import { PartnerFilterSelect } from "@/components/PartnerFilterSelect";
import { requireAnyRole } from "@/lib/auth";
import { formatJournalCode } from "@/lib/journals";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type AnalitickeKarticePageProps = {
  searchParams?: Promise<{
    datum_do?: string;
    datum_od?: string;
    konto?: string;
    konto_prefix?: string;
    partner?: string;
  }>;
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

function formatDate(date: Date) {
  return date.toLocaleDateString("sr-Latn");
}

export default async function AnalitickeKarticePage({
  searchParams
}: AnalitickeKarticePageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();
  const params = await searchParams;
  const selectedAccount = params?.konto ?? "";
  const selectedAccountPrefix = params?.konto_prefix?.trim() ?? "";
  const selectedPartner = params?.partner ?? "";
  const dateFrom = parseDateFilter(params?.datum_od);
  const dateTo = parseDateFilter(params?.datum_do);

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return (
      <div className="admin-stack">
        <header className="admin-header">
          <div>
            <h1>Analitičke kartice</h1>
          </div>
        </header>
        <section className="admin-card">
          <p className="muted">Izaberite firmu i poslovnu godinu u gornjem izboru.</p>
        </section>
      </div>
    );
  }

  const [firma, godina, accounts] = await Promise.all([
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
        aktivan: true,
        tip_konta: "analiticko"
      },
      orderBy: {
        sifra: "asc"
      },
      select: {
        id: true,
        sifra: true,
        naziv: true
      }
    })
  ]);

  if (!firma || !godina) {
    return null;
  }

  const selectedPartnerRecord =
    selectedPartner && selectedPartner !== "ALL"
      ? await prisma.komitent.findUnique({
          where: { id: selectedPartner },
          select: { naziv: true, pib: true }
        })
      : null;

  const selectedPartnerLabel = selectedPartnerRecord
    ? `${selectedPartnerRecord.naziv}${
        selectedPartnerRecord.pib ? ` (${selectedPartnerRecord.pib})` : ""
      }`
    : "";

  const where: Prisma.StavkaNalogaWhereInput = {
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
      : selectedAccountPrefix
        ? {
            firma_konto: {
              sifra: {
                startsWith: selectedAccountPrefix
              }
            }
          }
      : {}),
    ...(selectedPartner && selectedPartner !== "ALL"
      ? {
          komitent_id: selectedPartner
        }
      : {})
  };

  const lines =
    selectedAccount || selectedAccountPrefix || selectedPartner || dateFrom || dateTo
      ? await prisma.stavkaNaloga.findMany({
          where,
          orderBy: [
            {
              nalog: {
                datum: "asc"
              }
            },
            {
              nalog: {
                created_at: "asc"
              }
            },
            {
              redni_broj: "asc"
            }
          ],
          select: {
            id: true,
            duguje: true,
            potrazuje: true,
            opis: true,
            redni_broj: true,
            firma_konto: {
              select: {
                sifra: true,
                naziv: true
              }
            },
            komitent: {
              select: {
                naziv: true,
                pib: true
              }
            },
            nalog: {
              select: {
                id: true,
                sifra: true,
                broj: true,
                datum: true,
                opis: true,
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
      : [];

  let runningBalance = 0;
  const rows = lines.map((line) => {
    const debit = Number(line.duguje);
    const credit = Number(line.potrazuje);
    runningBalance += debit - credit;

    return {
      ...line,
      credit,
      debit,
      runningBalance
    };
  });
  const totalDebit = rows.reduce((sum, row) => sum + row.debit, 0);
  const totalCredit = rows.reduce((sum, row) => sum + row.credit, 0);
  const totalBalance = totalDebit - totalCredit;

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h1>Analitičke kartice</h1>
        </div>
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
          <span>Saldo</span>
          <strong>{money(totalBalance)}</strong>
        </article>
      </section>

      <section className="admin-card">
        <div className="card-header">
          <h2>Filteri</h2>
          <span>
            {selectedAccountPrefix ? `Prefiks konta ${selectedAccountPrefix} · ` : ""}
            {rows.length} stavki
          </span>
        </div>
        <AutoSubmitFilterForm
          action="/agencija/nalozi/analiticke-kartice"
          className="admin-form journal-filter-form"
        >
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
          {selectedAccountPrefix ? (
            <input name="konto_prefix" type="hidden" value={selectedAccountPrefix} />
          ) : null}
          <label>
            <span>Partner</span>
            <PartnerFilterSelect
              initialId={selectedPartner}
              initialLabel={selectedPartnerLabel}
              name="partner"
            />
          </label>
          <label>
            <span>Datum od</span>
            <input defaultValue={params?.datum_od ?? ""} name="datum_od" type="date" />
          </label>
          <label>
            <span>Datum do</span>
            <input defaultValue={params?.datum_do ?? ""} name="datum_do" type="date" />
          </label>
        </AutoSubmitFilterForm>
      </section>

      <section className="admin-card">
        <div className="card-header">
          <h2>Kartica</h2>
          <span>
            Duguje {money(totalDebit)} · Potražuje {money(totalCredit)}
          </span>
        </div>
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Nalog</th>
                <th>Konto</th>
                <th>Partner</th>
                <th>Opis</th>
                <th>Duguje</th>
                <th>Potražuje</th>
                <th>Saldo</th>
                <th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const journalCode =
                  row.nalog.sifra ||
                  formatJournalCode(
                    row.nalog.vrsta_naloga.prefiks,
                    row.nalog.poslovna_godina.godina,
                    row.nalog.broj
                  );

                return (
                  <tr key={row.id}>
                    <td>{formatDate(row.nalog.datum)}</td>
                    <td>
                      <strong>{journalCode}</strong>
                      <small>{row.nalog.vrsta_naloga.naziv}</small>
                    </td>
                    <td>
                      {row.firma_konto.sifra}
                      <small>{row.firma_konto.naziv}</small>
                    </td>
                    <td>
                      {row.komitent?.naziv ?? "-"}
                      <small>{row.komitent?.pib ?? ""}</small>
                    </td>
                    <td>{row.opis || row.nalog.opis || "-"}</td>
                    <td>{money(row.debit)}</td>
                    <td>{money(row.credit)}</td>
                    <td>{money(row.runningBalance)}</td>
                    <td>
                      <Link className="table-link" href={`/agencija/nalozi/${row.nalog.id}`}>
                        Otvori
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    Izaberite filtere ili nema proknjiženih stavki za izabrane uslove.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
