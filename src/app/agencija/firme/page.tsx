import Link from "next/link";
import { Pagination } from "@/components/Pagination";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 25;

type FirmePageProps = {
  searchParams?: Promise<{
    poruka?: string;
    stranica?: string;
  }>;
};

const poruke: Record<string, string> = {
  firma_kreirana: "Firma je kreirana i poslovna godina je otvorena.",
  firma_obrisana: "Firma i svi podaci koji su joj pripadali trajno su obrisani.",
  firma_brisanje_greska: "Firma nije pronađena ili nije mogla biti obrisana.",
  pib_postoji: "Firma sa ovim PIB-om vec postoji u agenciji."
};

export default async function FirmePage({ searchParams }: FirmePageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const params = await searchParams;
  const message = params?.poruka ? poruke[params.poruka] : null;
  const currentPage = Math.max(1, parseInt(params?.stranica ?? "1"));
  const skip = (currentPage - 1) * PAGE_SIZE;

  if (!user.agencija_id) {
    return null;
  }

  const where = {
    agencija_id: user.agencija_id,
    is_deleted: false
  };

  const [firme, ukupno] = await Promise.all([
    prisma.firma.findMany({
      where,
      orderBy: {
        created_at: "desc"
      },
      take: PAGE_SIZE,
      skip,
      select: {
        id: true,
        naziv: true,
        skraceni_naziv: true,
        tip_subjekta: true,
        pib: true,
        pdv_broj: true,
        pdv_obveznik: true,
        adresa: true,
        grad: true,
        opstina: true,
        telefon: true,
        email: true,
        aktivan: true,
        status_firme: true,
        created_at: true,
        poslovne_godine: {
          orderBy: {
            godina: "desc"
          },
          select: {
            id: true,
            godina: true,
            datum_od: true,
            datum_do: true,
            zakljucena: true
          }
        },
        korisnici: {
          where: {
            is_deleted: false
          },
          select: {
            id: true
          }
        }
      }
    }),
    prisma.firma.count({ where })
  ]);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h2>Lista firmi</h2>
        </div>
        {user.rola === "admin_agencije" ? (
          <Link className="primary-link" href="/agencija/firme/nova">
            Dodaj firmu
          </Link>
        ) : null}
      </header>

      {message ? <p className="admin-message">{message}</p> : null}

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Spisak firmi</h3>
          <span>{ukupno} ukupno</span>
        </div>

        {ukupno === 0 ? (
          <p className="empty-state">Nema dodatih firmi.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Firma</th>
                    <th>Tip</th>
                    <th>PIB / PDV</th>
                    <th>Kontakt</th>
                    <th>Godine</th>
                    <th>Korisnici</th>
                    <th>Status</th>
                    <th>Akcija</th>
                  </tr>
                </thead>
                <tbody>
                  {firme.map((firma) => (
                    <tr key={firma.id}>
                      <td>
                        <strong>{firma.naziv}</strong>
                        <small>
                          {firma.skraceni_naziv ||
                            [firma.adresa, firma.grad].filter(Boolean).join(", ") ||
                            "Bez adrese"}
                        </small>
                      </td>
                      <td>{firma.tip_subjekta}</td>
                      <td>
                        {firma.pib ?? "-"}
                        <small>
                          {firma.pdv_obveznik
                            ? firma.pdv_broj ?? "PDV"
                            : "Nije PDV obveznik"}
                        </small>
                      </td>
                      <td>
                        {firma.email ?? "-"}
                        <small>{firma.telefon ?? firma.opstina ?? "-"}</small>
                      </td>
                      <td>{firma.poslovne_godine.length}</td>
                      <td>{firma.korisnici.length}</td>
                      <td>{firma.aktivan ? "Aktivna" : "Neaktivna"}</td>
                      <td>
                        <Link className="table-link" href={`/agencija/firme/${firma.id}`}>
                          Otvori
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              currentPage={currentPage}
              pageSize={PAGE_SIZE}
              searchParams={params ?? {}}
              total={ukupno}
            />
          </>
        )}
      </section>
    </div>
  );
}
