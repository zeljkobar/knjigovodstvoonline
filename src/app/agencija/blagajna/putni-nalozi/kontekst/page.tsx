import { requireAnyRole } from "@/lib/auth";
export default async function MissingContext() {
  await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  return <section className="admin-panel"><h1>Putni nalozi</h1><p>Izaberite dostupnu firmu i poslovnu godinu u gornjoj traci.</p></section>;
}
