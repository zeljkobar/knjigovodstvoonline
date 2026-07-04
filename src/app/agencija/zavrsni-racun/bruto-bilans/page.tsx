import { BrutoBilansPage as BrutoBilansView } from "../../_components/BrutoBilansPage";

type BrutoBilansPageProps = {
  searchParams?: Promise<{
    datum_do?: string;
    datum_od?: string;
    klasa?: string;
    konto?: string;
    nivo?: string;
    samo_zbir?: string;
  }>;
};

export default function ZavrsniRacunBrutoBilansPage({ searchParams }: BrutoBilansPageProps) {
  return (
    <BrutoBilansView
      basePath="/agencija/zavrsni-racun/bruto-bilans"
      searchParams={searchParams}
    />
  );
}
