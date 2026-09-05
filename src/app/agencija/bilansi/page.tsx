import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import { requireAnyRole } from "@/lib/auth";
import { journalStatuses } from "@/lib/journals";
import { requirePermissionForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

const OPENING_BALANCE_SIFRA = "OPENING_BALANCE";

type BilansiPageProps = {
  searchParams?: Promise<{
    nulte?: string;
  }>;
};

function money(value: number) {
  return value.toLocaleString("sr-Latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function tipLabel(tip: string) {
  return tip === "analiticko" ? "A" : "S";
}

export default async function BilansiPage({ searchParams }: BilansiPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const params = await searchParams;
  const prikaziNulte = params?.nulte === "1";
  const workContext = await readWorkContext();

  if (!user.agencija_id) {
    return null;
  }

  const activeCompany = workContext.firmaId
    ? await prisma.firma.findFirst({
        where: {
          id: workContext.firmaId,
          agencija_id: user.agencija_id,
          is_deleted: false,
          aktivan: true,
          ...(user.rola === "admin_agencije"
            ? {}
            : {
                korisnici: {
                  some: { korisnik_id: user.id, is_deleted: false }
                }
              })
        },
        select: { id: true, naziv: true }
      })
    : null;

  const activeYear =
    activeCompany && workContext.poslovnaGodinaId
      ? await prisma.poslovnaGodina.findFirst({
          where: {
            id: workContext.poslovnaGodinaId,
            firma_id: activeCompany.id
          },
          select: { id: true, godina: true, zakljucena: true }
        })
      : null;

  if (activeCompany) {
    await requirePermissionForUser(user, {
      firmaId: activeCompany.id,
      modul: "nalozi",
      akcija: "view"
    });
  }

  const baseWhere = {
    firma_id: activeCompany?.id ?? "",
    poslovna_godina_id: activeYear?.id ?? "",
    status: journalStatuses.posted,
    is_deleted: false
  };

  const [psGroupBy, prometGroupBy, firmaKonta, ukupnoNaloga] =
    activeCompany && activeYear
      ? await Promise.all([
          prisma.stavkaNaloga.groupBy({
            by: ["konto_id"],
            where: {
              nalog: {
                ...baseWhere,
                vrsta_naloga: { sifra: OPENING_BALANCE_SIFRA }
              }
            },
            _sum: { duguje: true, potrazuje: true }
          }),
          prisma.stavkaNaloga.groupBy({
            by: ["konto_id"],
            where: {
              nalog: {
                ...baseWhere,
                vrsta_naloga: { sifra: { not: OPENING_BALANCE_SIFRA } }
              }
            },
            _sum: { duguje: true, potrazuje: true }
          }),
          prisma.firmaKonto.findMany({
            where: { firma_id: activeCompany.id, aktivan: true },
            select: { id: true, sifra: true, naziv: true, tip_konta: true },
            orderBy: { sifra: "asc" }
          }),
          prisma.nalog.count({ where: baseWhere })
        ])
      : [[], [], [], 0];

  const psMap = new Map(
    psGroupBy.map((r) => [
      r.konto_id,
      { duguje: Number(r._sum.duguje ?? 0), potrazuje: Number(r._sum.potrazuje ?? 0) }
    ])
  );

  const prometMap = new Map(
    prometGroupBy.map((r) => [
      r.konto_id,
      { duguje: Number(r._sum.duguje ?? 0), potrazuje: Number(r._sum.potrazuje ?? 0) }
    ])
  );

  const rows = firmaKonta
    .map((konto) => {
      const ps = psMap.get(konto.id) ?? { duguje: 0, potrazuje: 0 };
      const promet = prometMap.get(konto.id) ?? { duguje: 0, potrazuje: 0 };
      const ukupnoDuguje = ps.duguje + promet.duguje;
      const ukupnoPotrazuje = ps.potrazuje + promet.potrazuje;

      return {
        ...konto,
        psDuguje: ps.duguje,
        psPotrazuje: ps.potrazuje,
        prometDuguje: promet.duguje,
        prometPotrazuje: promet.potrazuje,
        saldoDuguje: Math.max(ukupnoDuguje - ukupnoPotrazuje, 0),
        saldoPotrazuje: Math.max(ukupnoPotrazuje - ukupnoDuguje, 0),
        imaPromet:
          ps.duguje + ps.potrazuje + promet.duguje + promet.potrazuje > 0
      };
    })
    .filter((row) => prikaziNulte || row.imaPromet);

  const totals = rows.reduce(
    (acc, row) => ({
      psDuguje: acc.psDuguje + row.psDuguje,
      psPotrazuje: acc.psPotrazuje + row.psPotrazuje,
      prometDuguje: acc.prometDuguje + row.prometDuguje,
      prometPotrazuje: acc.prometPotrazuje + row.prometPotrazuje,
      saldoDuguje: acc.saldoDuguje + row.saldoDuguje,
      saldoPotrazuje: acc.saldoPotrazuje + row.saldoPotrazuje
    }),
    {
      psDuguje: 0,
      psPotrazuje: 0,
      prometDuguje: 0,
      prometPotrazuje: 0,
      saldoDuguje: 0,
      saldoPotrazuje: 0
    }
  );

  const nulteUrl = prikaziNulte ? "/agencija/bilansi" : "/agencija/bilansi?nulte=1";

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Bruto bilans</h2>
        </div>
        <div className="header-actions">
          {activeCompany && activeYear ? (
            <PrintButton label="Štampaj" />
          ) : null}
        </div>
      </header>

      {!activeCompany || !activeYear ? (
        <section className="admin-panel">
          <h3>Izaberite firmu i poslovnu godinu</h3>
          <p className="empty-state">
            Bruto bilans se prikazuje za aktivnu firmu i godinu iz gornje trake.
          </p>
        </section>
      ) : (
        <>
          <section className="metric-grid">
            <div className="metric">
              <span>Firma</span>
              <strong className="metric-text">{activeCompany.naziv}</strong>
            </div>
            <div className="metric">
              <span>Godina</span>
              <strong>{activeYear.godina}</strong>
              {activeYear.zakljucena ? (
                <small>Zaključena</small>
              ) : null}
            </div>
            <div className="metric">
              <span>Konta sa prometom</span>
              <strong>{rows.filter((r) => r.imaPromet).length}</strong>
            </div>
            <div className="metric">
              <span>Proknjiženih naloga</span>
              <strong>{ukupnoNaloga}</strong>
            </div>
          </section>

          <section className="admin-panel">
            <div className="panel-header">
              <h3>Bruto bilans</h3>
              <Link className="table-link" href={nulteUrl}>
                {prikaziNulte ? "Sakrij nulta konta" : "Prikaži nulta konta"}
              </Link>
            </div>

            {rows.length === 0 ? (
              <p className="empty-state">
                Nema proknjiženih naloga za izabranu firmu i godinu.
              </p>
            ) : (
              <div className="table-wrap">
                <table className="bilans-table">
                  <thead>
                    <tr>
                      <th>Konto</th>
                      <th>Naziv</th>
                      <th>T</th>
                      <th className="num-col">PS Duguje</th>
                      <th className="num-col">PS Potražuje</th>
                      <th className="num-col">Promet D</th>
                      <th className="num-col">Promet P</th>
                      <th className="num-col">Saldo D</th>
                      <th className="num-col">Saldo P</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.sifra}</strong>
                        </td>
                        <td>{row.naziv}</td>
                        <td>{tipLabel(row.tip_konta)}</td>
                        <td className="num-col">
                          {row.psDuguje > 0 ? money(row.psDuguje) : "-"}
                        </td>
                        <td className="num-col">
                          {row.psPotrazuje > 0 ? money(row.psPotrazuje) : "-"}
                        </td>
                        <td className="num-col">
                          {row.prometDuguje > 0 ? money(row.prometDuguje) : "-"}
                        </td>
                        <td className="num-col">
                          {row.prometPotrazuje > 0
                            ? money(row.prometPotrazuje)
                            : "-"}
                        </td>
                        <td className="num-col">
                          {row.saldoDuguje > 0 ? money(row.saldoDuguje) : "-"}
                        </td>
                        <td className="num-col">
                          {row.saldoPotrazuje > 0
                            ? money(row.saldoPotrazuje)
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="totals-row">
                      <td colSpan={3}>
                        <strong>Ukupno</strong>
                      </td>
                      <td className="num-col">
                        <strong>{money(totals.psDuguje)}</strong>
                      </td>
                      <td className="num-col">
                        <strong>{money(totals.psPotrazuje)}</strong>
                      </td>
                      <td className="num-col">
                        <strong>{money(totals.prometDuguje)}</strong>
                      </td>
                      <td className="num-col">
                        <strong>{money(totals.prometPotrazuje)}</strong>
                      </td>
                      <td className="num-col">
                        <strong>{money(totals.saldoDuguje)}</strong>
                      </td>
                      <td className="num-col">
                        <strong>{money(totals.saldoPotrazuje)}</strong>
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
