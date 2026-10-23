import { SalesInvoiceList } from "../_components/SalesInvoiceList";
export default function AdvanceInvoicesPage({ searchParams }: { searchParams: Promise<{poruka?: string}> }) {
  return <SalesInvoiceList searchParams={searchParams} advances/>;
}
