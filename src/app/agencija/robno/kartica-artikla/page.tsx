import { ItemCardPage } from "../../_components/ItemCardPage";

type PageProps = {
  searchParams?: Promise<{
    artikal?: string;
    datum_do?: string;
    datum_od?: string;
    magacin?: string;
  }>;
};

export default function RobnoItemCardPage({ searchParams }: PageProps) {
  return (
    <ItemCardPage
      basePath="/agencija/robno/kartica-artikla"
      lagerPath="/agencija/robno/lager"
      sectionLabel="Robno / Zalihe"
      searchParams={searchParams}
    />
  );
}
