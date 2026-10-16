import { redirect } from "next/navigation";
import { getSepAdmin } from "@/lib/sep-context";
export default async function LegacyDocumentsPage() {
  await getSepAdmin();
  redirect("/agencija/automatski-obradjena-dokumenta");
}
