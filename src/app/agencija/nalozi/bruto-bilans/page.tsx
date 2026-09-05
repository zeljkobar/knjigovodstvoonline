import { BrutoBilansPage as BrutoBilansView } from "../../_components/BrutoBilansPage";

type BrutoBilansPageProps = {
  searchParams?: Promise<{
    datum_do?: string;
    datum_od?: string;
    jedinica?: string;
    klasa?: string;
    konto?: string;
    nivo?: string;
    samo_zbir?: string;
  }>;
};

export default function BrutoBilansPage({ searchParams }: BrutoBilansPageProps) {
  return (
    <BrutoBilansView
      basePath="/agencija/nalozi/bruto-bilans"
      searchParams={searchParams}
    />
  );
}
