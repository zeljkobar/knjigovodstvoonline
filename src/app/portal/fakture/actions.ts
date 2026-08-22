"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  requireDirectPortalContext,
  type ReadyDirectPortalContext
} from "@/lib/direct-portal";
import { hasDirectPortalPermission } from "@/lib/direct-portal-policy";
import {
  createOutgoingInvoiceDraft,
  fiscalizeOutgoingInvoiceDocument,
  OutgoingInvoiceServiceError,
  saveOutgoingInvoiceDraft,
  updateOutgoingInvoiceDraftHeader
} from "@/lib/outgoing-invoice-service";

function text(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

function detail(id: string, message: string): never {
  redirect(`/portal/fakture/${id}?poruka=${message}`);
}

function serviceContext(context: ReadyDirectPortalContext) {
  return {
    agencijaId: context.user.agencija_id!,
    firmaId: context.firma.id,
    poslovnaGodinaId: context.year.id,
    userId: context.user.id,
    userName: context.user.korisnicko_ime
  };
}

async function mutationContext(returnTo: string) {
  const context = await requireDirectPortalContext(
    { modul: "robno", akcija: "create" },
    returnTo
  );
  if (context.readiness.blocksChanges) {
    redirect(`${returnTo}?poruka=podesavanje`);
  }
  if (context.year.zakljucena) {
    redirect(`${returnTo}?poruka=zakljucana`);
  }
  return context;
}

function serviceErrorCode(error: unknown) {
  return error instanceof OutgoingInvoiceServiceError
    ? error.redirectCode
    : null;
}

function revalidateInvoice(invoiceId: string) {
  revalidatePath("/portal");
  revalidatePath("/portal/fakture");
  revalidatePath(`/portal/fakture/${invoiceId}`);
  revalidatePath("/portal/racuni");
  revalidatePath(`/portal/racuni/${invoiceId}`);
}

export async function createPortalOutgoingInvoice(formData: FormData) {
  const returnTo = "/portal/fakture/nova";
  const context = await mutationContext(returnTo);
  try {
    const result = await createOutgoingInvoiceDraft({
      context: serviceContext(context),
      formData,
      options: { accountingMode: "FISCAL_ONLY", partnerAccess: "DIRECT" }
    });
    revalidateInvoice(result.invoiceId);
    redirect(`/portal/fakture/${result.invoiceId}?poruka=kreirana`);
  } catch (error) {
    const code = serviceErrorCode(error);
    if (code) redirect(`${returnTo}?poruka=${code}`);
    throw error;
  }
}

export async function savePortalOutgoingInvoiceDraft(formData: FormData) {
  const invoiceId = text(formData.get("faktura_id"));
  const returnTo = invoiceId ? `/portal/fakture/${invoiceId}` : "/portal/fakture";
  const context = await mutationContext(returnTo);
  try {
    await saveOutgoingInvoiceDraft({
      context: serviceContext(context),
      formData,
      options: { accountingMode: "FISCAL_ONLY", partnerAccess: "DIRECT" }
    });
  } catch (error) {
    const code = serviceErrorCode(error);
    if (code) detail(invoiceId, code);
    throw error;
  }
  revalidateInvoice(invoiceId);
  detail(invoiceId, "sacuvana");
}

export async function updatePortalOutgoingInvoiceHeader(formData: FormData) {
  const invoiceId = text(formData.get("faktura_id"));
  const returnTo = invoiceId ? `/portal/fakture/${invoiceId}` : "/portal/fakture";
  const context = await mutationContext(returnTo);
  try {
    await updateOutgoingInvoiceDraftHeader({
      context: serviceContext(context),
      formData,
      options: { accountingMode: "FISCAL_ONLY", partnerAccess: "DIRECT" }
    });
  } catch (error) {
    const code = serviceErrorCode(error);
    if (code) detail(invoiceId, code);
    throw error;
  }
  revalidateInvoice(invoiceId);
  detail(invoiceId, "zaglavlje");
}

export async function fiscalizePortalOutgoingInvoice(formData: FormData) {
  const invoiceId = text(formData.get("faktura_id"));
  const returnTo = invoiceId ? `/portal/fakture/${invoiceId}` : "/portal/fakture";
  const context = await mutationContext(returnTo);
  if (
    !hasDirectPortalPermission(context.permissionKeys, {
      modul: "fiskalizacija",
      akcija: "post"
    })
  ) {
    detail(invoiceId, "prava");
  }

  try {
    const result = await fiscalizeOutgoingInvoiceDocument({
      context: serviceContext(context),
      formData,
      options: { accountingMode: "FISCAL_ONLY", partnerAccess: "DIRECT" }
    });
    revalidateInvoice(invoiceId);
    if (result.status === "pending") {
      detail(invoiceId, "fiskalizacija_u_toku");
    }
    if (result.status === "failed") {
      detail(invoiceId, "fiskalizacija_greska");
    }
    detail(invoiceId, "fiskalizovana");
  } catch (error) {
    const code = serviceErrorCode(error);
    if (code) detail(invoiceId, code);
    throw error;
  }
}
