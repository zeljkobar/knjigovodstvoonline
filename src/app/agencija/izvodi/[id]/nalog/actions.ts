"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BankStatementError } from "@/lib/bank-statement-lifecycle";
import { manualBankActor, postManualBankJournal, saveManualBankJournal } from "@/lib/bank-manual-journal";
import { manualBankMessages, manualText } from "@/lib/bank-manual-journal-input";

function refresh(id: string) {
  revalidatePath("/agencija/izvodi", "layout");
  revalidatePath(`/agencija/izvodi/${id}/nalog`);
  revalidatePath("/agencija/nalozi", "layout");
  revalidatePath("/agencija/racuni", "layout");
  revalidatePath("/agencija/izvjestaji", "layout");
}

export async function saveManualBankJournalAction(form: FormData): Promise<{ error?: string; url?: string }> {
  try {
    const actor = await manualBankActor();
    await saveManualBankJournal(actor, form);
    const id = manualText(form, "statement_id");
    refresh(id);
    return { url: `/agencija/izvodi/${id}/nalog?poruka=sacuvano` };
  } catch (error) {
    const code = error instanceof BankStatementError ? error.message : "nalog_greska";
    return { error: manualBankMessages[code] ?? manualBankMessages.nalog_greska };
  }
}

export async function postManualBankJournalAction(form: FormData) {
  const id = manualText(form, "statement_id");
  let code = "proknjizeno";
  let journalId: string | undefined;
  try {
    journalId = await postManualBankJournal(await manualBankActor(), form);
    refresh(id);
  } catch (error) {
    code = error instanceof BankStatementError ? error.message : "nalog_greska";
  }
  if (journalId) redirect(`/agencija/nalozi/${journalId}?poruka=nalog_proknjizen`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) redirect("/agencija/izvodi?poruka=izvod_greska");
  redirect(`/agencija/izvodi/${id}/nalog?${new URLSearchParams({ poruka: code })}`);
}
