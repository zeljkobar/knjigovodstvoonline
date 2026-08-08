import { DashboardPlaceholder } from "@/components/DashboardPlaceholder";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export default async function KlijentPage() {
  const user = await requireRole("klijent");
  const posAccess = await prisma.korisnikPravo.findFirst({
    where: { korisnik_id: user.id, agencija_id: user.agencija_id!, modul: "pos", akcija: "view", dozvoljeno: true },
    select: { id: true }
  });
  if (posAccess) redirect("/agencija/pos");

  return (
    <DashboardPlaceholder
      title="Dobro dosao klijent"
      korisnickoIme={user.korisnicko_ime}
    />
  );
}
