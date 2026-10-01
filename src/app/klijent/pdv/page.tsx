import { requireClientContext, clientScope } from "@/lib/client-portal";
import { prisma } from "@/lib/prisma";
import { pdvMonths } from "@/lib/pdv";
import { PdvStatusPill } from "@/app/agencija/pdv/_components";
import { decimalToInventoryScaled, formatInventoryMoney } from "@/app/agencija/_components/inventory-report-utils";

export default async function ClientVatPage() {
  const context = await requireClientContext(["izvjestaji", "pdv"]);
  if (!context.firma.pdv_obveznik) return <p className="admin-message">Firma nije u sistemu PDV-a.</p>;
  const periods = await prisma.pdvPeriod.findMany({ where: clientScope(context), orderBy: { mjesec: "asc" },
    include: { prijave: { include: { journal: { select: { status: true, is_deleted: true } } } } } });
  const money = (value?: { toString(): string }) => value ? formatInventoryMoney(decimalToInventoryScaled(value, 2)) : "—";
  return <div className="admin-stack"><header className="admin-header"><div><h1>PDV pregled</h1><p>{context.firma.naziv} · {context.year.godina}</p></div></header>
    <p className="admin-message">Prikazane su sačuvane prijave agencije. Nacrt je informativan i može se promijeniti; status knjiženja ne znači da je prijava predata Poreskoj upravi.</p>
    <section className="admin-panel"><div className="table-wrap"><table className="admin-table"><thead><tr><th>Mjesec</th><th>Status</th><th>Izlazni PDV</th><th>Ulazni PDV</th><th>Odbitni PDV</th><th>Za uplatu</th><th>Poreski kredit</th></tr></thead><tbody>{pdvMonths.map((label, index) => {
      const period = periods.find((item) => item.mjesec === index + 1);
      const filing = period?.prijave[0];
      const status = filing?.status === "POSTED" && (!filing.journal || filing.journal.is_deleted || filing.journal.status !== "POSTED") ? "DRAFT" : filing?.status;
      return <tr key={label}><td>{label}</td><td>{filing ? <PdvStatusPill status={status} /> : "Nije pripremljeno"}</td><td>{money(filing?.total_output_vat)}</td><td>{money(filing?.total_input_vat)}</td><td>{money(filing?.deductible_vat)}</td><td>{money(filing?.payable_vat)}</td><td>{money(filing?.credit_vat)}</td></tr>;
    })}</tbody></table></div></section></div>;
}
