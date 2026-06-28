import Link from "next/link";
import { ensurePdvPeriods } from "./actions";
import { PdvStatusPill } from "./_components";
import { money, pdvMonths } from "@/lib/pdv";
import { prisma } from "@/lib/prisma";
import { requirePdvContext } from "@/lib/pdv-service";

const poruke: Record<string, string> = {
  periodi_generisani: "PDV periodi su kreirani/osvježeni.",
  pdv_kontekst: "Izaberite firmu i poslovnu godinu."
};

type PdvPageProps = {
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

export default async function PdvPage({ searchParams }: PdvPageProps) {
  const params = await searchParams;
  const context = await requirePdvContext("view");
  const periods = await prisma.pdvPeriod.findMany({
    where: {
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      poslovna_godina_id: context.poslovnaGodina.id
    },
    orderBy: {
      mjesec: "asc"
    },
    include: {
      prijave: {
        select: {
          status: true,
          journal_id: true,
          journal: {
            select: {
              is_deleted: true,
              status: true
            }
          },
          payable_vat: true,
          credit_vat: true,
          total_input_vat: true,
          total_output_vat: true
        }
      }
    }
  });
  const byMonth = new Map(periods.map((period) => [period.mjesec, period]));

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>PDV pregled</h2>
          <p>Mjesečni PDV periodi za aktivnu firmu i poslovnu godinu.</p>
        </div>
        <form action={ensurePdvPeriods}>
          <button className="secondary-button" type="submit">
            Kreiraj periode
          </button>
        </form>
      </header>

      {params?.poruka && poruke[params.poruka] ? (
        <p className="admin-message">{poruke[params.poruka]}</p>
      ) : null}

      <section className="admin-panel">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Mjesec</th>
              <th>Period</th>
              <th>Status</th>
              <th>Izlazni PDV</th>
              <th>Ulazni PDV</th>
              <th>Obaveza</th>
              <th>Kredit</th>
              <th>Akcija</th>
            </tr>
          </thead>
          <tbody>
            {pdvMonths.map((monthLabel, index) => {
              const month = index + 1;
              const period = byMonth.get(month);
              const prijava = period?.prijave[0];
              const validJournal =
                prijava?.journal_id && prijava.journal && !prijava.journal.is_deleted
                  ? prijava.journal
                  : null;
              const status =
                prijava?.status === "POSTED" && !validJournal
                  ? period?.status
                  : prijava?.status ?? period?.status;

              return (
                <tr key={monthLabel}>
                  <td>{monthLabel}</td>
                  <td>
                    {period
                      ? `${period.datum_od.toLocaleDateString("sr-Latn-ME")} - ${period.datum_do.toLocaleDateString("sr-Latn-ME")}`
                      : "-"}
                  </td>
                  <td>
                    <PdvStatusPill status={status} />
                  </td>
                  <td className="numeric">{money(Number(prijava?.total_output_vat?.toString() ?? 0))}</td>
                  <td className="numeric">{money(Number(prijava?.total_input_vat?.toString() ?? 0))}</td>
                  <td className="numeric">{money(Number(prijava?.payable_vat?.toString() ?? 0))}</td>
                  <td className="numeric">{money(Number(prijava?.credit_vat?.toString() ?? 0))}</td>
                  <td>
                    <Link className="secondary-button" href={`/agencija/pdv/prijava?mjesec=${month}`}>
                      Otvori
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
