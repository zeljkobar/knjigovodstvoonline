"use server";
import { revalidatePath } from "next/cache";
import { requireAnyRole } from "@/lib/auth";
import { copyPayrollMonths, PayrollCopyError, type PayrollCopyResult } from "@/lib/payroll-copy";

export type PayrollCopyState = { error: string | null; results: PayrollCopyResult[] };
export async function copyPayrollAction(_previous: PayrollCopyState, form: FormData): Promise<PayrollCopyState> {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  if (!user.agencija_id) return { error: "Nemate pristup agenciji.", results: [] };
  const selected = form.getAll("firma_id").map(id => String(id));
  try {
    const results = await copyPayrollMonths({ userId: user.id, agencyId: user.agencija_id }, String(form.get("izvor") ?? ""), String(form.get("cilj") ?? ""), selected.map(companyId => ({ companyId, version: String(form.get(`verzija_${companyId}`) ?? "") })));
    revalidatePath("/agencija/plate/obracun");
    revalidatePath("/agencija/plate/ioppd");
    return { error: null, results };
  } catch (error) {
    return { error: error instanceof PayrollCopyError ? error.message : "Kopiranje nije završeno. Osvježite spisak i pokušajte ponovo.", results: [] };
  }
}
