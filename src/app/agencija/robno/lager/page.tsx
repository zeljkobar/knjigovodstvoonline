import { LagerListPage } from "../../_components/LagerListPage";

type PageProps = {
  searchParams?: Promise<{
    grupa?: string;
    magacin?: string;
    q?: string;
    stanje?: string;
  }>;
};

export default function RobnoLagerPage({ searchParams }: PageProps) {
  return (
    <LagerListPage
      basePath="/agencija/robno/lager"
      itemCardPath="/agencija/robno/kartica-artikla"
      sectionLabel="Robno / Zalihe"
      searchParams={searchParams}
    />
  );
}
