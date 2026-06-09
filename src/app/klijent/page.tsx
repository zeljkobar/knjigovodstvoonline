import { DashboardPlaceholder } from "@/components/DashboardPlaceholder";
import { requireRole } from "@/lib/auth";

export default async function KlijentPage() {
  const user = await requireRole("klijent");

  return (
    <DashboardPlaceholder
      title="Dobro dosao klijent"
      korisnickoIme={user.korisnicko_ime}
    />
  );
}
