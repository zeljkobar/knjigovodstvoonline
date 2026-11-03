import { importFail, openingTotals, primatechCents, primatechCode, type OpeningImportData } from "./primatech-opening";

export type EpsilonBasis = "OPENING" | "CLOSING";
type Balance = { code: string; name: string; debit: number; credit: number };
const value = (v: unknown) => String(v ?? "").trim();

// The positional layout is checked before reading amounts: C/D are opening
// balances, I/J are closing balances. E/F and G/H must never become opening entries.
function header(rows: unknown[][], partners: boolean) {
  const index = rows.findIndex(r => value(r[0]) === (partners ? "I.D." : "KONTO") && value(r[1]) === (partners ? "NAZIV-GRAD" : "NAZIV KONTA"));
  if (index < 1 || value(rows[index - 1][2]) !== "POČETNO STANJE" || value(rows[index - 1][4]) !== "TEKUĆI PROMET" || value(rows[index - 1][6]) !== "UKUPAN PROMET" || value(rows[index - 1][8]).replace(/\s/g, "") !== "SALDO" || value(rows[index][10]) !== "SALDO" || value(rows[index][11]) !== "D/P") importFail(`Nije prepoznat Epsilon ${partners ? "zbirni pregled partnera (I.D., NAZIV-GRAD)" : "zaključni list (KONTO, NAZIV KONTA)"}.`);
  for (const c of [2, 4, 6, 8]) if (value(rows[index][c]) !== "-duguje-" || value(rows[index][c + 1]) !== "-potražuje-") importFail("Kolone duguje/potražuje Epsilon izvještaja su promijenjene.");
  return index;
}

export function parseEpsilonBalances(rows: unknown[][], partners: boolean, basis: EpsilonBasis): Balance[] {
  if (basis !== "OPENING" && basis !== "CLOSING") importFail("Izaberite početno stanje ili završni saldo izvještaja.");
  const index = header(rows, partners), seen = new Set<string>(), result: Balance[] = [];
  for (const r of rows.slice(index + 1)) {
    if (r.every(v => v == null || v === "")) continue;
    const code = partners ? value(r[0]) : primatechCode(r[0]);
    if (!/^\d{1,12}$/.test(code) || !value(r[1]) || seen.has(code)) importFail(`Neispravna ili ponovljena ${partners ? "I.D. šifra partnera" : "šifra konta"}: ${code}`);
    seen.add(code);
    const amounts = [2, 3, 4, 5, 6, 7, 8, 9, 10].map(c => {
      const amount = primatechCents(r[c]);
      if (amount < 0) importFail(`Epsilon red ${code} sadrži negativan iznos. Potrebna je provjera formata.`);
      return amount;
    });
    const [od, oc, td, tc, ad, ac, sd, sc, magnitude] = amounts;
    const sign = value(r[11]);
    if (od + td !== ad || oc + tc !== ac || ad - ac !== sd - sc || (sd > 0 && sc > 0) || magnitude !== sd + sc || sign !== (sd ? "D" : sc ? "P" : "")) importFail(`Epsilon red ${code}: početno stanje, promet i saldo se ne slažu. Ponovite izvoz bez ručnih izmjena.`);
    result.push({ code, name: value(r[1]), debit: basis === "OPENING" ? od : sd, credit: basis === "OPENING" ? oc : sc });
  }
  if (!result.length || result.length > 1000) importFail("Epsilon izvještaj mora imati od 1 do 1.000 redova.");
  return result;
}

export function buildEpsilonOpening(input: {
  ledger: unknown[][]; suppliers?: unknown[][] | null; customers?: unknown[][] | null;
  supplierAccount: string; customerAccount: string; basis: EpsilonBasis; reportDate: string; company: string; year: number;
}): OpeningImportData {
  const { basis, year } = input;
  const expectedDate = basis === "OPENING" ? `${year}-01-01` : `${year - 1}-12-31`;
  if (input.reportDate !== expectedDate) importFail(`Za ovu vrstu prenosa izvještaji moraju biti na datum ${expectedDate}.`);
  const ledger = parseEpsilonBalances(input.ledger, false, basis);
  const data: OpeningImportData = { format: "EPSILON_V1", company: input.company, date: `${year}-01-01`, number: "Epsilon saldo",
    lines: [], partners: [], closing: [], files: [], epsilon: { basis, reportDate: input.reportDate, expandedAccounts: [], blocked: [], controls: [] } };
  const details = new Map<string, Balance[]>();
  for (const [rows, rawAccount] of [[input.suppliers, input.supplierAccount], [input.customers, input.customerAccount]] as const) {
    if (!rows) continue;
    const account = primatechCode(rawAccount);
    if (details.has(account)) importFail("Dobavljači i kupci ne mogu razrađivati isto izvorno konto.");
    const balance = ledger.find(l => l.code === account);
    if (!balance) importFail(`Konto ${account} ne postoji u Epsilon zaključnom listu.`);
    const partners = parseEpsilonBalances(rows, true, basis);
    const actual = partners.reduce((n, p) => n + p.debit - p.credit, 0), expected = balance.debit - balance.credit;
    data.epsilon!.controls.push({ account, expected, actual });
    if (actual !== expected) data.epsilon!.blocked.push(`Razrada konta ${account} nije jednaka zaključnom listu. Provjerite firmu, datum, izabrane kolone i obuhvat partnera.`);
    details.set(account, partners);
    data.epsilon!.expandedAccounts.push(account);
  }
  function append(balance: Balance, partner = "") {
    const cents = balance.debit - balance.credit;
    if (!cents) return;
    data.lines.push({ row: data.lines.length + 1, account: balance.code, accountName: balance.name, partner,
      description: `Početno stanje${partner ? `\n${partner}` : ""}`, debit: cents > 0 ? cents : 0, credit: cents < 0 ? -cents : 0 });
  }
  for (const balance of ledger) {
    if (!/^[0-4]/.test(balance.code)) {
      if (balance.debit !== balance.credit) data.epsilon!.blocked.push(`Konto ${balance.code} ima nezatvoren saldo klase 5–9. Potreban je završen zaključni list prije prenosa.`);
      continue;
    }
    const breakdown = details.get(balance.code);
    if (breakdown) {
      for (const p of breakdown) {
        const label = `${p.code} · ${p.name}`;
        append({ ...balance, debit: p.debit, credit: p.credit }, label);
        if (p.debit !== p.credit) data.partners.push({ name: label, pib: null, city: "" });
      }
    } else {
      append(balance);
      if (/^(202|203|433|434)/.test(balance.code) && balance.debit !== balance.credit) data.epsilon!.blocked.push(`Za konto ${balance.code} nedostaje zbirni pregled kupaca/dobavljača sa pojedinačnim saldima partnera.`);
    }
    data.closing.push({ account: balance.code, name: balance.name, cents: balance.debit - balance.credit });
  }
  if (!data.lines.length || data.lines.length > 1000) importFail("Prenos mora sadržati od 1 do 1.000 nenultih stavki.");
  openingTotals(data.lines);
  return data;
}
