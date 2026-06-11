import Link from "next/link";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function AgencijaPage() {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);

  if (!user.agencija_id) {
    return null;
  }

  const [
    agencija,
    brojFirmi,
    brojRadnika,
    brojKlijenata,
    zadnjeAktivnosti
  ] = await Promise.all([
    prisma.agencija.findUnique({
      where: {
        id: user.agencija_id
      },
      select: {
        naziv: true,
        aktivan: true
      }
    }),
    prisma.firma.count({
      where: {
        agencija_id: user.agencija_id,
        is_deleted: false
      }
    }),
    prisma.korisnik.count({
      where: {
        agencija_id: user.agencija_id,
        rola: "korisnik_agencije",
        is_deleted: false
      }
    }),
    prisma.korisnik.count({
      where: {
        agencija_id: user.agencija_id,
        rola: "klijent",
        is_deleted: false
      }
    }),
    prisma.auditLog.findMany({
      where: {
        agencija_id: user.agencija_id
      },
      orderBy: {
        created_at: "desc"
      },
      take: 8,
      select: {
        id: true,
        modul: true,
        akcija: true,
        tip_entiteta: true,
        created_at: true,
        korisnik: {
          select: {
            korisnicko_ime: true
          }
        }
      }
    })
  ]);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">{agencija?.naziv ?? "Agencija"}</p>
          <h2>Pregled agencije</h2>
        </div>
        {user.rola === "admin_agencije" ? (
          <Link className="primary-link" href="/agencija/korisnici">
            Korisnici i prava
          </Link>
        ) : null}
      </header>

      <section className="metric-grid" aria-label="Statistika agencije">
        <div className="metric">
          <span>Firmi</span>
          <strong>{brojFirmi}</strong>
        </div>
        <div className="metric">
          <span>Radnika</span>
          <strong>{brojRadnika}</strong>
        </div>
        <div className="metric">
          <span>Klijenata</span>
          <strong>{brojKlijenata}</strong>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-header">
          <h3>Zadnje aktivnosti</h3>
          <span>{agencija?.aktivan ? "Aktivna agencija" : "Neaktivna agencija"}</span>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Korisnik</th>
                <th>Modul</th>
                <th>Akcija</th>
                <th>Entitet</th>
                <th>Vrijeme</th>
              </tr>
            </thead>
            <tbody>
              {zadnjeAktivnosti.length === 0 ? (
                <tr>
                  <td colSpan={5}>Nema evidentiranih aktivnosti.</td>
                </tr>
              ) : (
                zadnjeAktivnosti.map((aktivnost) => (
                  <tr key={aktivnost.id}>
                    <td>{aktivnost.korisnik?.korisnicko_ime ?? "-"}</td>
                    <td>{aktivnost.modul ?? "-"}</td>
                    <td>{aktivnost.akcija}</td>
                    <td>{aktivnost.tip_entiteta}</td>
                    <td>{aktivnost.created_at.toLocaleString("sr-Latn")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
