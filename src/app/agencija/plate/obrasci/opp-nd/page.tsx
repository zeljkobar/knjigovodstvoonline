import Link from "next/link";
import { getPlateContext, MissingPlateContext } from "../../_shared";
import { findMunicipalitySurtax } from "@/lib/municipalities";
import { money } from "@/lib/payroll";
import { ioppdStatusesForPrint } from "@/lib/payroll-ioppd";
import { buildOppndMonthData } from "@/lib/payroll-oppnd";
import { prisma } from "@/lib/prisma";

function monthLabel(godina: number, mjesec: number) {
  return `${String(mjesec).padStart(2, "0")}/${godina}`;
}

function rateLabel(value: number | null) {
  return value === null
    ? "-"
    : `${(value * 100).toLocaleString("sr-Latn-ME", {
        maximumFractionDigits: 2
      })}%`;
}

export default async function PayrollOppndPage() {
  const context = await getPlateContext("view");

  if (!context.firma || !context.godina || !context.user.agencija_id) {
    return <MissingPlateContext title="OPP-ND" />;
  }

  if (!context.allowed) {
    return (
      <section className="admin-panel">
        <p className="empty-state">Nemate pravo za pregled OPP-ND obrazaca.</p>
      </section>
    );
  }

  const [firma, calculations] = await Promise.all([
    prisma.firma.findFirst({
      where: {
        id: context.firma.id,
        agencija_id: context.user.agencija_id,
        is_deleted: false
      },
      select: {
        naziv: true,
        pib: true,
        sifra_djelatnosti: true,
        adresa: true,
        opstina: true,
        grad: true,
        telefon: true,
        odgovorna_lica: {
          where: {
            uloga: "IZVRSNI_DIREKTOR",
            aktivan: true,
            is_deleted: false
          },
          orderBy: [
            {
              primarno: "desc"
            },
            {
              created_at: "asc"
            }
          ],
          take: 1,
          select: {
            id: true,
            jmbg: true
          }
        }
      }
    }),
    prisma.plateObracun.findMany({
      where: {
        agencija_id: context.user.agencija_id,
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
    })
  ]);

  if (!firma) {
    return null;
  }

  const groups = new Map<string, typeof calculations>();

  for (const calculation of calculations) {
    const key = `${calculation.godina}-${calculation.mjesec}`;
    groups.set(key, [...(groups.get(key) ?? []), calculation]);
  }

  const months = await Promise.all(
    Array.from(groups.values()).map(async (group) => {
      const municipality = await findMunicipalitySurtax(
        firma.opstina ?? firma.grad,
        new Date(Date.UTC(group[0].godina, group[0].mjesec, 0))
      );
      const rate = municipality ? Number(municipality.stopa) : null;

      return {
        report: buildOppndMonthData(
          group[0].godina,
          group[0].mjesec,
          group,
          rate
        ),
        municipality
      };
    })
  );
  const blockers = [
    !firma.pib ? "Firma nema PIB." : null,
    !firma.sifra_djelatnosti ? "Firma nema šifru djelatnosti." : null,
    !firma.adresa ? "Firma nema adresu." : null,
    !(firma.opstina || firma.grad) ? "Firma nema opštinu/grad." : null,
    !firma.telefon ? "Firma nema telefon." : null,
    !firma.odgovorna_lica.length ? "Firma nema unesenog izvršnog direktora." : null,
    firma.odgovorna_lica.length && !firma.odgovorna_lica[0]?.jmbg
      ? "Izvršni direktor nema JMBG."
      : null,
    months.some((month) => !month.municipality)
      ? "Opština firme nije povezana sa šifarnikom stopa prireza."
      : null
  ].filter((issue): issue is string => Boolean(issue));

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>OPP-ND</h2>
          <p>
            {firma.naziv} / {context.godina.godina}
          </p>
        </div>
      </header>

      <section className="admin-panel">
        <div className="panel-title-row">
          <div>
            <h3>Kontrole prije štampe</h3>
            <p>
              Obrazac se puni iz podataka firme, izvršnog direktora, obrađenih
              obračuna i stope prireza opštine firme.
            </p>
          </div>
          <span
            className={
              blockers.length
                ? "status-pill status-pill--warning"
                : "status-pill status-pill--success"
            }
          >
            {blockers.length ? `${blockers.length} blokada` : "Spremno"}
          </span>
        </div>
        {blockers.length ? (
          <div className="control-issues">
            {blockers.map((issue) => (
              <small key={issue}>{issue}</small>
            ))}
          </div>
        ) : null}
      </section>

      <section className="admin-panel">
        <div className="panel-title-row">
          <div>
            <h3>Mjesečne prijave prireza</h3>
            <p>
              Porez se razvrstava na lična primanja, samostalnu djelatnost,
              imovinu i kapital. Prirez je porez pomnožen opštinskom stopom.
            </p>
          </div>
          <strong>{months.length} ukupno</strong>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Period</th>
                <th>Obračuni</th>
                <th>Lična primanja</th>
                <th>Samostalna djelatnost</th>
                <th>Imovina</th>
                <th>Ukupno porez</th>
                <th>Stopa</th>
                <th>Prirez</th>
                <th>Akcija</th>
              </tr>
            </thead>
            <tbody>
              {months.map(({ report, municipality }) => (
                <tr key={`${report.godina}-${report.mjesec}`}>
                  <td>
                    <strong>{monthLabel(report.godina, report.mjesec)}</strong>
                  </td>
                  <td>{report.calculations.length}</td>
                  <td>{money(report.rows[0].porezCent)}</td>
                  <td>{money(report.rows[1].porezCent)}</td>
                  <td>{money(report.rows[2].porezCent)}</td>
                  <td>{money(report.ukupnoPorezCent)}</td>
                  <td>{rateLabel(report.rows[0].stopaPrireza)}</td>
                  <td>{money(report.ukupnoPrirezCent)}</td>
                  <td>
                    {municipality ? (
                      <Link
                        className="table-button"
                        href={`/stampa/plate/opp-nd?godina=${report.godina}&mjesec=${report.mjesec}`}
                        target="_blank"
                      >
                        Pregled
                      </Link>
                    ) : (
                      <span className="table-button disabled">Nema stope</span>
                    )}
                  </td>
                </tr>
              ))}
              {!months.length ? (
                <tr>
                  <td colSpan={9}>
                    Nema obrađenih obračuna za OPP-ND prijavu.
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
