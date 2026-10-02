import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
export default async function PodesavanjaPage() {
  await requireRole("admin_agencije");
  redirect("/agencija/podesavanja/agencija");
}
