import { ItemCardPage } from "@/app/agencija/_components/ItemCardPage";
export default function Page({ searchParams }: { searchParams: Promise<{ artikal?: string; datum_od?: string; datum_do?: string; magacin?: string }> }) {
  return <ItemCardPage clientView basePath="/klijent/robno/kartica-artikla" lagerPath="/klijent/robno/lager" sectionLabel="Robno / Zalihe" searchParams={searchParams} />;
}
