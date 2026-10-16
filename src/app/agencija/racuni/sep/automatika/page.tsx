import { redirect } from "next/navigation";
import { getSepAdmin } from "@/lib/sep-context";
export default async function LegacySepAutomationPage() {
  await getSepAdmin();
  redirect("/agencija/podesavanja/sep-automatika");
}
