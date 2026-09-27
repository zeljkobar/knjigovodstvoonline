"use server";

import { requireImapAgency } from "./access";
import { auditLog } from "@/lib/audit";
import { testImapConnection, type ImapTestResult } from "@/lib/imap-connection";

export async function checkImapConnection(): Promise<ImapTestResult> {
  const user = await requireImapAgency();
  const result = await testImapConnection();
  await auditLog({
    korisnikId: user.id, agencijaId: user.agencija_id, modul: "izvodi", akcija: "IMAP_CONNECTION_TEST",
    tipEntiteta: "IMAP_CONNECTION",
    novaVrijednost: { status: result.ok ? "OK" : result.code }
  });
  return result;
}
