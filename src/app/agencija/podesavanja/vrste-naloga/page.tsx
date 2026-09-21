import { JournalTypesManager } from "@/components/JournalTypesManager";

type SettingsJournalTypesPageProps = {
  searchParams?: Promise<{
    poruka?: string;
  }>;
};

export default async function SettingsJournalTypesPage({
  searchParams
}: SettingsJournalTypesPageProps) {
  const params = await searchParams;

  return (
    <JournalTypesManager
      messageKey={params?.poruka}
      returnPath="/agencija/podesavanja/vrste-naloga"
    />
  );
}
