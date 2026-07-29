import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { requireAnyRole } from "@/lib/auth";
import { calculationStatusLabel } from "@/lib/inventory-calculation";
import { prisma } from "@/lib/prisma";

type PageProps = {
  params: Promise<{ id: string }>;
};

function money(value: { toString(): string }, digits = 2) {
  return Number(value.toString()).toLocaleString("sr-Latn-ME", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function date(value: Date | null) {
  return value?.toLocaleDateString("sr-Latn-ME") ?? "-";
}

export default async function CalculationPrintPage({ params }: PageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const { id } = await params;
  if (!user.agencija_id) notFound();

  const calculation = await prisma.kalkulacija.findFirst({
    where: {
      id,
      agencija_id: user.agencija_id,
      is_deleted: false,
      ...(user.rola === "admin_agencije"
        ? {}
        : {
            firma: {
              korisnici: {
                some: { korisnik_id: user.id, is_deleted: false }
              }
            }
          })
    },
    include: {
      firma: true,
      magacin: true,
      dobavljac: true,
      poslovna_godina: { select: { godina: true } },
      stavke: {
        include: {
          artikal: { include: { jedinica_mjere: true } }
        },
        orderBy: { redni_broj: "asc" }
      },
      zavisniTroskovi: { orderBy: { created_at: "asc" } }
    }
  });
  if (!calculation) notFound();

  const vatRecap = new Map<
    string,
    { rate: string; base: number; inputVat: number; saleNet: number; includedVat: number; saleGross: number }
  >();
  for (const line of calculation.stavke) {
    const rate = line.ulazni_pdv_stopa.toString();
    const item = vatRecap.get(rate) ?? {
      rate,
      base: 0,
      inputVat: 0,
      saleNet: 0,
      includedVat: 0,
      saleGross: 0
    };
    item.base += Number(line.neto_fakturna_vrijednost);
    item.inputVat += Number(line.ulazni_pdv_iznos);
    item.saleNet += Number(line.prodajna_vrijednost_bez_pdv);
    item.includedVat += Number(line.ukalkulisani_pdv_iznos);
    item.saleGross += Number(line.prodajna_vrijednost_sa_pdv);
    vatRecap.set(rate, item);
  }

  return (
    <main className="print-page">
      <div className="print-toolbar"><PrintButton label="Štampaj kalkulaciju" /></div>
      <article className="calculation-print-document">
        <header className="calculation-print-header">
          <div>
            <strong>{calculation.firma.naziv}</strong>
            <span>
              {calculation.firma.adresa ?? ""}
              {calculation.firma.grad ? `, ${calculation.firma.grad}` : ""}
            </span>
            <span>PIB: {calculation.firma.pib ?? "-"} · PDV: {calculation.firma.pdv_broj ?? "-"}</span>
          </div>
          <div className="calculation-print-title">
            <p>Robno knjigovodstvo</p>
            <h1>KALKULACIJA</h1>
            <strong>{calculation.interni_broj}</strong>
          </div>
          <div className="calculation-print-status">
            <span>Status</span>
            <strong>{calculationStatusLabel(calculation.status)}</strong>
            <span>Godina {calculation.poslovna_godina.godina}</span>
          </div>
        </header>

        <section className="calculation-print-meta">
          <div><span>Dobavljač</span><strong>{calculation.dobavljac.naziv}</strong><small>PIB: {calculation.dobavljac.pib ?? "-"}</small><small>{calculation.dobavljac.adresa ?? ""} {calculation.dobavljac.grad ?? ""}</small></div>
          <div><span>Račun dobavljača</span><strong>{calculation.broj_racuna_dobavljaca}</strong><small>Datum: {date(calculation.datum_racuna_dobavljaca)}</small><small>Valuta: {date(calculation.datum_valute)}</small></div>
          <div><span>Kalkulacija</span><strong>{date(calculation.datum_kalkulacije)}</strong><small>Tip: {calculation.tip_prodaje === "RETAIL" ? "Maloprodaja" : "Veleprodaja"}</small><small>Valuta: {calculation.valuta}</small></div>
          <div><span>Magacin</span><strong>{calculation.magacin.sifra} · {calculation.magacin.naziv}</strong><small>{calculation.napomena ?? ""}</small></div>
        </section>

        <table className="calculation-print-table">
          <thead>
            <tr>
              <th>#</th><th>Šifra / naziv artikla</th><th>JM</th><th>Količina</th>
              <th>Fakturna cijena</th><th>Rabat %</th><th>Neto faktura</th>
              <th>Zav. trošak</th><th>Nabavna cijena</th><th>Ulazni PDV</th>
              <th>Marža / RUC</th><th>Prodajna bez PDV</th><th>Prodajna sa PDV</th>
              <th>Prodajna vrijednost</th>
            </tr>
          </thead>
          <tbody>
            {calculation.stavke.map((line) => (
              <tr key={line.id}>
                <td>{line.redni_broj}</td>
                <td><strong>{line.artikal.sifra}</strong><span>{line.artikal.naziv}</span>{line.artikal.barkod ? <small>{line.artikal.barkod}</small> : null}</td>
                <td>{line.artikal.jedinica_mjere.oznaka}</td>
                <td>{money(line.kolicina, 3)}</td>
                <td>{money(line.fakturna_cijena, 4)}</td>
                <td>{money(line.rabat_procenat)}</td>
                <td>{money(line.neto_fakturna_vrijednost)}</td>
                <td>{money(line.zavisni_trosak)}</td>
                <td>{money(line.jedinicna_nabavna_cijena, 4)}</td>
                <td>{money(line.ulazni_pdv_stopa)}%<small>{money(line.ulazni_pdv_iznos)}</small></td>
                <td>{money(line.marza_procenat)}%<small>RUC {money(line.ruc_procenat)}%</small></td>
                <td>{money(line.prodajna_cijena_bez_pdv, 4)}</td>
                <td>{money(line.prodajna_cijena_sa_pdv, 4)}</td>
                <td>{money(line.prodajna_vrijednost_sa_pdv)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={6}>UKUPNO</td>
              <td>{money(calculation.ukupno_neto_fakturno)}</td>
              <td>{money(calculation.ukupno_zavisni_troskovi)}</td>
              <td>{money(calculation.ukupno_nabavna_vrijednost)}</td>
              <td>{money(calculation.ukupno_ulazni_pdv)}</td>
              <td>{money(calculation.ukupno_razlika_u_cijeni)}</td>
              <td colSpan={2}></td>
              <td>{money(calculation.ukupno_prodajna_vrijednost_sa_pdv)}</td>
            </tr>
          </tfoot>
        </table>

        <section className="calculation-print-bottom">
          <div>
            <h2>Rekapitulacija PDV-a</h2>
            <table>
              <thead><tr><th>Stopa</th><th>Neto ulaz</th><th>Ulazni PDV</th><th>Prodaja bez PDV</th><th>Ukalk. PDV</th><th>Prodaja sa PDV</th></tr></thead>
              <tbody>{[...vatRecap.values()].map((item) => <tr key={item.rate}><td>{item.rate}%</td><td>{item.base.toFixed(2)}</td><td>{item.inputVat.toFixed(2)}</td><td>{item.saleNet.toFixed(2)}</td><td>{item.includedVat.toFixed(2)}</td><td>{item.saleGross.toFixed(2)}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="calculation-print-summary">
            <h2>Vrijednosni pregled</h2>
            <p><span>Fakturna vrijednost</span><strong>{money(calculation.ukupno_fakturno_bez_pdv)}</strong></p>
            <p><span>Rabat</span><strong>{money(calculation.ukupno_rabat)}</strong></p>
            <p><span>Račun sa PDV-om</span><strong>{money(calculation.ukupno_racun_sa_pdv)}</strong></p>
            <p><span>Nabavna vrijednost</span><strong>{money(calculation.ukupno_nabavna_vrijednost)}</strong></p>
            <p><span>Razlika u cijeni</span><strong>{money(calculation.ukupno_razlika_u_cijeni)}</strong></p>
            <p className="grand-total"><span>Prodajna vrijednost</span><strong>{money(calculation.ukupno_prodajna_vrijednost_sa_pdv)}</strong></p>
          </div>
        </section>

        {calculation.zavisniTroskovi.length ? (
          <section className="calculation-print-costs">
            <strong>Zavisni troškovi:</strong>{" "}
            {calculation.zavisniTroskovi.map((cost) => `${cost.vrsta} ${money(cost.iznos)}`).join(" · ")}
          </section>
        ) : null}

        <footer className="calculation-print-footer">
          <div><span>Kalkulisao</span><strong>____________________________</strong></div>
          <div><span>Kontrolisao</span><strong>____________________________</strong></div>
          <div><span>Odobrio</span><strong>____________________________</strong></div>
        </footer>
      </article>
    </main>
  );
}
