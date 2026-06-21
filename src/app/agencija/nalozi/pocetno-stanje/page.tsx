import { requireAnyRole } from "@/lib/auth";
import { readWorkContext } from "@/lib/work-context";

export default async function PocetnoStanjePage() {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id) {
    return null;
  }

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h1>Početno stanje</h1>
        </div>
      </header>
      <section className="admin-card">
        <h2>Unos početnog stanja</h2>
        <p className="muted">
          {workContext.firmaId && workContext.poslovnaGodinaId
            ? "Ovdje ćemo vezati početna stanja za izabranu firmu i poslovnu godinu."
            : "Izaberite firmu i poslovnu godinu u gornjem izboru."}
        </p>
      </section>
    </div>
  );
}
