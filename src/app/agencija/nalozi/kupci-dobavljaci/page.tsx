import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { AutoSubmitFilterForm } from "@/components/AutoSubmitFilterForm";
import { requireAnyRole } from "@/lib/auth";
import { requirePermissionForUser } from "@/lib/permissions";
import { journalStatuses } from "@/lib/journals";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type KupciDobavljaciPageProps = {
  searchParams?: Promise<{
    datum_do?: string;
    datum_od?: string;
    konto?: string;
  }>;
};

type PartnerSummaryRow = {
  balance: number;
  credit: number;
  debit: number;
  kontoId: string;
  kontoNaziv: string;
  kontoSifra: string;
  partnerId: string;
  partnerName: string;
  partnerPib: string | null;
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

function analyticsHref(row: PartnerSummaryRow, params?: Awaited<KupciDobavljaciPageProps["searchParams"]>) {
  const query = new URLSearchParams({
    konto: row.kontoId,
    partner: row.partnerId
  });

  if (params?.datum_od) {
    query.set("datum_od", params.datum_od);
  }

  if (params?.datum_do) {
    query.set("datum_do", params.datum_do);
  }

  return `/agencija/nalozi/analiticke-kartice?${query.toString()}`;
}

export default async function KupciDobavljaciPage({
  searchParams
}: KupciDobavljaciPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();
  const params = await searchParams;
  const selectedAccount = params?.konto ?? "";
  const dateFrom = parseDateFilter(params?.datum_od);
  const dateTo = parseDateFilter(params?.datum_do);

  if (!user.agencija_id || !workContext.firmaId || !workContext.poslovnaGodinaId) {
    return (
      <div className="admin-stack">
        <header className="admin-header">
          <div>
            <h1>Kupci / dobavljači</h1>
          </div>
        </header>
        <section className="admin-card">
          <p className="muted">Izaberite firmu i poslovnu godinu u gornjem izboru.</p>
        </section>
      </div>
    );
  }

  await requirePermissionForUser(user, {
    firmaId: workContext.firmaId,
    modul: "nalozi",
    akcija: "view"
  });

  const [firma, godina, accounts, lines] = await Promise.all([
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
        tip_konta: "analiticko",
        analitika_obavezna: true,
        stavke_naloga: {
          some: {
            komitent_id: {
              not: null
            },
            nalog: {
              firma_id: workContext.firmaId,
              poslovna_godina_id: workContext.poslovnaGodinaId,
              status: journalStatuses.posted,
              is_deleted: false
            }
          }
        }
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
        komitent_id: {
          not: null
        },
        firma_konto: {
          analitika_obavezna: true
        },
        ...(selectedAccount && selectedAccount !== "ALL"
          ? {
              konto_id: selectedAccount
            }
          : {}),
        nalog: {
          firma_id: workContext.firmaId,
          poslovna_godina_id: workContext.poslovnaGodinaId,
          status: journalStatuses.posted,
          is_deleted: false,
          ...(dateFrom || dateTo
            ? {
                datum: {
                  ...(dateFrom ? { gte: dateFrom } : {}),
                  ...(dateTo ? { lte: dateTo } : {})
                }
              }
            : {})
        }
      } satisfies Prisma.StavkaNalogaWhereInput,
      select: {
        duguje: true,
        potrazuje: true,
        firma_konto: {
          select: {
            id: true,
            sifra: true,
            naziv: true
          }
        },
        komitent: {
          select: {
            id: true,
            naziv: true,
            pib: true
          }
        }
      }
    })
  ]);

  if (!firma || !godina) {
    return null;
  }

  const rows = Array.from(
    lines
      .reduce((map, line) => {
        const partner = line.komitent;

        if (!partner) {
          return map;
        }

        const key = `${line.firma_konto.id}:${partner.id}`;
        const existing = map.get(key) ?? {
          credit: 0,
          debit: 0,
          kontoId: line.firma_konto.id,
          kontoNaziv: line.firma_konto.naziv,
          kontoSifra: line.firma_konto.sifra,
          partnerId: partner.id,
          partnerName: partner.naziv,
          partnerPib: partner.pib
        };

        existing.debit += Number(line.duguje);
        existing.credit += Number(line.potrazuje);
        map.set(key, existing);

        return map;
      }, new Map<string, Omit<PartnerSummaryRow, "balance">>())
      .values()
  )
    .map((row) => ({
      ...row,
      balance: row.debit - row.credit
    }))
    .filter((row) => Math.round(row.balance * 100) !== 0)
    .sort((first, second) => {
      if (first.kontoSifra !== second.kontoSifra) {
        return first.kontoSifra.localeCompare(second.kontoSifra);
      }

      return (
        Math.abs(second.balance) - Math.abs(first.balance) ||
        first.partnerName.localeCompare(second.partnerName)
      );
    });

  const totalDebitBalance = rows.reduce(
    (sum, row) => sum + (row.balance > 0 ? row.balance : 0),
    0
  );
  const totalCreditBalance = rows.reduce(
    (sum, row) => sum + (row.balance < 0 ? Math.abs(row.balance) : 0),
    0
  );

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h1>Kupci / dobavljači</h1>
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
          <span>Saldo duguje</span>
          <strong>{money(totalDebitBalance)}</strong>
        </article>
        <article className="stat-card">
          <span>Saldo potražuje</span>
          <strong>{money(totalCreditBalance)}</strong>
        </article>
      </section>

      <section className="admin-card">
        <div className="card-header">
          <h2>Filteri</h2>
          <span>{rows.length} partnera</span>
        </div>
        <AutoSubmitFilterForm
          action="/agencija/nalozi/kupci-dobavljaci"
          className="admin-form journal-filter-form"
        >
          <label>
            <span>Konto</span>
            <select name="konto" defaultValue={selectedAccount || "ALL"}>
              <option value="ALL">Sva konta sa analitikom</option>
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
        </AutoSubmitFilterForm>
      </section>

      <section className="admin-card">
        <div className="card-header">
          <h2>Pregled po partnerima</h2>
          <span>Otvoreni saldo po analitičkom kontu i partneru</span>
        </div>
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Konto</th>
                <th>Partner</th>
                <th>Duguje</th>
                <th>Potražuje</th>
                <th>Saldo duguje</th>
                <th>Saldo potražuje</th>
                <th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.kontoId}-${row.partnerId}`}>
                  <td>
                    {row.kontoSifra}
                    <small>{row.kontoNaziv}</small>
                  </td>
                  <td>
                    {row.partnerName}
                    <small>{row.partnerPib ?? ""}</small>
                  </td>
                  <td>{money(row.debit)}</td>
                  <td>{money(row.credit)}</td>
                  <td>
                    <strong>{row.balance > 0 ? money(row.balance) : "0,00"}</strong>
                  </td>
                  <td>
                    <strong>{row.balance < 0 ? money(Math.abs(row.balance)) : "0,00"}</strong>
                  </td>
                  <td>
                    <Link className="table-link" href={analyticsHref(row, params)}>
                      Kartica
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7}>Nema otvorenih stavki za izabrane uslove.</td>
                </tr>
              ) : null}
            </tbody>
            <tfoot>
              <tr className="balance-total-row">
                <td colSpan={2}>Ukupno</td>
                <td>{money(rows.reduce((sum, row) => sum + row.debit, 0))}</td>
                <td>{money(rows.reduce((sum, row) => sum + row.credit, 0))}</td>
                <td>{money(totalDebitBalance)}</td>
                <td>{money(totalCreditBalance)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}
