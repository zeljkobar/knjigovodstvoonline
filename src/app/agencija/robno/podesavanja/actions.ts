"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auditLog, auditLogInTransaction } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { accountOverrideTypes } from "@/lib/account-plan";
import {
  calculationPostingFields,
  calculationPostingScope
} from "@/lib/inventory-calculation";
import { inventoryModule } from "@/lib/inventory";
import {
  inventoryCountPostingFields,
  inventoryCountPostingScope
} from "@/lib/inventory-count";
import { advanceInvoicePostingFields, advanceInvoicePostingScope, advanceInvoiceRatePurposes } from "@/lib/advance-invoice-posting";
import { outgoingInvoicePostingFields, outgoingInvoicePostingScope } from "@/lib/outgoing-invoice";
import {
  inventoryTransferPostingFields,
  inventoryTransferPostingScope
} from "@/lib/inventory-transfer";
import {
  inventoryWriteOffPostingFields,
  inventoryWriteOffPostingScope
} from "@/lib/inventory-write-off";
import {
  inventoryPriceAdjustmentPostingFields,
  inventoryPriceAdjustmentPostingScope
} from "@/lib/inventory-price-adjustment";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { supplierReturnFields, supplierReturnScope, SupplierReturnError, returnFail } from "@/lib/supplier-return";
import { guardReturn } from "@/lib/supplier-return-service";
import { templateAccount } from "@/lib/posting-template";
import { readWorkContext } from "@/lib/work-context";
import { getInventoryContext } from "../_shared";

function text(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

export async function saveSupplierReturnSettings(formData: FormData) {
  await requireRole("admin_agencije");
  const context = await getInventoryContext("manage");
  const work = await readWorkContext();
  const path = "/agencija/robno/podesavanja";
  if (!context.allowed || !context.firma || context.firma.id !== text(formData.get("firma_id")) || !work.poslovnaGodinaId || !context.user.agencija_id) redirect(`${path}?poruka=prava`);
  try {
    await prisma.$transaction(async tx => {
      const c = { userId: context.user.id, agencyId: context.user.agencija_id!, companyId: context.firma!.id, yearId: work.poslovnaGodinaId! };
      await guardReturn(tx, c, "manage");
      const scope = { firma_id: c.companyId, dokument_tip: supplierReturnScope.documentType, podvrsta: supplierReturnScope.subtype, pdv_stopa_sifra: "GENERAL" };
      const previous = await tx.firmaPodrazumijevanoKonto.findMany({ where: scope });
      for (const field of supplierReturnFields) {
        const code = text(formData.get(`konto_${field.purpose}`));
        if (code) {
          const account = await templateAccount(tx, c.companyId, code);
          if (!account || !account.aktivan || account.override_type === "DEACTIVATED" || account.tip_konta !== "analiticko" || code.length < 4 || (field.purpose !== "RETURN_SUPPLIER" && account.analitika_obavezna) || (field.purpose === "RETURN_LOSS" && !code.startsWith("5")) || (field.purpose === "RETURN_GAIN" && !code.startsWith("6"))) returnFail("Izaberite dostupna analitička konta povrata; trošak klasa 5, prihod klasa 6. Samo dobavljačko konto može tražiti partnera.");
        }
        const key = { ...scope, namjena: field.purpose };
        await tx.firmaPodrazumijevanoKonto.upsert({ where: { firma_id_namjena_dokument_tip_podvrsta_pdv_stopa_sifra: key }, create: { ...key, sifra_konta: code, smjer: field.direction, created_by: c.userId, updated_by: c.userId }, update: { sifra_konta: code, smjer: field.direction, updated_by: c.userId } });
      }
      await auditLogInTransaction(tx, { korisnikId: c.userId, agencijaId: c.agencyId, firmaId: c.companyId, modul: "robno", akcija: "save_supplier_return_settings", tipEntiteta: "FirmaPodrazumijevanoKonto", entitetId: c.companyId, staraVrijednost: previous, novaVrijednost: await tx.firmaPodrazumijevanoKonto.findMany({ where: scope }) });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof SupplierReturnError) redirect(`${path}?poruka=${encodeURIComponent(error.message)}`);
    throw error;
  }
  revalidatePath(path); redirect(`${path}?poruka=povrat_sacuvano`);
}

export async function saveCalculationPostingSettings(formData: FormData) {
  await requireRole("admin_agencije");
  const returnPath = "/agencija/robno/podesavanja";
  const context = await getInventoryContext("manage");
  const firmaId = text(formData.get("firma_id"));
  if (!context.allowed || !context.firma || !context.user.agencija_id || context.firma.id !== firmaId) redirect(`${returnPath}?poruka=prava`);
  let entries: Array<{namjena:string;pdv_stopa_sifra:string;sifra_konta:string;smjer:string}>;
  try {
    const parsed: unknown = JSON.parse(text(formData.get("calculation_rules")));
    if (!Array.isArray(parsed) || parsed.length>100 || parsed.some(r=>!r || ["namjena","pdv_stopa_sifra","sifra_konta","smjer"].some(k=>typeof r[k]!=="string"))) throw new Error("rules");
    entries = parsed;
  } catch { redirect(`${returnPath}?poruka=neispravna_konta`); }
  const rates = await prisma.pdvStopa.findMany({where:{agencija_id:context.user.agencija_id},select:{sifra:true}});
  const allowedRates=new Set(["GENERAL",...rates.map(r=>r.sifra)]);
  const purposes=new Set<string>(calculationPostingFields.map(f=>f.purpose));
  const keys=new Set<string>();
  for (const entry of entries) {
    const key=`${entry.namjena}:${entry.pdv_stopa_sifra}`;
    if (!purposes.has(entry.namjena) || !allowedRates.has(entry.pdv_stopa_sifra) || keys.has(key) ||
      !["D","P"].includes(entry.smjer)) redirect(`${returnPath}?poruka=neispravna_konta`);
    keys.add(key);
  }
  const codes=[...new Set(entries.map(r=>r.sifra_konta).filter(Boolean))];
  const [base,company]=await Promise.all([
    prisma.konto.findMany({where:{sifra:{in:codes},tip_konta:"analiticko",aktivan:true},select:{sifra:true}}),
    prisma.firmaKonto.findMany({where:{firma_id:firmaId,sifra:{in:codes}},select:{sifra:true,aktivan:true,tip_konta:true,override_type:true}})
  ]);
  const valid=new Set(base.map(r=>r.sifra));
  for(const row of company) {if(row.aktivan && row.tip_konta==="analiticko" && row.override_type!==accountOverrideTypes.deactivated)valid.add(row.sifra);else valid.delete(row.sifra);}
  if(entries.some(r=>r.sifra_konta && (r.sifra_konta.length<4 || !valid.has(r.sifra_konta))))redirect(`${returnPath}?poruka=neispravna_konta`);
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM firme WHERE id=${firmaId}::uuid FOR UPDATE`;
    const scope={firma_id:firmaId,dokument_tip:calculationPostingScope.documentType,podvrsta:calculationPostingScope.subtype};
    const previous=await tx.firmaPodrazumijevanoKonto.findMany({where:scope});
    await tx.firmaPodrazumijevanoKonto.deleteMany({where:scope});
    await tx.firmaPodrazumijevanoKonto.createMany({data:entries.map(entry=>({...scope,...entry,created_by:context.user.id,updated_by:context.user.id}))});
    await auditLogInTransaction(tx,{korisnikId:context.user.id,agencijaId:context.user.agencija_id!,firmaId,modul:inventoryModule,akcija:"save_calculation_posting_settings",tipEntiteta:"FirmaPodrazumijevanoKonto",entitetId:firmaId,staraVrijednost:previous,novaVrijednost:entries});
  });
  revalidatePath(returnPath); redirect(`${returnPath}?poruka=sacuvano`);
}


export async function saveOutgoingInvoicePostingSettings(formData: FormData) {
  return saveSalesPostingSettings(formData, false);
}

export async function saveAdvanceInvoicePostingSettings(formData: FormData) {
  return saveSalesPostingSettings(formData, true);
}

async function saveSalesPostingSettings(formData: FormData, advance: boolean) {
  await requireRole("admin_agencije");
  const returnPath = "/agencija/robno/podesavanja";
  const context = await getInventoryContext("manage");
  const firmaId = text(formData.get("firma_id"));
  if (!context.allowed || !context.firma || !context.user.agencija_id || context.firma.id !== firmaId) redirect(`${returnPath}?poruka=prava`);
  let entries: Array<{namjena:string;pdv_stopa_sifra:string;sifra_konta:string;smjer:string}>;
  try {
    const parsed: unknown = JSON.parse(text(formData.get(advance ? "advance_rules" : "invoice_rules")));
    if (!Array.isArray(parsed) || parsed.length>100 || parsed.some(r=>!r || ["namjena","pdv_stopa_sifra","sifra_konta","smjer"].some(k=>typeof r[k]!=="string"))) throw new Error("rules");
    entries = parsed.map(({namjena,pdv_stopa_sifra,sifra_konta,smjer}) => ({namjena,pdv_stopa_sifra,sifra_konta,smjer}));
  } catch { redirect(`${returnPath}?poruka=neispravna_konta`); }
  const postingScope = advance ? advanceInvoicePostingScope : outgoingInvoicePostingScope;
  const ratePurposes = advance ? advanceInvoiceRatePurposes : ["INVOICE_REVENUE", "INVOICE_OUTPUT_VAT"];
  const fields = advance ? advanceInvoicePostingFields : outgoingInvoicePostingFields;
  const rates = await prisma.pdvStopa.findMany({where:{agencija_id:context.user.agencija_id},select:{sifra:true}});
  const allowedRates=new Set(["GENERAL",...rates.map(r=>r.sifra)]);
  const purposes=new Set<string>(fields.map(f=>f.purpose));
  const keys=new Set<string>();
  for (const entry of entries) {
    const key=`${entry.namjena}:${entry.pdv_stopa_sifra}`;
    if (!purposes.has(entry.namjena) || !allowedRates.has(entry.pdv_stopa_sifra) || keys.has(key) ||
      (!ratePurposes.includes(entry.namjena) && entry.pdv_stopa_sifra!=="GENERAL") || !["D","P"].includes(entry.smjer)) redirect(`${returnPath}?poruka=neispravna_konta`);
    keys.add(key);
  }
  const codes=[...new Set(entries.map(r=>r.sifra_konta).filter(Boolean))];
  const [base,company]=await Promise.all([
    prisma.konto.findMany({where:{sifra:{in:codes},tip_konta:"analiticko",aktivan:true},select:{sifra:true}}),
    prisma.firmaKonto.findMany({where:{firma_id:firmaId,sifra:{in:codes}},select:{sifra:true,aktivan:true,tip_konta:true,override_type:true}})
  ]);
  const valid=new Set(base.map(r=>r.sifra));
  for(const row of company) {if(row.aktivan && row.tip_konta==="analiticko" && row.override_type!==accountOverrideTypes.deactivated)valid.add(row.sifra);else valid.delete(row.sifra);}
  if(entries.some(r=>r.sifra_konta && (r.sifra_konta.length<4 || !valid.has(r.sifra_konta))))redirect(`${returnPath}?poruka=neispravna_konta`);
  await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM firme WHERE id=${firmaId}::uuid FOR UPDATE`;
    const scope={firma_id:firmaId,dokument_tip:postingScope.documentType,podvrsta:postingScope.subtype};
    const previous=await tx.firmaPodrazumijevanoKonto.findMany({where:scope});
    await tx.firmaPodrazumijevanoKonto.deleteMany({where:scope});
    await tx.firmaPodrazumijevanoKonto.createMany({data:entries.map(entry=>({...scope,...entry,created_by:context.user.id,updated_by:context.user.id}))});
    await auditLogInTransaction(tx,{korisnikId:context.user.id,agencijaId:context.user.agencija_id!,firmaId,modul:inventoryModule,akcija:advance ? "save_advance_invoice_posting_settings" : "save_outgoing_invoice_posting_settings",tipEntiteta:"FirmaPodrazumijevanoKonto",entitetId:firmaId,staraVrijednost:previous,novaVrijednost:entries});
  });
  revalidatePath(returnPath); redirect(`${returnPath}?poruka=${advance ? "avans_sacuvano#avansni-racuni" : "faktura_sacuvano"}`);
}

export async function saveInventoryTransferPostingSettings(formData: FormData) {
  await requireRole("admin_agencije");
  const returnPath = "/agencija/robno/podesavanja";
  const context = await getInventoryContext("manage");
  const firmaId = text(formData.get("firma_id"));
  if (!context.allowed || !context.firma || !context.user.agencija_id || context.firma.id !== firmaId) redirect(`${returnPath}?poruka=prava`);
  const entries = inventoryTransferPostingFields.map((field) => ({ ...field, accountCode: text(formData.get(`konto_${field.purpose}`)), direction: text(formData.get(`smjer_${field.purpose}`)) }));
  const codes = [...new Set(entries.map((entry) => entry.accountCode).filter(Boolean))];
  const [base, company] = await Promise.all([
    prisma.konto.findMany({ where: { sifra: { in: codes }, tip_konta: "analiticko", analitika_obavezna: false, aktivan: true }, select: { sifra: true } }),
    prisma.firmaKonto.findMany({ where: { firma_id: firmaId, sifra: { in: codes }, tip_konta: "analiticko", analitika_obavezna: false, aktivan: true, override_type: { not: accountOverrideTypes.deactivated } }, select: { sifra: true } })
  ]);
  const valid = new Set([...base, ...company].map((item) => item.sifra));
  if (entries.some((entry) => !entry.accountCode || !valid.has(entry.accountCode)) || entries[0].direction !== "D" || entries[1].direction !== "P") redirect(`${returnPath}?poruka=neispravna_konta`);
  await prisma.$transaction(async (tx) => {
    for (const entry of entries) {
      const key = { firma_id: firmaId, namjena: entry.purpose, dokument_tip: inventoryTransferPostingScope.documentType, podvrsta: inventoryTransferPostingScope.subtype, pdv_stopa_sifra: inventoryTransferPostingScope.vatRate };
      await tx.firmaPodrazumijevanoKonto.upsert({ where: { firma_id_namjena_dokument_tip_podvrsta_pdv_stopa_sifra: key }, create: { ...key, sifra_konta: entry.accountCode, smjer: entry.direction, napomena: entry.description, created_by: context.user.id, updated_by: context.user.id }, update: { sifra_konta: entry.accountCode, smjer: entry.direction, napomena: entry.description, updated_by: context.user.id } });
    }
  });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.user.agencija_id, firmaId, modul: inventoryModule, akcija: "save_inventory_transfer_posting_settings", tipEntiteta: "FirmaPodrazumijevanoKonto", entitetId: firmaId, novaVrijednost: entries.map((entry) => ({ namjena: entry.purpose, konto: entry.accountCode, smjer: entry.direction })) });
  revalidatePath(returnPath);
  revalidatePath("/agencija/robno/prenos");
  redirect(`${returnPath}?poruka=prenos_sacuvano`);
}

export async function saveInventoryCountPostingSettings(formData: FormData) {
  await requireRole("admin_agencije");
  const returnPath = "/agencija/robno/podesavanja";
  const context = await getInventoryContext("manage");
  const firmaId = text(formData.get("firma_id"));
  if (!context.allowed || !context.firma || !context.user.agencija_id || context.firma.id !== firmaId) redirect(`${returnPath}?poruka=prava`);
  const entries = inventoryCountPostingFields.map((field) => ({ ...field, accountCode: text(formData.get(`konto_${field.purpose}`)), direction: text(formData.get(`smjer_${field.purpose}`)) }));
  const codes = [...new Set(entries.map((entry) => entry.accountCode).filter(Boolean))];
  const [base, company] = await Promise.all([
    prisma.konto.findMany({ where: { sifra: { in: codes }, tip_konta: "analiticko", analitika_obavezna: false, aktivan: true }, select: { sifra: true } }),
    prisma.firmaKonto.findMany({ where: { firma_id: firmaId, sifra: { in: codes }, tip_konta: "analiticko", analitika_obavezna: false, aktivan: true, override_type: { not: accountOverrideTypes.deactivated } }, select: { sifra: true } })
  ]);
  const valid = new Set([...base, ...company].map((item) => item.sifra));
  const directionsValid = entries.every((entry) => entry.direction === entry.defaultDirection);
  const accountClassesValid = entries.every((entry) => entry.purpose !== "STOCK_COUNT_SURPLUS_INCOME" || entry.accountCode.startsWith("6")) && entries.every((entry) => entry.purpose !== "STOCK_COUNT_SHORTAGE_EXPENSE" || entry.accountCode.startsWith("5"));
  if (entries.some((entry) => !entry.accountCode || !valid.has(entry.accountCode)) || !directionsValid || !accountClassesValid) redirect(`${returnPath}?poruka=neispravna_konta_popisa`);
  await prisma.$transaction(async (tx) => {
    for (const entry of entries) {
      const key = { firma_id: firmaId, namjena: entry.purpose, dokument_tip: inventoryCountPostingScope.documentType, podvrsta: inventoryCountPostingScope.subtype, pdv_stopa_sifra: inventoryCountPostingScope.vatRate };
      await tx.firmaPodrazumijevanoKonto.upsert({ where: { firma_id_namjena_dokument_tip_podvrsta_pdv_stopa_sifra: key }, create: { ...key, sifra_konta: entry.accountCode, smjer: entry.direction, napomena: entry.description, created_by: context.user.id, updated_by: context.user.id }, update: { sifra_konta: entry.accountCode, smjer: entry.direction, napomena: entry.description, updated_by: context.user.id } });
    }
  });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.user.agencija_id, firmaId, modul: inventoryModule, akcija: "save_inventory_count_posting_settings", tipEntiteta: "FirmaPodrazumijevanoKonto", entitetId: firmaId, novaVrijednost: entries.map((entry) => ({ namjena: entry.purpose, konto: entry.accountCode, smjer: entry.direction })) });
  revalidatePath(returnPath);
  revalidatePath("/agencija/robno/popis");
  redirect(`${returnPath}?poruka=popis_sacuvano`);
}

export async function saveInventoryWriteOffPostingSettings(formData: FormData) {
  await requireRole("admin_agencije");
  const returnPath = "/agencija/robno/podesavanja";
  const context = await getInventoryContext("manage");
  const firmaId = text(formData.get("firma_id"));
  if (!context.allowed || !context.firma || !context.user.agencija_id || context.firma.id !== firmaId) redirect(`${returnPath}?poruka=prava`);
  const entries = inventoryWriteOffPostingFields.map((field) => ({ ...field, accountCode: text(formData.get(`konto_${field.purpose}`)), direction: text(formData.get(`smjer_${field.purpose}`)) }));
  const codes = [...new Set(entries.map((entry) => entry.accountCode).filter(Boolean))];
  const [base, company] = await Promise.all([
    prisma.konto.findMany({ where: { sifra: { in: codes }, tip_konta: "analiticko", analitika_obavezna: false, aktivan: true }, select: { sifra: true } }),
    prisma.firmaKonto.findMany({ where: { firma_id: firmaId, sifra: { in: codes }, tip_konta: "analiticko", analitika_obavezna: false, aktivan: true, override_type: { not: accountOverrideTypes.deactivated } }, select: { sifra: true } })
  ]);
  const valid = new Set([...base, ...company].map((item) => item.sifra));
  const directionsValid = entries.every((entry) => entry.direction === entry.defaultDirection);
  const accountClassesValid = entries.every((entry) => entry.purpose !== "WRITE_OFF_EXPENSE" || entry.accountCode.startsWith("5"));
  if (entries.some((entry) => !entry.accountCode || !valid.has(entry.accountCode)) || !directionsValid || !accountClassesValid) redirect(`${returnPath}?poruka=neispravna_konta_otpisa`);
  await prisma.$transaction(async (tx) => {
    for (const entry of entries) {
      const key = { firma_id: firmaId, namjena: entry.purpose, dokument_tip: inventoryWriteOffPostingScope.documentType, podvrsta: inventoryWriteOffPostingScope.subtype, pdv_stopa_sifra: inventoryWriteOffPostingScope.vatRate };
      await tx.firmaPodrazumijevanoKonto.upsert({ where: { firma_id_namjena_dokument_tip_podvrsta_pdv_stopa_sifra: key }, create: { ...key, sifra_konta: entry.accountCode, smjer: entry.direction, napomena: entry.description, created_by: context.user.id, updated_by: context.user.id }, update: { sifra_konta: entry.accountCode, smjer: entry.direction, napomena: entry.description, updated_by: context.user.id } });
    }
  });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.user.agencija_id, firmaId, modul: inventoryModule, akcija: "save_inventory_write_off_posting_settings", tipEntiteta: "FirmaPodrazumijevanoKonto", entitetId: firmaId, novaVrijednost: entries.map((entry) => ({ namjena: entry.purpose, konto: entry.accountCode, smjer: entry.direction })) });
  revalidatePath(returnPath);
  revalidatePath("/agencija/robno/otpis");
  redirect(`${returnPath}?poruka=otpis_sacuvano`);
}

export async function saveInventoryPriceAdjustmentPostingSettings(formData: FormData) {
  await requireRole("admin_agencije");
  const returnPath = "/agencija/robno/podesavanja";
  const context = await getInventoryContext("manage");
  const firmaId = text(formData.get("firma_id"));
  if (!context.allowed || !context.firma || !context.user.agencija_id || context.firma.id !== firmaId) redirect(`${returnPath}?poruka=prava`);
  const entries = inventoryPriceAdjustmentPostingFields.map((field) => ({ ...field, accountCode: text(formData.get(`konto_${field.purpose}`)), direction: text(formData.get(`smjer_${field.purpose}`)) }));
  const codes = [...new Set(entries.map((entry) => entry.accountCode).filter(Boolean))];
  const [base, company] = await Promise.all([
    prisma.konto.findMany({ where: { sifra: { in: codes }, tip_konta: "analiticko", analitika_obavezna: false, aktivan: true }, select: { sifra: true } }),
    prisma.firmaKonto.findMany({ where: { firma_id: firmaId, sifra: { in: codes }, tip_konta: "analiticko", analitika_obavezna: false, aktivan: true, override_type: { not: accountOverrideTypes.deactivated } }, select: { sifra: true } })
  ]);
  const valid = new Set([...base, ...company].map((item) => item.sifra));
  const directionsValid = entries.every((entry) => entry.direction === entry.defaultDirection);
  if (entries.some((entry) => !entry.accountCode || !valid.has(entry.accountCode)) || !directionsValid) redirect(`${returnPath}?poruka=neispravna_konta_nivelacije`);
  await prisma.$transaction(async (tx) => {
    for (const entry of entries) {
      const key = { firma_id: firmaId, namjena: entry.purpose, dokument_tip: inventoryPriceAdjustmentPostingScope.documentType, podvrsta: inventoryPriceAdjustmentPostingScope.subtype, pdv_stopa_sifra: inventoryPriceAdjustmentPostingScope.vatRate };
      await tx.firmaPodrazumijevanoKonto.upsert({ where: { firma_id_namjena_dokument_tip_podvrsta_pdv_stopa_sifra: key }, create: { ...key, sifra_konta: entry.accountCode, smjer: entry.direction, napomena: entry.description, created_by: context.user.id, updated_by: context.user.id }, update: { sifra_konta: entry.accountCode, smjer: entry.direction, napomena: entry.description, updated_by: context.user.id } });
    }
  });
  await auditLog({ korisnikId: context.user.id, agencijaId: context.user.agencija_id, firmaId, modul: inventoryModule, akcija: "save_inventory_price_adjustment_posting_settings", tipEntiteta: "FirmaPodrazumijevanoKonto", entitetId: firmaId, novaVrijednost: entries.map((entry) => ({ namjena: entry.purpose, konto: entry.accountCode, smjer: entry.direction })) });
  revalidatePath(returnPath);
  revalidatePath("/agencija/robno/nivelacija");
  redirect(`${returnPath}?poruka=nivelacija_sacuvano`);
}
