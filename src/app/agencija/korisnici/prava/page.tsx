import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";

export default async function PravaPristupaPage() {
  await requireRole("admin_agencije");
  redirect("/agencija/korisnici#lista-korisnika");
}
