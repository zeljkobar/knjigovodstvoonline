import { parseScaledInteger, scaledToDecimal } from "./inventory-calculation";

export const manualBankMessages: Record<string, string> = {
  prava: "Potrebna su prava za pregled/izmjenu naloga i izvoda ove firme.",
  godina_zakljucena: "Poslovna godina je zaključana.",
  pdv_period_zakljucan: "PDV period je zaključan.",
  izvod_greska: "Izvod ili njegov nacrt naloga nije dostupan u aktivnoj firmi i godini.",
  izvod_nalog_veze: "Nalog nije pravilno povezan sa izvodom ili ima druge zavisnosti.",
  izvod_promijenjen: "Podaci su u međuvremenu promijenjeni. Osvježite stranicu prije nastavka.",
  izvod_rucni_nalog: "Nalog je ručno uređen. Otvorite Edituj nalog; automatski predlog ga više ne mijenja.",
  nalog_datum: "Unesite ispravan datum naloga unutar poslovne godine.",
  stavke_obavezne: "Unesite bar jednu stavku naloga.",
  stavke_nevalidne: "Provjerite konto, datume i iznose. Iznos ima najviše dvije decimale.",
  stavka_iznos: "Stavka mora imati pozitivan iznos samo na jednoj strani: duguje ili potražuje.",
  konto_nevalidno: "Konto mora biti aktivno analitičko konto dostupno firmi.",
  partner_obavezan: "Provjerite dostupnost partnera i obaveznu analitiku konta.",
  poslovna_jedinica_obavezna: "Izaberite aktivnu poslovnu jedinicu za konta koja je zahtijevaju.",
  nalog_nije_balansiran: "Nalog mora biti izbalansiran i imati pozitivan ukupan iznos prije knjiženja.",
  izvod_broj_naloga_zauzet: "Broj naloga je već zauzet za ovu vrstu i godinu.",
  izvod_broj_naloga_greska: "Broj izvoda nije ispravan broj naloga.",
  izvod_veze_faktura: "Povezane fakture ne odgovaraju partnerima i iznosima ispravljenog naloga. Provjerite veze ili označite Ukloni postojeća povezivanja sa fakturama i ponovo sačuvajte.",
  sacuvano: "Nacrt naloga je sačuvan. Parser više ne prepisuje njegove stavke.",
  proknjizeno: "Nalog i izvod su proknjiženi.",
  nalog_greska: "Nalog nije sačuvan. Pokušajte ponovo."
};

export const manualText = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
export const manualCents = (value: { toString(): string }) => parseScaledInteger(value.toString(), 2)!;
export const manualDecimal = (value: bigint) => scaledToDecimal(value, 2);

export function manualLedgerBalanced(rows: Array<{ duguje: { toString(): string }; potrazuje: { toString(): string } }>) {
  const debit = rows.reduce((sum, row) => sum + manualCents(row.duguje), BigInt(0));
  return debit > BigInt(0) && debit === rows.reduce((sum, row) => sum + manualCents(row.potrazuje), BigInt(0));
}

export function manualDate(text: string) {
  if (!text) return null;
  const date = new Date(`${text}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? date : undefined;
}

export type ManualBankLine = {
  accountCode: string; partnerId: string | null; description: string;
  documentNumber: string | null; documentDate: Date | null; dueDate: Date | null;
  debit: bigint; credit: bigint;
};

export function parseManualBankLines(form: FormData): ManualBankLine[] {
  const keys = ["konto_sifra", "komitent_id", "stavka_opis", "broj_dokumenta", "datum_dokumenta", "datum_valute", "duguje", "potrazuje"];
  const values = keys.map(key => form.getAll(key).map(v => String(v).trim()));
  const count = Math.max(...values.map(v => v.length));
  if (count > 3000 || values.some(v => v.length !== count)) throw new Error("stavke_nevalidne");
  const lines: ManualBankLine[] = [];
  for (let i = 0; i < count; i++) {
    const [accountCode, partner, description, document, docDate, dueDate, debitText, creditText] = values.map(v => v[i]);
    // Enter can visit the next unused row and prefill the journal description.
    // A description alone is not an accounting line; any other entered field
    // still requires complete validation below.
    if (!accountCode && !partner && !document && !docDate && !dueDate && !debitText && !creditText) continue;
    const amount = (text: string) => {
      if (!text) return BigInt(0);
      if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) return null;
      const cents = parseScaledInteger(text, 2);
      return cents !== null && cents <= BigInt("99999999999999") ? cents : null;
    };
    const debit = amount(debitText), credit = amount(creditText);
    const documentDate = manualDate(docDate), dateDue = manualDate(dueDate);
    if (!accountCode || accountCode.length > 64 || description.length > 4000 || (document?.length ?? 0) > 255 || debit === null || credit === null || documentDate === undefined || dateDue === undefined) throw new Error("stavke_nevalidne");
    if ((debit === BigInt(0)) === (credit === BigInt(0))) throw new Error("stavka_iznos");
    lines.push({ accountCode, partnerId: partner || null, description, documentNumber: document || null, documentDate, dueDate: dateDue, debit, credit });
  }
  if (!lines.length) throw new Error("stavke_obavezne");
  return lines;
}
