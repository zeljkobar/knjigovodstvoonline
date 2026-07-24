import Link from "next/link";
import { getPlateContext, MissingPlateContext } from "../../_shared";
import { buildIoppdMonthData, ioppdStatusesForPrint } from "@/lib/payroll-ioppd";
import { money, payrollCategoryLabel } from "@/lib/payroll";
import { prisma } from "@/lib/prisma";

function monthLabel(godina: number, mjesec: number) {
  return `${String(mjesec).padStart(2, "0")}/${godina}`;
}

function sumEmployerContributions(data: ReturnType<typeof buildIoppdMonthData>) {
  return (
    data.totals.poslodavacPioCent +
    data.totals.poslodavacZdravstvoCent +
    data.totals.poslodavacNezaposleniCent +
    data.totals.fondRadaCent
  );
}

function sumEmployeeContributions(data: ReturnType<typeof buildIoppdMonthData>) {
  return data.totals.zaposleniPioCent + data.totals.zaposleniZdravstvoCent + data.totals.zaposleniNezaposleniCent;
}

export default async function PayrollIoppdPage() {
  const context = await getPlateContext("view");

  if (!context.firma || !context.godina) {
    return <MissingPlateContext title="IOPPD" />;
  }

  if (!context.allowed) {
    return (
      <div className="admin-stack">
        <header className="admin-header">
          <div>
            <h2>IOPPD</h2>
            <p>Nemate pravo za pregled IOPPD obrasca.</p>
          </div>
        </header>
      </div>
    );
  }

  const calculations = await prisma.plateObracun.findMany({
    where: {
      agencija_id: context.user.agencija_id!,
      firma_id: context.firma.id,
      poslovna_godina_id: context.godina.id,
      status: {
        in: [...ioppdStatusesForPrint]
      },
      is_deleted: false
    },
    orderBy: [
      {
        godina: "desc"
      },
      {
        mjesec: "desc"
      },
      {
        kategorija: "asc"
      },
      {
        broj: "asc"
      }
    ],
    include: {
      radnici: {
        orderBy: {
          created_at: "asc"
        }
      },
      stavke: {
        orderBy: [
          {
            redni_broj: "asc"
          },
          {
            created_at: "asc"
          }
        ]
      }
    }
  });

  const groups = new Map<string, typeof calculations>();

  for (const calculation of calculations) {
    const key = `${calculation.godina}-${calculation.mjesec}`;
    groups.set(key, [...(groups.get(key) ?? []), calculation]);
  }

  const months = Array.from(groups.values()).map((group) => buildIoppdMonthData(group[0].godina, group[0].mjesec, group));

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>IOPPD</h2>
          <p>
            {context.firma.naziv} / {context.godina.godina}
          </p>
        </div>
      </header>

      <section className="admin-panel">
        <div className="panel-title-row">
          <div>
            <h3>Mjesečni IOPPD obrasci</h3>
            <p>
              Jedan IOPPD obuhvata sve obrađene obračune za isti mjesec: zarade, zakup, ugovore o djelu i ostale
              ugovore.
            </p>
          </div>
          <strong>{months.length} ukupno</strong>
        </div>

        <table className="admin-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Obračuni</th>
              <th>Radnici/lica</th>
              <th>Stavke</th>
              <th>Osnovica</th>
              <th>Porez</th>
              <th>Dopr. zaposleni</th>
              <th>Dopr. poslodavac</th>
              <th>Akcija</th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={`${month.godina}-${month.mjesec}`}>
                <td>
                  <strong>{monthLabel(month.godina, month.mjesec)}</strong>
                </td>
                <td>
                  <div className="muted-stack">
                    {month.calculations.map((calculation) => (
                      <span key={calculation.id}>
                        {calculation.broj} - {payrollCategoryLabel(calculation.kategorija)}
                      </span>
                    ))}
                  </div>
                </td>
                <td>{month.employeeCount}</td>
                <td>{month.lines.length}</td>
                <td>{money(month.totals.osnovicaCent)}</td>
                <td>{money(month.totals.porezCent)}</td>
                <td>{money(sumEmployeeContributions(month))}</td>
                <td>{money(sumEmployerContributions(month))}</td>
                <td>
                  <div className="table-actions">
                    <Link
                      className="table-button"
                      href={`/stampa/plate/ioppd?godina=${month.godina}&mjesec=${month.mjesec}`}
                      target="_blank"
                    >
                      Pregled
                    </Link>
                    <Link
                      className="table-button"
                      href={`/api/plate/ioppd/xml?godina=${month.godina}&mjesec=${month.mjesec}`}
                    >
                      Download XML
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
            {months.length === 0 ? (
              <tr>
                <td colSpan={9}>Nema obrađenih obračuna za IOPPD.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
