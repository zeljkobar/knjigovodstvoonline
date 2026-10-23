import { prisma } from "@/lib/prisma";
import { decimalToScaled, scaledToDecimal } from "@/lib/inventory-calculation";
function money(value: bigint) { return scaledToDecimal(value,2).replace(".",","); }
export async function InvoiceAdvancePrintNote({invoice}:{invoice:{avansni_racun_id:string|null;firma_id:string;agencija_id:string;iznos_avansa:{toString():string};ukupno_sa_pdv:{toString():string}}}) {
  if (!invoice.avansni_racun_id) return null;
  const source=await prisma.fiskalniIzlazniRacun.findFirst({where:{id:invoice.avansni_racun_id,firma_id:invoice.firma_id,agencija_id:invoice.agencija_id},select:{official_invoice_number:true,iic:true}});
  return <section className="invoice-print-note"><p>Avansni račun: {source?.official_invoice_number} · IKOF: {source?.iic}</p><p>Primijenjeni avans: {money(decimalToScaled(invoice.iznos_avansa,2))} EUR</p><p>Preostali dio računa: {money(decimalToScaled(invoice.ukupno_sa_pdv,2)-decimalToScaled(invoice.iznos_avansa,2))} EUR</p></section>;
}
