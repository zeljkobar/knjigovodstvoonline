import { loadCorporateTax } from "@/lib/corporate-tax-service";
import { CorporateTaxError } from "@/lib/corporate-tax";
import { CorporateTaxForm } from "./CorporateTaxForm";
import "./tax.css";

export default async function CorporateTaxPage() {
  let data;
  try { data = await loadCorporateTax(); }
  catch (error) {
    if (error instanceof CorporateTaxError) return <div className="admin-stack"><h1>Porez na dobit</h1><p role="alert">{error.message}</p></div>;
    throw error;
  }
  return <div className="admin-stack corporate-tax">
    <header className="admin-header"><div><h1>Porez na dobit</h1><p>{data.company.naziv} · PIB {data.company.pib || "nije unesen"} · {data.year}</p></div></header>
    <CorporateTaxForm key={`${data.companyId}:${data.yearId}`} data={data} />
  </div>;
}
