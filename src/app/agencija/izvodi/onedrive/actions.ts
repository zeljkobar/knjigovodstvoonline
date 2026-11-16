"use server";

import { revalidatePath } from "next/cache";
import { importCloudStatement } from "@/lib/bank-statement-cloud";
import { MailImportError } from "@/lib/mail-import-policy";
import { getIzvodiContext } from "../_shared";

export async function importOneDriveStatement(input: { firmaId: string; yearId: string; bankId: string; itemId: string; version?: string }) {
  const { user, firma, godina } = await getIzvodiContext("create");
  if (!user.agencija_id || !firma || !godina || firma.id !== input.firmaId || godina.id !== input.yearId || godina.zakljucena) {
    return { status: "ERROR", message: "Izaberite istu firmu i otvorenu poslovnu godinu." };
  }
  try {
    const scope = { agencija_id: user.agencija_id, firma_id: firma.id, poslovna_godina_id: godina.id };
    const result = await importCloudStatement(scope, input.bankId, input.itemId, input.version);
    revalidatePath("/agencija");
    return result?.status === "IMPORTED"
      ? { status: "IMPORTED", message: "Uvezen" }
      : { status: "DUPLICATE", message: "Već postoji u programu" };
  } catch (error) {
    return { status: "ERROR", message: error instanceof MailImportError ? error.message :
      "Preuzimanje ili uvoz nije uspio. Osvježite pregled i pokušajte ponovo." };
  }
}
