import Link from "next/link";
import { ManualBankJournalForm } from "@/components/ManualBankJournalForm";
import type { JournalLineInitialValue } from "@/components/JournalLinesEditor";
import { loadManualBankEditor, manualBankActor } from "@/lib/bank-manual-journal";
import { BankStatementError } from "@/lib/bank-statement-lifecycle";
import { manualBankMessages, manualCents as cents, manualDecimal as decimal } from "@/lib/bank-manual-journal-input";
import { bankStatementAmountBlockers } from "@/lib/bank-statement-rules";
import { requireAnyRole } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { saveManualBankJournalAction, postManualBankJournalAction } from "./actions";

type Props = { params: Promise<{ id: string }>; searchParams?: Promise<{ poruka?: string }> };

export default async function ManualBankJournalPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const back = `/agencija/izvodi?${new URLSearchParams({ izvod: id, tab: "nalog" })}`;
  let data;
  try { data = await loadManualBankEditor(await manualBankActor(), id); }
  catch (error) {
    if (!(error instanceof BankStatementError)) throw error;
    // Posting returns to this route. Once posted, the editor is intentionally
    // closed; the user follows the source back to reopen it before editing.
    return <section className="admin-panel"><p className="status-banner">{query?.poruka === "proknjizeno" ? manualBankMessages.proknjizeno : manualBankMessages[error.message] ?? manualBankMessages.izvod_greska}</p><Link href={back}>Otvori izvod</Link></section>;
  }
  const { statement, accounts, units } = data;
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const canPost = await hasPermission(user, { firmaId: statement.firma_id, modul: "izvodi", akcija: "post" })
    && await hasPermission(user, { firmaId: statement.firma_id, modul: "nalozi", akcija: "post" });
  const day = (date: Date | null) => date?.toISOString().slice(0, 10) ?? "";
  const amount = (value: { toString(): string }) => cents(value) === BigInt(0) ? "" : decimal(cents(value));
  const initial: JournalLineInitialValue[] = statement.journal ? statement.journal.stavke.map(line => ({
    accountCode: line.firma_konto.sifra, partnerId: line.komitent_id ?? "", partnerNaziv: line.komitent?.naziv ?? "", partnerPib: line.komitent?.pib,
    debit: amount(line.duguje), credit: amount(line.potrazuje), description: line.opis ?? "", documentNumber: line.broj_dokumenta ?? "",
    documentDate: day(line.datum_dokumenta), documentDueDate: day(line.datum_valute)
  })) : [
    ...(cents(statement.total_inflow) > BigInt(0) ? [{ accountCode: statement.bank_account_konto?.sifra ?? "", debit: amount(statement.total_inflow), description: `Ukupan priliv po izvodu ${statement.statement_number}`, documentNumber: statement.statement_number, documentDate: day(statement.statement_date) }] : []),
    ...(cents(statement.total_outflow) > BigInt(0) ? [{ accountCode: statement.bank_account_konto?.sifra ?? "", credit: amount(statement.total_outflow), description: `Ukupan odliv po izvodu ${statement.statement_number}`, documentNumber: statement.statement_number, documentDate: day(statement.statement_date) }] : []),
    ...statement.lines.filter(line => line.posting_status !== "IGNORED").map(line => {
      const inflow = line.direction === "INFLOW";
      const value = cents(line.inflow_amount) || cents(line.outflow_amount);
      return { accountCode: (inflow ? line.credit_account?.sifra : line.debit_account?.sifra) ?? "", partnerId: line.partner_id ?? "", partnerNaziv: line.partner?.naziv ?? "", partnerPib: line.partner?.pib,
        debit: inflow ? "" : decimal(value), credit: inflow ? decimal(value) : "", description: line.description,
        documentNumber: statement.statement_number, documentDate: day(line.posting_date), documentDueDate: day(line.value_date) };
    })
  ];
  const warnings = bankStatementAmountBlockers(statement);
  return <div className="admin-stack">
    <header className="admin-header"><div><h2>Edituj nalog izvoda {statement.statement_number}</h2><p>{statement.firma.naziv} · {statement.poslovna_godina.godina}{statement.journal ? ` · ${statement.journal.sifra}` : " · Novi nacrt"}</p></div>
      <Link className="secondary-button" href={back}>Nazad na izvod</Link></header>
    <section className="admin-panel">
      <p className="status-banner">Ovdje uređujete konačni nalog. Možete mijenjati sve stavke, uključujući konto banke, dodavati i brisati redove. Poslije čuvanja parser više ne prepisuje nalog.</p>
      {warnings.length ? <div className="status-banner"><strong>Napomene izvornog parsiranja — ne blokiraju ispravan ručni nalog:</strong><ul>{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div> : null}
      {query?.poruka && manualBankMessages[query.poruka] ? <p className="status-banner" role="status">{manualBankMessages[query.poruka]}</p> : null}
      <ManualBankJournalForm key={`${statement.updated_at.toISOString()}:${statement.journal?.updated_at.toISOString() ?? ""}`}
        statementId={statement.id} statementVersion={statement.updated_at.toISOString()}
        journalId={statement.journal_id ?? ""} journalVersion={statement.journal?.updated_at.toISOString() ?? ""}
        date={day(statement.journal?.datum ?? statement.statement_date)} description={statement.journal?.opis ?? `Izvod ${statement.statement_number}`}
        unitId={statement.journal ? statement.journal.poslovna_jedinica_id ?? "" : statement.poslovna_jedinica_id ?? ""}
        units={units} accounts={accounts.map(a => ({ sifra: a.sifra, naziv: a.naziv, analitika_obavezna: a.analitika_obavezna }))}
        initialLines={initial} canPost={canPost} manualSaved={statement.journal_mode === "MANUAL"} saveAction={saveManualBankJournalAction} postAction={postManualBankJournalAction}
        allocations={statement.lines.flatMap(line => line.allocations.map(a => ({ id: a.id, label: `${a.document_type} · stavka izvoda ${line.line_number} · ${decimal(cents(a.amount))} EUR` })))} />
    </section>
  </div>;
}
