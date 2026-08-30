import { ItemCardPage } from "../../_components/ItemCardPage";

type PageProps = {
  searchParams?: Promise<{
    artikal?: string;
    datum_do?: string;
    datum_od?: string;
    magacin?: string;
  }>;
};

export default function ReportsItemCardPage({ searchParams }: PageProps) {
  return (
    <ItemCardPage
      basePath="/agencija/izvjestaji/kartica-artikla"
      lagerPath="/agencija/izvjestaji/lager"
      sectionLabel="Izvještaji / Robno"
      searchParams={searchParams}
    />
  );
}
