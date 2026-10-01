import { LagerListPage } from "@/app/agencija/_components/LagerListPage";
export default function Page({ searchParams }: { searchParams: Promise<{ grupa?: string; magacin?: string; q?: string; stanje?: string }> }) {
  return <LagerListPage clientView basePath="/klijent/robno/lager" itemCardPath="/klijent/robno/kartica-artikla" sectionLabel="Robno / Zalihe" searchParams={searchParams} />;
}
