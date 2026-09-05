import { LagerListPage } from "../../_components/LagerListPage";

type PageProps = {
  searchParams?: Promise<{
    grupa?: string;
    magacin?: string;
    q?: string;
    stanje?: string;
  }>;
};

export default function ReportsLagerPage({ searchParams }: PageProps) {
  return (
    <LagerListPage
      basePath="/agencija/izvjestaji/lager"
      itemCardPath="/agencija/izvjestaji/kartica-artikla"
      requireReportsPermission
      sectionLabel="Izvještaji / Robno"
      searchParams={searchParams}
    />
  );
}
