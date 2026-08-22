"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import {
  createAndFiscalizePosSale,
  PosSaleValidationError,
  retryPosFiscalization
} from "@/lib/pos-sale-service";
import {
  createAndFiscalizePosStorno,
  PosStornoError
} from "@/lib/pos-storno-service";

export async function createAndFiscalizePortalPosSale(formData: FormData) {
  const context = await requireDirectPortalContext(
    { modul: "pos", akcija: "create" },
    "/portal/pos"
  );

  if (context.readiness.blocksChanges) {
    redirect("/portal/pos?poruka=podesavanje");
  }

  let result;

  try {
    result = await createAndFiscalizePosSale({
      context: {
        agencijaId: context.user.agencija_id!,
        firmaId: context.firma.id,
        poslovnaGodinaId: context.year.id,
        userId: context.user.id,
        userName: context.user.korisnicko_ime
      },
      formData,
      accountingMode: "FISCAL_ONLY",
      partnerAccess: "DIRECT"
    });
  } catch (error) {
    if (error instanceof PosSaleValidationError) {
      redirect(`/portal/pos?poruka=${error.code}`);
    }
    throw error;
  }

  if (result.status === "fiscalized") {
    redirect(`/portal/pos?uspjeh=${result.invoiceId}`);
  }

  if (result.status === "pending") {
    redirect(`/portal/pos?poruka=u_toku&racun=${result.invoiceId}`);
  }

  redirect(`/portal/pos?greska=${result.invoiceId}`);
}

export async function createPortalPosStorno(formData: FormData) {
  const originalId = String(formData.get("invoice_id") ?? "").trim();
  const returnTo = `/portal/racuni/${originalId}/storno`;
  const context = await requireDirectPortalContext(
    { modul: "fiskalizacija", akcija: "cancel" },
    returnTo
  );
  if (context.readiness.blocksChanges || context.year.zakljucena) redirect(`${returnTo}?poruka=podesavanje`);
  try {
    const result = await createAndFiscalizePosStorno({
      context: { agencijaId: context.user.agencija_id!, firmaId: context.firma.id, poslovnaGodinaId: context.year.id, year: context.year.godina, userId: context.user.id, userName: context.user.korisnicko_ime },
      originalInvoiceId: originalId,
      reason: String(formData.get("reason") ?? "").trim(),
      confirmed: String(formData.get("confirmation") ?? "") === "CONFIRM",
      accountingMode: "FISCAL_ONLY"
    });
    revalidatePath("/portal");
    revalidatePath("/portal/racuni");
    revalidatePath(`/portal/racuni/${originalId}`);
    if (result.status === "failed") redirect(`/portal/racuni/${result.correctionInvoiceId}?storno=failed`);
    redirect(`/portal/racuni/${result.correctionInvoiceId}?storno=fiscalized`);
  } catch (error) {
    if (error instanceof PosStornoError) redirect(`${returnTo}?poruka=${error.code}`);
    throw error;
  }
}

export async function retryPortalPosFiscalization(formData: FormData) {
  const invoiceId = String(formData.get("invoice_id") ?? "").trim();
  const returnTo = invoiceId ? `/portal/racuni/${invoiceId}` : "/portal/racuni";
  const context = await requireDirectPortalContext(
    { modul: "pos", akcija: "create" },
    returnTo
  );
  if (context.readiness.blocksChanges || context.year.zakljucena) {
    redirect(`${returnTo}?retry=podesavanje`);
  }

  try {
    const result = await retryPosFiscalization({
      context: {
        agencijaId: context.user.agencija_id!,
        firmaId: context.firma.id,
        poslovnaGodinaId: context.year.id,
        userId: context.user.id,
        userName: context.user.korisnicko_ime
      },
      invoiceId,
      accountingMode: "FISCAL_ONLY"
    });
    revalidatePath("/portal");
    revalidatePath("/portal/racuni");
    revalidatePath(returnTo);
    redirect(`${returnTo}?retry=${result.status}`);
  } catch (error) {
    if (error instanceof PosSaleValidationError) {
      redirect(`${returnTo}?retry=${error.code}`);
    }
    throw error;
  }
}
