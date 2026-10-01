import { notFound } from "next/navigation";
import { PartnerBalanceReportPage } from "@/app/agencija/_components/PartnerBalanceReportPage";
import { clientPartnerTypes, isClientPartnerType } from "@/lib/client-partner-policy";

export default async function ClientBalances({ params, searchParams }: {
  params: Promise<{ tip: string }>;
  searchParams: Promise<{ datum_od?: string; datum_do?: string; partner?: string }>;
}) {
  const { tip } = await params;
  if (!isClientPartnerType(tip)) notFound();
  return <PartnerBalanceReportPage kind={clientPartnerTypes[tip].kind} clientType={tip} searchParams={searchParams} />;
}
