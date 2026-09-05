import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";

type LegacyStampaUgovoraPageProps = {
  params: Promise<{
    firmaId: string;
  }>;
};

export default async function LegacyStampaUgovoraPage({
  params
}: LegacyStampaUgovoraPageProps) {
  await requireRole("admin_agencije");
  const { firmaId } = await params;

  redirect(`/stampa/ugovori/${firmaId}`);
}
