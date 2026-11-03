import Link from "next/link";
import { openingImportOptions } from "@/lib/opening-import";
import { OpeningImportError } from "@/lib/primatech-opening";
import { OpeningImportForm } from "./OpeningImportForm";

export default async function OpeningImportPage() {
  let options;
  try { options = await openingImportOptions(); }
  catch (error) {
    if (error instanceof OpeningImportError) return <div className="admin-stack"><h1>Uvoz početnog stanja</h1><p role="alert">{error.message}</p></div>;
    throw error;
  }
  return <div className="admin-stack">
    <header className="admin-header"><div><h1>Uvoz početnog stanja</h1><p>{options.company} · {options.year}</p></div>
      <Link href="/agencija/nalozi/pocetno-stanje" className="secondary-button">Početno stanje</Link></header>
    {options.existingId ? <section className="admin-panel"><p>Za ovu firmu i godinu već postoji početno stanje. Uvoz ne prepisuje postojeći nalog.</p><Link href={`/agencija/nalozi/${options.existingId}`}>Otvori postojeći nalog</Link></section>
      : <OpeningImportForm key={`${options.companyId}:${options.yearId}`} options={options} />}
  </div>;
}
