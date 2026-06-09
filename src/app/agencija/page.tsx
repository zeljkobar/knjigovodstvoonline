import { DashboardPlaceholder } from "@/components/DashboardPlaceholder";
import { requireAnyRole } from "@/lib/auth";

export default async function AgencijaPage() {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const title =
    user.rola === "admin_agencije"
      ? "Dobro dosao admin agencije"
      : "Dobro dosao korisnik agencije";

  return (
    <DashboardPlaceholder
      title={title}
      korisnickoIme={user.korisnicko_ime}
    />
  );
}
