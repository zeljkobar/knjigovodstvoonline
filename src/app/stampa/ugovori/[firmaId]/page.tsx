import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/PrintButton";
import { requireAnyRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type StampaUgovoraPageProps = {
  params: Promise<{
    firmaId: string;
  }>;
};

function formatDate(date: Date | null) {
  if (!date) {
    return "-";
  }

  return date.toLocaleDateString("sr-Latn");
}

function moneyLabel(value: { toString: () => string } | null, currency: string) {
  if (!value) {
    return "-";
  }

  return `${Number(value.toString()).toLocaleString("sr-Latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} ${currency}`;
}

export default async function StampaUgovoraPage({ params }: StampaUgovoraPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const { firmaId } = await params;

  if (!user.agencija_id) {
    return null;
  }

  const firma = await prisma.firma.findFirst({
    where: {
      id: firmaId,
      agencija_id: user.agencija_id,
      is_deleted: false,
      ...(user.rola === "admin_agencije"
        ? {}
        : {
            korisnici: {
              some: {
                korisnik_id: user.id,
                is_deleted: false
              }
            }
          })
    },
    select: {
      id: true,
      naziv: true,
      pib: true,
      pdv_broj: true,
      adresa: true,
      grad: true,
      opstina: true,
      email: true,
      telefon: true,
      agencija: {
        select: {
          naziv: true,
          pib: true,
          adresa: true,
          grad: true,
          email: true,
          telefon: true
        }
      },
      ugovor: {
        select: {
          datum_pocetka: true,
          datum_prestanka: true,
          mjesecna_cijena: true,
          valuta: true,
          rok_placanja_dana: true,
          dan_fakturisanja: true,
          paket: true,
          dodatne_usluge: true,
          dugovanje: true,
          automatsko_fakturisanje: true,
          faktura_kao_nacrt: true,
          napomena: true
        }
      }
    }
  });

  if (!firma) {
    notFound();
  }

  const ugovor = firma.ugovor;

  return (
    <main className="print-page">
      <div className="print-toolbar">
        <Link className="table-link" href={`/agencija/firme/ugovori?firma=${firma.id}`}>
          Nazad na ugovor
        </Link>
        <PrintButton label="Stampaj ugovor" />
      </div>

      <article className="contract-document">
        <header className="contract-header">
          <p>Broj: ____ / {new Date().getFullYear()}</p>
          <h1>UGOVOR O PRUZANJU KNJIGOVODSTVENIH USLUGA</h1>
        </header>

        <section className="contract-intro">
          <p>Zakljucen izmedju:</p>
          <p>
            <strong>{firma.agencija.naziv}</strong>, PIB {firma.agencija.pib ?? "________"},
            sa sjedistem na adresi{" "}
            {[firma.agencija.adresa, firma.agencija.grad].filter(Boolean).join(", ") ||
              "________"}
            , kao pruzaoca usluge,
          </p>
          <p>i</p>
          <p>
            <strong>{firma.naziv}</strong>, PIB {firma.pib ?? "________"}, PDV broj{" "}
            {firma.pdv_broj ?? "________"}, sa sjedistem na adresi{" "}
            {[firma.adresa, firma.opstina, firma.grad].filter(Boolean).join(", ") ||
              "________"}
            , kao klijenta.
          </p>
        </section>

        <section className="contract-section">
          <h2>Clan 1. Predmet ugovora</h2>
          <p>
            Pruzalac usluge se obavezuje da za klijenta obavlja knjigovodstvene,
            racunovodstvene i povezane administrativne usluge, u obimu koji ce biti
            precizno definisan konacnom verzijom ovog ugovora i pratecim dogovorima
            ugovornih strana.
          </p>
        </section>

        <section className="contract-section">
          <h2>Clan 2. Cijena i nacin placanja</h2>
          <p>
            Ugovorne strane su saglasne da mjesecna cijena usluge iznosi{" "}
            <strong>
              {moneyLabel(ugovor?.mjesecna_cijena ?? null, ugovor?.valuta ?? "EUR")}
            </strong>
            .
          </p>
          <p>
            Rok placanja je {ugovor?.rok_placanja_dana ?? "____"} dana od dana izdavanja
            fakture. Fakturisanje se vrsi {ugovor?.dan_fakturisanja ?? "____"}. dana u
            mjesecu, osim ako ugovorne strane naknadno ne dogovore drugacije.
          </p>
          <table className="contract-table">
            <tbody>
              <tr>
                <th>Paket</th>
                <td>{ugovor?.paket ?? "-"}</td>
              </tr>
              <tr>
                <th>Automatsko fakturisanje</th>
                <td>{ugovor?.automatsko_fakturisanje ? "Ukljuceno" : "Iskljuceno"}</td>
              </tr>
              <tr>
                <th>Faktura kao nacrt</th>
                <td>{ugovor?.faktura_kao_nacrt ? "Da" : "Ne"}</td>
              </tr>
              <tr>
                <th>Trenutno dugovanje</th>
                <td>{moneyLabel(ugovor?.dugovanje ?? null, ugovor?.valuta ?? "EUR")}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="contract-section">
          <h2>Clan 3. Trajanje ugovora</h2>
          <p>
            Ugovor se primjenjuje od {formatDate(ugovor?.datum_pocetka ?? null)}
            {ugovor?.datum_prestanka
              ? ` do ${formatDate(ugovor.datum_prestanka)}.`
              : " i vazi do opoziva ili raskida ugovora."}
          </p>
        </section>

        <section className="contract-section">
          <h2>Clan 4. Dodatne usluge</h2>
          <p>{ugovor?.dodatne_usluge || "Dodatne usluge ce biti definisane naknadno."}</p>
        </section>

        <section className="contract-section">
          <h2>Clan 5. Napomena</h2>
          <p>
            {ugovor?.napomena ||
              "Ovo je radna placeholder verzija ugovora. Konacni tekst ce naknadno sadrzati detaljne pravne odredbe, obaveze strana, rokove dostavljanja dokumentacije, uslove raskida i odgovornost za tacnost podataka."}
          </p>
        </section>

        <section className="contract-place">
          <p>U ____________________, dana ____.____.{new Date().getFullYear()}.</p>
        </section>

        <footer className="contract-signatures">
          <div>
            <span>Za pruzaoca usluge</span>
            <strong>________________________</strong>
          </div>
          <div>
            <span>Za klijenta</span>
            <strong>________________________</strong>
          </div>
        </footer>
      </article>
    </main>
  );
}
