import { FiscalBuyerReportPage } from "@/components/FiscalBuyerReportPage";
import type { DirectPortalReportSearchParams } from "@/lib/direct-portal-reports";
export default async function Page({ searchParams }: { searchParams: Promise<DirectPortalReportSearchParams> }) {
  return <FiscalBuyerReportPage params={await searchParams}/>;
}
