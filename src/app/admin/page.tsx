import Link from "next/link";
import { prisma } from "@/lib/prisma";

export default async function AdminPage() {
  const [brojAgencija, brojFirmi, brojKorisnika, zadnjeAgencije] =
    await Promise.all([
      prisma.agencija.count({ where: { is_fiscal_direct_container: false } }),
      prisma.firma.count(),
      prisma.korisnik.count(),
      prisma.agencija.findMany({
        where: { is_fiscal_direct_container: false },
        orderBy: {
          created_at: "desc"
        },
        take: 5,
        select: {
          id: true,
          naziv: true,
          grad: true,
          aktivan: true,
          _count: {
            select: {
              firme: true,
              korisnici: true
            }
          }
        }
      })
    ]);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Pregled sistema</p>
          <h2>Dobro dosao admin</h2>
        </div>
        <Link className="primary-link" href="/admin/agencije">
          Nova agencija
        </Link>
        <Link className="table-link" href="/admin/globalni-partneri">
          Globalni partneri
        </Link>
      </header>

      <section className="metric-grid" aria-label="Statistika sistema">
        <div className="metric">
          <span>Agencije</span>
          <strong>{brojAgencija}</strong>
        </div>
        <div className="metric">
          <span>Firme</span>
          <strong>{brojFirmi}</strong>
        </div>
        <div className="metric">
          <span>Korisnici</span>
          <strong>{brojKorisnika}</strong>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Zadnje agencije</h3>
          <Link href="/admin/agencije">Sve agencije</Link>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Naziv</th>
                <th>Grad</th>
                <th>Firmi</th>
                <th>Korisnika</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {zadnjeAgencije.map((agencija) => (
                <tr key={agencija.id}>
                  <td>{agencija.naziv}</td>
                  <td>{agencija.grad || "-"}</td>
                  <td>{agencija._count.firme}</td>
                  <td>{agencija._count.korisnici}</td>
                  <td>{agencija.aktivan ? "Aktivna" : "Neaktivna"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
