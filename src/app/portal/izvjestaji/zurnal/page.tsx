import { PortalFiscalJournal } from "@/components/PortalFiscalJournal";
import type { DirectPortalReportSearchParams } from "@/lib/direct-portal-reports";
export default async function Page({ searchParams }: { searchParams: Promise<DirectPortalReportSearchParams> }) {
  return <PortalFiscalJournal kind="zurnal" params={await searchParams}/>;
}
