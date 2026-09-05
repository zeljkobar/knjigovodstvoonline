import { BrutoBilansPage as BrutoBilansView } from "../_components/BrutoBilansPage";

type IzvjestajiPageProps = {
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

export default function IzvjestajiPage({ searchParams }: IzvjestajiPageProps) {
  return (
    <BrutoBilansView
      accountCardPath="/agencija/izvjestaji/kartice-konta"
      basePath="/agencija/izvjestaji"
      permissionModules={["izvjestaji", "nalozi"]}
      searchParams={searchParams}
    />
  );
}
