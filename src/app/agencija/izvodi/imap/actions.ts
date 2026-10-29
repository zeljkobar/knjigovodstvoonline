"use server";
import { requireImapAgency } from "./access";
import { checkSavedMailAccount } from "../../podesavanja/mail-nalozi/actions";
export async function checkImapConnection(accountId: string) {
  await requireImapAgency();
  return checkSavedMailAccount(accountId);
}
