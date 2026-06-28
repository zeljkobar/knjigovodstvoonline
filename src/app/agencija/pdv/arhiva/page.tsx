import Link from "next/link";
import { PdvStatusPill } from "../_components";
import { money, pdvMonths } from "@/lib/pdv";
import { prisma } from "@/lib/prisma";
import { requirePdvContext } from "@/lib/pdv-service";

export default async function PdvArhivaPage() {
  const context = await requirePdvContext("view");
  const prijave = await prisma.pdvPrijava.findMany({
    where: {
      agencija_id: context.agencijaId,
      firma_id: context.firma.id,
      poslovna_godina_id: context.poslovnaGodina.id
    },
    orderBy: {
      pdv_period: {
        mjesec: "asc"
      }
    },
    include: {
      pdv_period: true,
      journal: {
        select: {
          id: true,
          sifra: true,
          is_deleted: true
        }
      }
    }
  });

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Arhiva PDV prijava</h2>
          <p>Sačuvane, proknjižene i zaključane prijave za aktivnu godinu.</p>
        </div>
      </header>

      <section className="admin-panel">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Mjesec</th>
              <th>Status</th>
              <th>Obaveza</th>
              <th>Kredit</th>
              <th>XML</th>
              <th>Nalog</th>
              <th>Detalj</th>
            </tr>
          </thead>
          <tbody>
            {prijave.length === 0 ? (
              <tr>
                <td colSpan={7}>Nema PDV prijava u arhivi.</td>
              </tr>
            ) : (
              prijave.map((prijava) => {
                const activeJournal = prijava.journal && !prijava.journal.is_deleted ? prijava.journal : null;
                const status = prijava.status === "POSTED" && !activeJournal ? "DRAFT" : prijava.status;

                return (
                  <tr key={prijava.id}>
                    <td>{pdvMonths[prijava.pdv_period.mjesec - 1]}</td>
                    <td>
                      <PdvStatusPill status={status} />
                    </td>
                    <td className="numeric">{money(Number(prijava.payable_vat.toString()))}</td>
                    <td className="numeric">{money(Number(prijava.credit_vat.toString()))}</td>
                    <td>
                      <Link className="secondary-button" href={`/api/pdv/xml?mjesec=${prijava.pdv_period.mjesec}`}>
                        XML
                      </Link>
                    </td>
                    <td>
                      {activeJournal ? (
                        <Link href={`/agencija/nalozi/${activeJournal.id}`}>{activeJournal.sifra}</Link>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      <Link className="secondary-button" href={`/agencija/pdv/prijava?mjesec=${prijava.pdv_period.mjesec}`}>
                        Otvori
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
