import { FiscalGroupedReportPage } from "@/components/FiscalBuyerReportPage";
import type { DirectPortalReportSearchParams } from "@/lib/direct-portal-reports";
export default async function Page({ searchParams }: { searchParams: Promise<DirectPortalReportSearchParams> }) {
  return <FiscalGroupedReportPage kind="jedinice" params={await searchParams}/>;
}
