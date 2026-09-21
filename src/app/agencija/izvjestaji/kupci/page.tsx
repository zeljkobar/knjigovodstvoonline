import { PartnerBalanceReportPage } from "../../_components/PartnerBalanceReportPage";

type PageProps = {
  searchParams?: Promise<{
    datum_do?: string;
    datum_od?: string;
    partner?: string;
    prikaz?: string;
  }>;
};

export default function CustomerReportPage({ searchParams }: PageProps) {
  return <PartnerBalanceReportPage kind="customers" searchParams={searchParams} />;
}
