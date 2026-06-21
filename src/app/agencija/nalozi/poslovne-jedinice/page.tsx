import { requireAnyRole } from "@/lib/auth";
import { readWorkContext } from "@/lib/work-context";

export default async function PoslovneJedinicePage() {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const workContext = await readWorkContext();

  if (!user.agencija_id) {
    return null;
  }

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <h1>Poslovne jedinice</h1>
        </div>
      </header>
      <section className="admin-card">
        <h2>Radne i poslovne jedinice</h2>
        <p className="muted">
          {workContext.firmaId
            ? "Ovdje ćemo dodavati poslovne jedinice za izabranu firmu."
            : "Izaberite firmu u gornjem izboru."}
        </p>
      </section>
    </div>
  );
}
