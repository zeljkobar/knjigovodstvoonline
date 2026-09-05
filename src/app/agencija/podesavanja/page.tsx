import { ModulePlaceholder } from "@/components/ModulePlaceholder";
import { requireRole } from "@/lib/auth";

export default async function PodesavanjaPage() {
  await requireRole("admin_agencije");

  return <ModulePlaceholder title="Podešavanja" />;
}
