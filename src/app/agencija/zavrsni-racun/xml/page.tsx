import Link from "next/link";
import { financialReportExportContext } from "@/lib/financial-report-export-context";
import ExportForm from "./ExportForm";
import "./xml.css";

export default async function FinancialXmlPage() {
  const context = await financialReportExportContext();
  if (!context) return <section className="admin-panel"><p>Izaberite firmu i godinu za koje imate pravo pregleda i izvoza završnog računa.</p></section>;
  const { firma, godina } = context;
  return <div className="admin-stack">
    <header className="admin-header"><div><h2>XML završnog računa</h2>
      <p>{firma.naziv} · PIB {firma.pib ?? "nije unesen"} · {godina.godina}</p>
      <p>Period {godina.datum_od.toISOString().slice(0, 10)} — {godina.datum_do.toISOString().slice(0, 10)}</p>
    </div><Link className="secondary-button" href="/agencija/zavrsni-racun/obrasci">Pregled obrazaca</Link></header>
    <section className="admin-panel"><h3>Šta ulazi u izvoz</h3>
      <p>Bilans stanja, Bilans uspjeha i Statistički aneks preuzimaju se iz trenutnog obračuna izabrane firme i godine, uključujući sačuvane ručne korekcije i uporedne kolone. Iznosi su u cijelim eurima, kao na pregledu obrazaca.</p>
      <p>Prije preuzimanja sačuvajte korekcije i provjerite prethodnu godinu. Ovo nije izvoz ranije snimljene arhive. Nekorišćeni obrasci ostaju u strukturi sa nulama; dodatne sekcije 1a/2a nijesu uključene jer ih dostavljena XSD šema ne sadrži.</p>
      <p>Preuzimanje ne podnosi prijavu. Prihvatanje datuma i poslovnih pravila treba potvrditi probnim uvozom na portal Poreske uprave.</p>
    </section>
    <section className="admin-panel"><ExportForm firmaId={firma.id} godinaId={godina.id} defaults={{
      SjedisteObveznika: firma.grad ?? firma.adresa ?? "",
      MaticniBroj: firma.pib ?? firma.maticni_broj ?? "",
      SifraDjelatnosti: firma.sifra_djelatnosti ?? "",
      FinansijskiIzvestajSastavljenNaDan: new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Podgorica" })
    }} /></section>
  </div>;
}
