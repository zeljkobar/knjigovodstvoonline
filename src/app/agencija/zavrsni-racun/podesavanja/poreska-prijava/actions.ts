"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { saveTaxAccountSettings } from "@/lib/corporate-tax-accounts-service";
import { defaultTaxAccountRules } from "@/lib/corporate-tax-accounts";
import { CorporateTaxError } from "@/lib/corporate-tax";
const base = "/agencija/zavrsni-racun/podesavanja/poreska-prijava";
export async function saveTaxAccounts(form: FormData) {
  try {
    await saveTaxAccountSettings({ agencyId: String(form.get("agencyId") ?? ""), revision: Number(form.get("revision")),
      rules: defaultTaxAccountRules().map(rule => ({ key: rule.key, accounts: form.get(`accounts:${rule.key}`), exclude: form.get(`exclude:${rule.key}`), side: form.get(`side:${rule.key}`) })) });
  } catch (error) {
    redirect(`${base}?greska=${encodeURIComponent(error instanceof CorporateTaxError ? error.message : "Podešavanja nijesu sačuvana. Pokušajte ponovo.")}`);
  }
  revalidatePath(base);
  revalidatePath("/agencija/zavrsni-racun/porez-na-dobit");
  redirect(`${base}?sacuvano=1`);
}
