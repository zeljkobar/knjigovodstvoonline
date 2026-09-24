import { PayrollVirmanPrintControls } from "@/components/PayrollVirmanPrintControls";
import {
  getManualPaymentOrderContext,
  manualPaymentOrderStatuses,
  manualPaymentOrderToPrintRow
} from "@/lib/manual-payment-orders";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

type PageProps = {
  searchParams?: Promise<{ ids?: string }>;
};

export default async function ManualPaymentOrdersPrintPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const context = await getManualPaymentOrderContext("view");

  if (!context.firma || !context.godina || !context.user.agencija_id || !context.allowed) {
    return <PrintError message="Aktivna firma, poslovna godina ili pravo za pregled nijesu dostupni." />;
  }

  const canExport = await hasPermission(context.user, {
    firmaId: context.firma.id,
    modul: "virmani",
    akcija: "export"
  });
  if (!canExport) {
    return <PrintError message="Nemate pravo za štampu virmana." />;
  }

  const ids = Array.from(
    new Set((params?.ids ?? "").split(",").map((value) => value.trim()).filter(Boolean))
  );
  if (ids.length === 0) {
    return <PrintError message="Nije izabran nijedan virman." />;
  }

  const orders = await prisma.virman.findMany({
    where: {
      id: { in: ids },
      agencija_id: context.user.agencija_id,
      firma_id: context.firma.id,
      poslovna_godina_id: context.godina.id,
      status: manualPaymentOrderStatuses.printed,
      is_deleted: false
    }
  });
  const byId = new Map(orders.map((order) => [order.id, order]));
  const sortedOrders = ids.map((id) => byId.get(id)).filter(Boolean);
  if (sortedOrders.length !== ids.length) {
    return <PrintError message="Jedan ili više virmana nijesu pronađeni u aktivnoj firmi." />;
  }

  return (
    <PayrollVirmanPrintControls
      backHref="/agencija/virmani?tab=odstampano"
      calculationId={`manual-${ids.join("-")}`}
      initialOrders={sortedOrders.map((order) => manualPaymentOrderToPrintRow(order!))}
      isPreview={false}
    />
  );
}

function PrintError({ message }: { message: string }) {
  return (
    <main className="print-page">
      <section className="payroll-payment-order-document"><p>{message}</p></section>
    </main>
  );
}
