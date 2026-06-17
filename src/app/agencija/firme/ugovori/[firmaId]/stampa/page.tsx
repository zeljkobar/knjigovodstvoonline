import { redirect } from "next/navigation";

type LegacyStampaUgovoraPageProps = {
  params: Promise<{
    firmaId: string;
  }>;
};

export default async function LegacyStampaUgovoraPage({
  params
}: LegacyStampaUgovoraPageProps) {
  const { firmaId } = await params;

  redirect(`/stampa/ugovori/${firmaId}`);
}
