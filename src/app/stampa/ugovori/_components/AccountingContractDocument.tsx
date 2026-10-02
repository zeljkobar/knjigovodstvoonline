import type { FirmaUgovor } from "@prisma/client";
import type { agencyContractSnapshot, clientContractSnapshot } from "@/lib/agency-profile";
import { accountingContractArticles } from "@/lib/accounting-contract-template";

type Props = {
  agency: ReturnType<typeof agencyContractSnapshot>;
  client: ReturnType<typeof clientContractSnapshot>;
  contract: Pick<FirmaUgovor, "datum_zakljucenja" | "datum_pocetka" | "datum_prestanka" | "mjesecna_cijena" | "valuta" | "dan_placanja" | "rok_placanja_dana" | "nadlezni_sud" | "dodatne_usluge" | "napomena"> | null;
};
const blank = "________________";
function date(value: Date | null | undefined) {
  return value ? `${String(value.getUTCDate()).padStart(2, "0")}.${String(value.getUTCMonth()+1).padStart(2, "0")}.${value.getUTCFullYear()}.` : "____.____.________.";
}
function amount(value: Props["contract"]) {
  const raw = value?.mjesecna_cijena?.toString();
  if (raw === undefined) return `${blank} ${value?.valuta ?? "EUR"}`;
  const [integer, fraction = ""] = raw.split(".");
  return `${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction.padEnd(2, "0")} ${value?.valuta ?? "EUR"}`;
}
export function AccountingContractDocument({agency, client, contract}: Props) {
  const fields: Record<string, string> = {
    cijena: amount(contract),
    racun: agency.racun || blank,
    rok: contract?.dan_placanja != null
      ? `do ${contract.dan_placanja}. dana u mjesecu za prethodni mjesec`
      : contract?.rok_placanja_dana != null
        ? `u roku od ${contract.rok_placanja_dana} dana od dana izdavanja fakture za prethodni mjesec`
        : `u roku od ${blank} dana od dana izdavanja fakture za prethodni mjesec`,
    sud: contract?.nadlezni_sud || blank,
    pocetak: date(contract?.datum_pocetka)
  };
  const substitute = (text: string) => text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => fields[key] ?? blank);
  return <article className="contract-document accounting-contract-document">
    <header className="contract-header"><h1>UGOVOR O RAČUNOVODSTVENIM USLUGAMA</h1></header>
    <section className="contract-intro">
      <p>Zaključen dana {date(contract?.datum_zakljucenja)} godine između ugovornih strana</p>
      <p>1. <strong>{agency.naziv || blank}</strong>, {[agency.adresa, agency.grad].filter(Boolean).join(", ") || blank}, PIB: {agency.pib || blank}, koga zastupa {agency.zastupnik_funkcija || blank} <strong>{agency.zastupnik_ime || blank}</strong> (u daljem tekstu, Izvršilac usluga)</p>
      <p className="contract-conjunction">i</p>
      <p>2. <strong>{client.naziv || blank}</strong>, {[client.adresa, client.grad || client.opstina].filter(Boolean).join(", ") || blank}, PIB: {client.pib || blank}, koga zastupa {client.zastupnik_funkcija || blank} <strong>{client.zastupnik_ime || blank}</strong> (u daljem tekstu, Korisnik usluga).</p>
      <p><strong>PREDMET UGOVORA: Računovodstvene usluge</strong></p>
    </section>
    {accountingContractArticles.map(article => <section className="contract-section" key={article.number}>
      <h2>Član {article.number}.</h2>
      {article.paragraphs.map((paragraph, index) => <p key={index} className={paragraph.startsWith("–") ? "contract-list-item" : undefined}>{substitute(paragraph)}</p>)}
      {article.number === 13 && contract?.datum_prestanka ? <p>Ugovor prestaje da važi dana {date(contract.datum_prestanka)} godine.</p> : null}
    </section>)}
    {contract?.dodatne_usluge || contract?.napomena ? <section className="contract-section contract-addendum">
      <h2>Dodatno ugovoreno</h2>
      {contract.dodatne_usluge ? <p>{contract.dodatne_usluge}</p> : null}
      {contract.napomena ? <p>{contract.napomena}</p> : null}
    </section> : null}
    <footer className="contract-signatures">
      <div><span>Za Izvršioca usluga</span><span>{agency.zastupnik_ime || blank}</span><strong>________________________</strong></div>
      <div><span>Za Korisnika usluga</span><span>{client.zastupnik_ime || blank}</span><strong>________________________</strong></div>
    </footer>
  </article>;
}
