import Link from "next/link";
import { requireAnyRole } from "@/lib/auth";

export default async function DocumentsForProcessingPage() {
  await requireAnyRole(["admin_agencije", "korisnik_agencije"]);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Dokumentacija</p>
          <h1>Dokumenta za obradu</h1>
        </div>
      </header>
      <section className="admin-panel">
        <div className="panel-header">
          <h2>Funkcionalnost je u pripremi</h2>
        </div>
        <p className="muted-text">
          Ovaj prostor je predviđen za dokumenta koja klijenti dostave agenciji.
          Slanje i obrada dokumenata još nisu dostupni.
        </p>
        <Link className="table-button" href="/agencija">
          Nazad na pregled
        </Link>
      </section>
    </div>
  );
}
