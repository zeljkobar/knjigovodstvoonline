import { redirect } from "next/navigation";
import { requireImapAgency } from "../imap/access";
export default async function LegacyBankAutomationPage() {
  await requireImapAgency();
  redirect("/agencija/automatski-obradjena-dokumenta?izvor=BANK");
}
