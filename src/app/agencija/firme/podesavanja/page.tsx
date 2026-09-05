import { ModulePlaceholder } from "@/components/ModulePlaceholder";
import { requireRole } from "@/lib/auth";

export default async function PodesavanjaFirmePage() {
  await requireRole("admin_agencije");

  return <ModulePlaceholder title="Podesavanja firme" />;
}
