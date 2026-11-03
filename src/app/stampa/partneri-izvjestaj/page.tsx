import { PartnerBalanceReportPage } from "@/app/agencija/_components/PartnerBalanceReportPage";
import "../kupci-dobavljaci/print.css";

type Params = { vrsta?: string; prikaz?: string; partner?: string; datum_od?: string; datum_do?: string };

export default async function PartnerReportPrint({ searchParams }: { searchParams?: Promise<Params> }) {
  const params = await searchParams;
  if (params?.vrsta !== "customers" && params?.vrsta !== "suppliers") {
    return <main className="print-page">Izaberite izvještaj Kupci ili Dobavljači.</main>;
  }
  return <PartnerBalanceReportPage kind={params.vrsta} searchParams={Promise.resolve(params)} print />;
}
