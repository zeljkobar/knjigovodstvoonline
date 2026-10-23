import "server-only";
import { readAdvanceSettlementTaxes } from "./advance-invoice-posting";
import { materializeAdvanceSettlement, finishAdvanceAccounting } from "./advance-invoice-accounting";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { fiscalAdminApi, FiscalAdminApiError, type FiscalInvoice } from "./fiscal-admin-api";
import { auditLogInTransaction } from "./audit";
import { AdvanceWorkflowError, advanceAmount, settlementState, type AdvanceSettlement } from "./advance-invoice";
import { decimalToScaled } from "./inventory-calculation";
import type { OutgoingInvoiceServiceContext } from "./outgoing-invoice-service";

export const advanceScope = (ctx: OutgoingInvoiceServiceContext) => ({ agencija_id: ctx.agencijaId, firma_id: ctx.firmaId, is_deleted: false });
const actor = (ctx: OutgoingInvoiceServiceContext) => ({ id: ctx.userId, name: ctx.userName });
const lock = (tx: Prisma.TransactionClient, id: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`outgoing-invoice:${id}`}))`;
function fail(message: string): never { throw new AdvanceWorkflowError(message); }
export async function requireAdvanceOpenPeriod(tx: Prisma.TransactionClient, ctx: OutgoingInvoiceServiceContext, date: Date) {
  const year = await tx.poslovnaGodina.findFirst({ where: { id: ctx.poslovnaGodinaId, firma_id: ctx.firmaId, firma: { agencija_id: ctx.agencijaId, aktivan: true, is_deleted: false } } });
  if (!year || year.zakljucena || date < year.datum_od || date > year.datum_do) fail("Poslovna godina je zaključana ili datum nije u aktivnoj godini.");
  const period = await tx.pdvPeriod.findFirst({ where: { firma_id: ctx.firmaId, poslovna_godina_id: year.id, mjesec: date.getUTCMonth() + 1 } });
  if (period?.status === "LOCKED") fail("PDV period je zaključan.");
}
export async function setInvoiceAdvance(ctx: OutgoingInvoiceServiceContext, id: string, sourceId: string, amount: string) {
  const applied = sourceId ? advanceAmount(amount) : "0.00";
  return prisma.$transaction(async tx => {
    await lock(tx, id);
    const invoice = await tx.fiskalniIzlazniRacun.findFirst({ where: { id, ...advanceScope(ctx), poslovna_godina_id: ctx.poslovnaGodinaId, document_type: "INVOICE", sales_channel: "OFFICE" } });
    if (!invoice || invoice.vrsta_racuna === "ADVANCE" || invoice.status !== "DRAFT" || invoice.fiscal_api_invoice_id || !["DRAFT", "NOT_REQUIRED"].includes(invoice.fiscal_status)) fail("Avans se bira samo na neposlatom nacrtu konačnog računa.");
    await requireAdvanceOpenPeriod(tx, ctx, invoice.datum_racuna);
    if (sourceId && !/^[0-9a-f-]{36}$/i.test(sourceId)) fail("Izabrani avans nije ispravan.");
    if (sourceId) {
      const source = await tx.fiskalniIzlazniRacun.findFirst({ where: { id: sourceId, ...advanceScope(ctx), vrsta_racuna: "ADVANCE", document_type: "INVOICE", fiscal_status: "Fiscalized", kupac_id: invoice.kupac_id, valuta: invoice.valuta } });
      if (!source?.fiscal_api_invoice_id || invoice.datum_racuna < source.datum_racuna || decimalToScaled(applied, 2) <= BigInt(0) || decimalToScaled(applied, 2) > decimalToScaled(invoice.ukupno_sa_pdv, 2) || decimalToScaled(applied, 2) > decimalToScaled(source.ukupno_sa_pdv, 2)) fail("Izaberite fiskalizovani avans istog kupca i iznos do ukupne vrijednosti računa.");
    }
    await tx.fiskalniIzlazniRacun.update({ where: { id }, data: { avansni_racun_id: sourceId || null, iznos_avansa: applied, nacin_placanja: "BANK_TRANSFER", updated_by: ctx.userId } });
    await auditLogInTransaction(tx, { korisnikId: ctx.userId, agencijaId: ctx.agencijaId, firmaId: ctx.firmaId, modul: "fiskalizacija", akcija: "set_invoice_advance", tipEntiteta: "FiskalniIzlazniRacun", entitetId: id, novaVrijednost: { sourceId, amount: applied } });
  });
}
export async function loadAdvanceSource(ctx: OutgoingInvoiceServiceContext, sourceId: string) {
  const source = await prisma.fiskalniIzlazniRacun.findFirst({ where: { id: sourceId, ...advanceScope(ctx), vrsta_racuna: "ADVANCE", document_type: "INVOICE", fiscal_status: "Fiscalized" } });
  if (!source?.fiscal_api_invoice_id) fail("Avans nije dostupan ili nije fiskalizovan.");
  return source;
}
export async function validateAdvanceForFiscalization(ctx: OutgoingInvoiceServiceContext, invoice: { avansni_racun_id: string | null; kupac_id: string; valuta: string; datum_racuna: Date; iznos_avansa: {toString(): string}; fiscal_environment: string | null }) {
  if (!invoice.avansni_racun_id) return null;
  const source = await loadAdvanceSource(ctx, invoice.avansni_racun_id);
  if (source.kupac_id !== invoice.kupac_id || source.valuta !== invoice.valuta || source.datum_racuna > invoice.datum_racuna || (invoice.fiscal_environment && source.fiscal_environment !== invoice.fiscal_environment)) fail("Avans i račun moraju imati istog kupca, valutu i fiskalno okruženje, uz ispravan datum.");
  return source;
}
export async function prepareAdvanceSettlement(ctx: OutgoingInvoiceServiceContext, id: string, form: FormData) {
  const invoice = await prisma.fiskalniIzlazniRacun.findFirst({ where: { id, ...advanceScope(ctx), poslovna_godina_id: ctx.poslovnaGodinaId } });
  if (!invoice?.avansni_racun_id || invoice.fiscal_status !== "Fiscalized" || !invoice.fiscal_api_invoice_id) fail("Prvo fiskalizujte konačni račun sa avansom.");
  const source = await loadAdvanceSource(ctx, invoice.avansni_racun_id);
  const remote = (await fiscalAdminApi.getInvoice(source.fiscal_api_invoice_id!, actor(ctx))).data;
  const items = (remote.items ?? []) as Array<{id: string}>;
  const allocations = items.map(item => ({ advanceItemId: item.id, grossAmount: Number(advanceAmount(String(form.get(`allocation_${item.id}`) ?? "0"))) })).filter(item => item.grossAmount > 0);
  const sum = allocations.reduce((total, item) => total + decimalToScaled(String(item.grossAmount), 2), BigInt(0));
  if (sum !== decimalToScaled(invoice.iznos_avansa, 2)) fail("Zbir raspodjele mora odgovarati iskorišćenom avansu.");
  return prisma.$transaction(async tx => {
    await lock(tx, id);
    const current = await tx.fiskalniIzlazniRacun.findFirstOrThrow({ where: { id, ...advanceScope(ctx) } });
    if (current.fiscal_status !== "Fiscalized") fail("Konačni račun nije fiskalizovan.");
    const previous = settlementState(current.avans_umanjenje);
    if (previous && previous.status !== "AllocationInvalid") return;
    const now = new Date();
    await requireAdvanceOpenPeriod(tx, ctx, new Date(now.toLocaleDateString("en-CA", {timeZone:"Europe/Podgorica"}) + "T00:00:00Z"));
    const state: AdvanceSettlement = { key: `website:advance-settlement:${ctx.firmaId}:${id}${previous ? ":"+randomUUID() : ""}`, issueDateTime: now.toISOString(), allocations, status: "Prepared" };
    await tx.fiskalniIzlazniRacun.update({ where: { id }, data: { avans_umanjenje: state as unknown as Prisma.InputJsonValue } });
    await auditLogInTransaction(tx, { korisnikId: ctx.userId, agencijaId: ctx.agencijaId, firmaId: ctx.firmaId, modul: "fiskalizacija", akcija: "prepare_advance_settlement", tipEntiteta: "FiskalniIzlazniRacun", entitetId: id, novaVrijednost: state });
  });
}
export async function sendAdvanceSettlement(ctx: OutgoingInvoiceServiceContext, id: string, confirmation: string, version: string, accounting = false) {
  const claimed = await prisma.$transaction(async tx => {
    await lock(tx, id);
    const invoice = await tx.fiskalniIzlazniRacun.findFirst({ where: { id, ...advanceScope(ctx), poslovna_godina_id: ctx.poslovnaGodinaId }, include: { firma: { select: { pib: true, fiscalCompanyLink: true } } } });
    const state = settlementState(invoice?.avans_umanjenje);
    if (!invoice || !state || invoice.fiscal_status !== "Fiscalized" || invoice.updated_at.toISOString() !== version) fail("Pregledajte ponovo konačni račun i umanjenje.");
    await requireAdvanceOpenPeriod(tx, ctx, new Date(new Date().toLocaleDateString("en-CA", {timeZone:"Europe/Podgorica"}) + "T00:00:00Z"));
    const link = invoice.firma.fiscalCompanyLink;
    if (!link?.fiscal_api_company_id || link.is_suspended || link.fiscal_environment !== invoice.fiscal_environment) fail("Fiskalna konfiguracija nije dostupna ili je promijenjena.");
    if (confirmation !== `SETTLE_ADVANCE:${invoice.fiscal_environment}:${id}`) fail("Potvrdite slanje umanjenja.");
    if (state.status === "Fiscalized") return { invoice, state, done: true };
    if (state.claimedAt && Date.now() - new Date(state.claimedAt).getTime() < 120000) fail("Umanjenje je u obradi. Osvježite pregled.");
    const next = { ...state, claimedAt: new Date().toISOString() };
    await tx.fiskalniIzlazniRacun.update({ where: { id }, data: { avans_umanjenje: next as unknown as Prisma.InputJsonValue } });
    return { invoice, state: next, done: false };
  });
  if (claimed.done) { await reconcileAdvanceSettlement(ctx,id,accounting); return; }
  let state = claimed.state;
  try {
    const source = await loadAdvanceSource(ctx, claimed.invoice.avansni_racun_id!);
    let remote: FiscalInvoice;
    if (state.remoteId) remote = (await fiscalAdminApi.getInvoice(state.remoteId, actor(ctx))).data;
    else {
      remote = (await fiscalAdminApi.createAdvanceSettlement(source.fiscal_api_invoice_id!, { finalInvoiceId: claimed.invoice.fiscal_api_invoice_id, issueDateTime: state.issueDateTime, allocations: state.allocations, confirmation: `CREATE_ADVANCE_SETTLEMENT:${source.fiscal_api_invoice_id}:${claimed.invoice.fiscal_api_invoice_id}` }, state.key, actor(ctx))).data;
      state = { ...state, remoteId: remote.id, status: remote.status };
      await storeSettlement(ctx, id, state);
    }
    if (decimalToScaled(String(remote.totalGrossAmount), 2) !== -decimalToScaled(claimed.invoice.iznos_avansa, 2)) fail("Iznos umanjenja ne odgovara iskorišćenom avansu.");
    if (remote.companyId && remote.companyId !== claimed.invoice.firma.fiscalCompanyLink?.fiscal_api_company_id) fail("Umanjenje ne pripada izabranoj firmi.");
    // Creation and fiscalization are separate: the first call only prepares the remote draft for review.
    if (!claimed.state.remoteId) { await storeSettlement(ctx, id, { ...state, claimedAt: undefined }); return; }
    if (remote.status !== "Fiscalized") {
      const confirm = claimed.invoice.fiscal_environment === "Production" ? `FISCALIZE_PRODUCTION:${claimed.invoice.firma.pib}:${remote.id}` : `FISCALIZE_TEST:${remote.id}`;
      await fiscalAdminApi.fiscalizeInvoice(remote.id, confirm, actor(ctx));
      remote = (await fiscalAdminApi.getInvoice(remote.id, actor(ctx))).data;
    }
    if (remote.status !== "Fiscalized" || !remote.iic || !remote.jikr || !remote.qrCodeData) fail("Umanjenje još nije potvrđeno. Nastavite isti dokument nakon provjere statusa.");
    await storeSettlement(ctx, id, { ...state, status: remote.status, officialInvoiceNumber: remote.officialInvoiceNumber, iic: remote.iic, jikr: remote.jikr, qrCodeData: remote.qrCodeData, error: undefined, claimedAt: undefined });
    await reconcileAdvanceSettlement(ctx,id,accounting,remote);
  } catch (e) {
    await storeSettlement(ctx, id, { ...state, ...(e instanceof FiscalAdminApiError && e.status === 400 && e.code === "ADVANCE_TAX_ALLOCATION_INVALID" && !state.remoteId ? {status:"AllocationInvalid"} : {}), error: e instanceof FiscalAdminApiError ? e.code : "Umanjenje nije završeno; provjerite isti dokument.", claimedAt: undefined });
    throw e;
  }
}
async function storeSettlement(ctx: OutgoingInvoiceServiceContext, id: string, state: AdvanceSettlement) {
  await prisma.$transaction(async tx => {
    await lock(tx, id);
    const current = await tx.fiskalniIzlazniRacun.findFirst({ where: { id, ...advanceScope(ctx) }, select: { avans_umanjenje: true } });
    const saved = settlementState(current?.avans_umanjenje);
    if (!saved || saved.key !== state.key) fail("Umanjenje je u međuvremenu izmijenjeno. Osvježite pregled.");
    if (saved.status === "Fiscalized" && state.status !== "Fiscalized") return;
    await tx.fiskalniIzlazniRacun.update({ where: { id }, data: { avans_umanjenje: JSON.parse(JSON.stringify(state)) as Prisma.InputJsonValue } });
    await auditLogInTransaction(tx, { korisnikId: ctx.userId, agencijaId: ctx.agencijaId, firmaId: ctx.firmaId, modul: "fiskalizacija", akcija: "advance_settlement_status", tipEntiteta: "FiskalniIzlazniRacun", entitetId: id, novaVrijednost: JSON.parse(JSON.stringify(state)) });
  });
}

// A single source line has an unambiguous allocation. Prepare the negative draft
// automatically after final fiscalization; sending still requires its own review.
export async function autoPrepareAdvanceSettlement(ctx: OutgoingInvoiceServiceContext, id: string) {
  const invoice=await prisma.fiskalniIzlazniRacun.findFirst({where:{id,...advanceScope(ctx)}});
  if (!invoice?.avansni_racun_id || invoice.avans_umanjenje || invoice.fiscal_status!=="Fiscalized") return;
  const source=await loadAdvanceSource(ctx,invoice.avansni_racun_id);
  const remote=(await fiscalAdminApi.getInvoice(source.fiscal_api_invoice_id!,actor(ctx))).data;
  const items=(remote.items??[]) as Array<{id:string}>;
  if (items.length!==1) return;
  const form=new FormData();form.set(`allocation_${items[0].id}`,invoice.iznos_avansa.toString());
  await prepareAdvanceSettlement(ctx,id,form);
  await createSettlementDraftForReview(ctx,id);
}

export async function createSettlementDraftForReview(ctx: OutgoingInvoiceServiceContext, id: string) {
  const invoice=await prisma.fiskalniIzlazniRacun.findFirst({where:{id,...advanceScope(ctx)}});
  const state=settlementState(invoice?.avans_umanjenje);
  if (!invoice || !state || state.remoteId) return;
  // A version check under the invoice lock prevents this preparation-only call
  // from becoming a send if another request has already created the document.
  await sendAdvanceSettlement(ctx,id,`SETTLE_ADVANCE:${invoice.fiscal_environment}:${id}`,invoice.updated_at.toISOString());
}

// This continuation only reads the confirmed remote document; it never sends PU.
export async function reconcileAdvanceSettlement(ctx:OutgoingInvoiceServiceContext,id:string,accounting:boolean,confirmed?:FiscalInvoice) {
  const final=await prisma.fiskalniIzlazniRacun.findFirst({where:{id,...advanceScope(ctx)}});
  const state=settlementState(final?.avans_umanjenje);
  if(!final||!state?.remoteId||state.status!=="Fiscalized") fail("Umanjenje nije potvrđeno za knjiženje.");
  try {
    let snapshot=state.accountingSnapshot;
    if(!snapshot) {
      const source=await loadAdvanceSource(ctx,final.avansni_racun_id!);
      const sourceRemote=(await fiscalAdminApi.getInvoice(source.fiscal_api_invoice_id!,actor(ctx))).data;
      const rows=(sourceRemote.items??[]) as Array<{id:string;vatRate:number}>;
      const used=new Set(state.allocations.map(a=>a.advanceItemId));
      const rates=rows.filter(r=>used.has(r.id)).map(r=>scaledRate(r.vatRate));
      const remote=confirmed??(await fiscalAdminApi.getInvoice(state.remoteId,actor(ctx))).data;
      if(remote.status!=="Fiscalized"||remote.iic!==state.iic||remote.jikr!==state.jikr)fail("Fiskalni rezultat umanjenja nije usklađen.");
      snapshot=readAdvanceSettlementTaxes(remote,rates,state.issueDateTime);
      await storeSettlement(ctx,id,{...state,accountingSnapshot:snapshot});
    }
    const localId=await materializeAdvanceSettlement(ctx,id,snapshot);
    if(accounting) await finishAdvanceAccounting(ctx,localId);
    const current=await prisma.fiskalniIzlazniRacun.findFirstOrThrow({where:{id,...advanceScope(ctx)}});
    await storeSettlement(ctx,id,{...settlementState(current.avans_umanjenje)!,localInvoiceId:localId,accountingError:undefined});
    return localId;
  } catch(error) {
    const message=error instanceof AdvanceWorkflowError?error.message:error instanceof Error&&/pores|razrad|Fiscal API mora/i.test(error.message)?error.message:"Fiskalizacija je potvrđena; lokalno knjiženje zahtijeva nastavak.";
    const current=await prisma.fiskalniIzlazniRacun.findFirstOrThrow({where:{id,...advanceScope(ctx)}});
    await storeSettlement(ctx,id,{...settlementState(current.avans_umanjenje)!,accountingError:message});
    throw new AdvanceWorkflowError(message);
  }
}
function scaledRate(value:number) {return (Number(value)).toFixed(2);}
