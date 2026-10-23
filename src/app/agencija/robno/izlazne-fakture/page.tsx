import { redirect } from "next/navigation";
import { SalesInvoiceList } from "../_components/SalesInvoiceList";
export default async function OutgoingInvoicesPage({ searchParams }: { searchParams: Promise<{poruka?: string; avansi?: string}> }) {
  const params = await searchParams;
  if (params.avansi === "1") redirect(`/agencija/robno/avansni-racuni${params.poruka ? `?poruka=${encodeURIComponent(params.poruka)}` : ""}`);
  return <SalesInvoiceList searchParams={Promise.resolve(params)}/>;
}
