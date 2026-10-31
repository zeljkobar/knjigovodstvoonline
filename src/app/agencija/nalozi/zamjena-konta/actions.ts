"use server";

import { revalidatePath } from "next/cache";
import { AccountReplacementError, previewAccountReplacement, applyAccountReplacement } from "@/lib/journal-account-replacement";

export type ReplacementState = {
  error?: string;
  success?: string;
  preview?: Awaited<ReturnType<typeof previewAccountReplacement>>;
};

export async function replaceJournalAccount(_previous: ReplacementState, formData: FormData): Promise<ReplacementState> {
  try {
    if (formData.get("intent") === "confirm") {
      const result = await applyAccountReplacement(String(formData.get("token") ?? ""));
      revalidatePath("/agencija/nalozi", "layout");
      revalidatePath("/agencija/izvodi", "layout");
      revalidatePath("/agencija/izvjestaji", "layout");
      return { success: `Konto je zamijenjen na ${result.changed} stavki u ${result.journals} naloga.` };
    }
    return { preview: await previewAccountReplacement(formData) };
  } catch (error) {
    if (error instanceof AccountReplacementError) return { error: error.message };
    // Next redirects (session/role) must retain their normal handling.
    if (error && typeof error === "object" && "digest" in error && String(error.digest).startsWith("NEXT_REDIRECT")) throw error;
    return { error: "Zamjena nije izvršena. Osvježite pregled i pokušajte ponovo." };
  }
}
