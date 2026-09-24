import { PayrollVirmanPrintControls } from "@/components/PayrollVirmanPrintControls";
import { loadPayrollDocumentForPrint } from "@/lib/payroll-document-access";
import { serializePayrollPaymentOrder } from "@/lib/payroll-payment-order-print";
import { buildPayrollPaymentOrders } from "@/lib/payroll-documents";

type PageProps = {
  searchParams?: Promise<{ obracun?: string }>;
};

export default async function PayrollPaymentOrdersPrintPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const result = await loadPayrollDocumentForPrint(params?.obracun);

  if (!result.data) {
    return (
      <main className="print-page">
        <section className="payroll-payment-order-document"><p>{result.error}</p></section>
      </main>
    );
  }

  const paymentOrders = await buildPayrollPaymentOrders(result.data);

  return (
    <PayrollVirmanPrintControls
      backHref={`/agencija/plate/obracun/nalozi-za-placanje?obracun=${result.data.obracun.id}`}
      calculationId={result.data.obracun.id}
      initialOrders={paymentOrders.orders.map(serializePayrollPaymentOrder)}
      isPreview={result.data.isPreview}
    />
  );
}
