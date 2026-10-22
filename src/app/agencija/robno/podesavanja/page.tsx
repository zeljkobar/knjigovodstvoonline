import { supplierReturnFields, supplierReturnScope } from "@/lib/supplier-return";
import { saveSupplierReturnSettings } from "./actions";
import { PostingTemplateNotice } from "@/components/PostingTemplateNotice";
import { effectiveDefaultAccounts } from "@/lib/posting-template";
import { AccountSearchSelect } from "@/components/AccountSearchSelect";
import { InvoicePostingForm } from "./InvoicePostingForm";
import { mergeCompanyAccountPlan } from "@/lib/account-plan";
import { requireRole } from "@/lib/auth";
import {
  calculationPostingScope
} from "@/lib/inventory-calculation";
import { prisma } from "@/lib/prisma";
import { inventoryCountPostingFields, inventoryCountPostingScope } from "@/lib/inventory-count";
import { outgoingInvoicePostingScope } from "@/lib/outgoing-invoice";
import { inventoryTransferPostingFields, inventoryTransferPostingScope } from "@/lib/inventory-transfer";
import { inventoryWriteOffPostingFields, inventoryWriteOffPostingScope } from "@/lib/inventory-write-off";
import { inventoryPriceAdjustmentPostingFields, inventoryPriceAdjustmentPostingScope } from "@/lib/inventory-price-adjustment";
import {
  getInventoryContext,
  InventoryAccessDenied,
  MissingInventoryContext
} from "../_shared";
import { saveInventoryCountPostingSettings, saveInventoryPriceAdjustmentPostingSettings, saveInventoryTransferPostingSettings, saveInventoryWriteOffPostingSettings } from "./actions";

type PageProps = {
  searchParams: Promise<{ poruka?: string }>;
};

const messages: Record<string, string> = {
  povrat_sacuvano: "Šema povrata dobavljaču je sačuvana.",
  sacuvano: "Podešavanja knjiženja kalkulacije su sačuvana.",
  prava: "Nemate pravo da mijenjate robna podešavanja.",
  neispravna_konta: "Izabrano konto nije dostupno u kontnom planu firme.",
  faktura_sacuvano: "Podešavanja knjiženja izlazne fakture su sačuvana.",
  prenos_sacuvano: "Podešavanja knjiženja prenosa robe su sačuvana."
  ,popis_sacuvano: "Podešavanja knjiženja popisa robe su sačuvana.",
  neispravna_konta_popisa: "Za popis izaberite dostupna konta: prihod mora počinjati sa 6, a trošak sa 5.",
  otpis_sacuvano: "Podešavanja knjiženja otpisa robe su sačuvana.",
  neispravna_konta_otpisa: "Za otpis izaberite dostupna konta; konto troška mora počinjati sa 5."
  ,nivelacija_sacuvano: "Podešavanja knjiženja nivelacije su sačuvana.",
  neispravna_konta_nivelacije: "Za nivelaciju izaberite dostupna analitička konta koja ne zahtijevaju partnera."
};

export default async function InventorySettingsPage({ searchParams }: PageProps) {
  await requireRole("admin_agencije");
  const [{ poruka }, context] = await Promise.all([searchParams, getInventoryContext("manage")]);
  if (!context.firma) return <MissingInventoryContext title="Podešavanja robnog" />;
  if (!context.allowed) return <InventoryAccessDenied title="Podešavanja robnog" />;

  const [baseAccounts, companyAccounts, settings, invoiceSettings, transferSettings, countSettings, writeOffSettings, adjustmentSettings, invoiceVatRates] = await Promise.all([
    prisma.konto.findMany({ where: { aktivan: true }, orderBy: { sifra: "asc" } }),
    prisma.firmaKonto.findMany({
      where: { firma_id: context.firma.id },
      orderBy: { sifra: "asc" }
    }),
    effectiveDefaultAccounts(prisma, {
      where: {
        firma_id: context.firma.id,
        dokument_tip: calculationPostingScope.documentType,
        podvrsta: calculationPostingScope.subtype
      }
    }),
    effectiveDefaultAccounts(prisma, { where: { firma_id: context.firma.id, dokument_tip: outgoingInvoicePostingScope.documentType, podvrsta: outgoingInvoicePostingScope.subtype } }),
    effectiveDefaultAccounts(prisma, { where: { firma_id: context.firma.id, dokument_tip: inventoryTransferPostingScope.documentType, podvrsta: inventoryTransferPostingScope.subtype, pdv_stopa_sifra: inventoryTransferPostingScope.vatRate } }),
    effectiveDefaultAccounts(prisma, { where: { firma_id: context.firma.id, dokument_tip: inventoryCountPostingScope.documentType, podvrsta: inventoryCountPostingScope.subtype, pdv_stopa_sifra: inventoryCountPostingScope.vatRate } }),
    effectiveDefaultAccounts(prisma, { where: { firma_id: context.firma.id, dokument_tip: inventoryWriteOffPostingScope.documentType, podvrsta: inventoryWriteOffPostingScope.subtype, pdv_stopa_sifra: inventoryWriteOffPostingScope.vatRate } }),
    effectiveDefaultAccounts(prisma, { where: { firma_id: context.firma.id, dokument_tip: inventoryPriceAdjustmentPostingScope.documentType, podvrsta: inventoryPriceAdjustmentPostingScope.subtype, pdv_stopa_sifra: inventoryPriceAdjustmentPostingScope.vatRate } })
,
    prisma.pdvStopa.findMany({where:{agencija_id:context.user.agencija_id!},orderBy:{procenat:"desc"},select:{sifra:true,naziv:true}})
  ]);
  const accounts = mergeCompanyAccountPlan(baseAccounts, companyAccounts).filter(
    (account) => account.aktivan && account.tip_konta === "analiticko"
  );
  const transferSettingMap = new Map(transferSettings.map((setting) => [setting.namjena, setting]));
  const countSettingMap = new Map(countSettings.map((setting) => [setting.namjena, setting]));
  const writeOffSettingMap = new Map(writeOffSettings.map((setting) => [setting.namjena, setting]));
  const adjustmentSettingMap = new Map(adjustmentSettings.map((setting) => [setting.namjena, setting]));
  const returnSettings = await effectiveDefaultAccounts(prisma, { where: { firma_id: context.firma.id, dokument_tip: supplierReturnScope.documentType, podvrsta: supplierReturnScope.subtype, pdv_stopa_sifra: "GENERAL" } });
  const transferAccounts = accounts.filter((account) => !account.analitika_obavezna);

  return (
    <div className="admin-stack">
      {context.firma.id ? <PostingTemplateNotice companyId={context.firma.id!}/> : null}
      <header className="admin-header">
        <div>
          <p className="eyebrow">Robno</p>
          <h2>Podešavanja</h2>
          <p className="muted-text">Konta za kalkulacije, povrate i ostale robne dokumente.</p>
        </div>
      </header>

      {poruka ? <p className="admin-message">{messages[poruka] ?? poruka}</p> : null}

      <section className="admin-panel">
        <h3>Šema povrata dobavljaču</h3>
        <p className="muted-text">Smanjenje obaveze i ulaznog PDV-a, razduženje robe i odvojena razlika između odobrenja i nabavne vrijednosti. Popunite konta koja dokument koristi.</p>
        <form action={saveSupplierReturnSettings} className="admin-form">
          <input type="hidden" name="firma_id" value={context.firma.id} />
          <div className="form-wide table-wrap"><table className="admin-table"><thead><tr><th>Namjena</th><th>Smjer</th><th>Konto</th></tr></thead><tbody>{supplierReturnFields.map(field => <tr key={field.purpose}><td>{field.label}</td><td>{field.direction === "D" ? "Duguje" : "Potražuje"}</td><td><AccountSearchSelect name={`konto_${field.purpose}`} defaultValue={returnSettings.find(s => s.namjena === field.purpose)?.sifra_konta ?? ""}><option value="">Nije podešeno</option>{accounts.filter(a => (field.purpose === "RETURN_SUPPLIER" || !a.analitika_obavezna) && (field.purpose !== "RETURN_LOSS" || a.sifra.startsWith("5")) && (field.purpose !== "RETURN_GAIN" || a.sifra.startsWith("6"))).map(a => <option key={a.sifra} value={a.sifra}>{a.sifra} · {a.naziv}</option>)}</AccountSearchSelect></td></tr>)}</tbody></table></div>
          <p className="admin-hint form-wide">Dobavljač se prenosi na dobavljačko konto. Maloprodaja koristi i RUC/ukalkulisani PDV. Prazan lokalni izbor isključuje nasljeđivanje tog konta.</p>
          <div className="form-actions form-wide"><button className="primary-button" type="submit">Sačuvaj šemu povrata</button></div>
        </form>
      </section>
      <section className="admin-panel">
        <div className="panel-header">
          <div>
            <h3>Šema knjiženja kalkulacije</h3>
            <p className="muted-text">
              Konto se definiše jednom za firmu i više se ne bira na svakoj kalkulaciji.
            </p>
          </div>
          <span>{context.firma.naziv}</span>
        </div>
        <InvoicePostingForm key={`calculation-${context.firma.id}`} kind="calculation" firmaId={context.firma.id} settings={settings.map(({namjena,pdv_stopa_sifra,sifra_konta,smjer})=>({namjena,pdv_stopa_sifra,sifra_konta,smjer}))} accounts={accounts.map(({sifra,naziv})=>({sifra,naziv}))} rates={invoiceVatRates}/>
        <p className="admin-hint">U maloprodaji se dodatno knjiže razlika u cijeni i ukalkulisani PDV. Iznosi se raspoređuju po PDV stopi stavke kalkulacije.</p>
      </section>
      <section className="admin-panel">
        <div className="panel-header"><div><h3>Šema knjiženja popisa robe</h3><p className="muted-text">Višak zadužuje zalihe i odobrava prihod, a manjak zadužuje trošak i odobrava zalihe.</p></div><span>{context.firma.naziv}</span></div>
        <form action={saveInventoryCountPostingSettings} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><div className="form-wide table-wrap"><table className="admin-table"><thead><tr><th>Stavka knjiženja</th><th>Smjer</th><th>Konto</th></tr></thead><tbody>{inventoryCountPostingFields.map((field) => { const current = countSettingMap.get(field.purpose); const choices = field.purpose === "STOCK_COUNT_SURPLUS_INCOME" ? transferAccounts.filter((account) => account.sifra.startsWith("6")) : field.purpose === "STOCK_COUNT_SHORTAGE_EXPENSE" ? transferAccounts.filter((account) => account.sifra.startsWith("5")) : transferAccounts; return <tr key={field.purpose}><td><strong>{field.label}</strong><small className="table-secondary">{field.description}</small></td><td><select name={`smjer_${field.purpose}`} defaultValue={current?.smjer ?? field.defaultDirection}><option value={field.defaultDirection}>{field.defaultDirection === "D" ? "Duguje" : "Potražuje"}</option></select></td><td><AccountSearchSelect name={`konto_${field.purpose}`} defaultValue={current?.sifra_konta ?? ""}><option value="">Nije podešeno</option>{choices.map((account) => <option key={account.sifra} value={account.sifra}>{account.sifra} · {account.naziv}</option>)}</AccountSearchSelect></td></tr>; })}</tbody></table></div><p className="admin-hint form-wide">Konta se koriste samo za vrstu razlike koja postoji na popisu.</p><div className="form-actions form-wide"><button className="primary-button" type="submit">Sačuvaj šemu popisa</button></div></form>
      </section>
      <section className="admin-panel">
        <div className="panel-header"><div><h3>Šema knjiženja otpisa robe</h3><p className="muted-text">Otpis zadužuje konto troška i odobrava konto zaliha po nabavnoj vrijednosti.</p></div><span>{context.firma.naziv}</span></div>
        <form action={saveInventoryWriteOffPostingSettings} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><div className="form-wide table-wrap"><table className="admin-table"><thead><tr><th>Stavka knjiženja</th><th>Smjer</th><th>Konto</th></tr></thead><tbody>{inventoryWriteOffPostingFields.map((field) => { const current = writeOffSettingMap.get(field.purpose); const choices = field.purpose === "WRITE_OFF_EXPENSE" ? transferAccounts.filter((account) => account.sifra.startsWith("5")) : transferAccounts; return <tr key={field.purpose}><td><strong>{field.label}</strong><small className="table-secondary">{field.description}</small></td><td><select name={`smjer_${field.purpose}`} defaultValue={current?.smjer ?? field.defaultDirection}><option value={field.defaultDirection}>{field.defaultDirection === "D" ? "Duguje" : "Potražuje"}</option></select></td><td><AccountSearchSelect name={`konto_${field.purpose}`} defaultValue={current?.sifra_konta ?? ""}><option value="">Nije podešeno</option>{choices.map((account) => <option key={account.sifra} value={account.sifra}>{account.sifra} · {account.naziv}</option>)}</AccountSearchSelect></td></tr>; })}</tbody></table></div><p className="admin-hint form-wide">Konto troška mora biti iz klase 5. Izabrana konta ne smiju zahtijevati partnera.</p><div className="form-actions form-wide"><button className="primary-button" type="submit">Sačuvaj šemu otpisa</button></div></form>
      </section>
      <section className="admin-panel">
        <div className="panel-header"><div><h3>Šema knjiženja nivelacije</h3><p className="muted-text">Povećanje cijene zadužuje robu i odobrava RUC i PDV; smanjenje automatski obrće smjerove.</p></div><span>{context.firma.naziv}</span></div>
        <form action={saveInventoryPriceAdjustmentPostingSettings} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><div className="form-wide table-wrap"><table className="admin-table"><thead><tr><th>Stavka knjiženja</th><th>Smjer povećanja</th><th>Konto</th></tr></thead><tbody>{inventoryPriceAdjustmentPostingFields.map((field) => { const current = adjustmentSettingMap.get(field.purpose); return <tr key={field.purpose}><td><strong>{field.label}</strong><small className="table-secondary">{field.description}</small></td><td><select name={`smjer_${field.purpose}`} defaultValue={current?.smjer ?? field.defaultDirection}><option value={field.defaultDirection}>{field.defaultDirection === "D" ? "Duguje" : "Potražuje"}</option></select></td><td><AccountSearchSelect name={`konto_${field.purpose}`} defaultValue={current?.sifra_konta ?? ""}><option value="">Nije podešeno</option>{transferAccounts.map((account) => <option key={account.sifra} value={account.sifra}>{account.sifra} · {account.naziv}</option>)}</AccountSearchSelect></td></tr>; })}</tbody></table></div><p className="admin-hint form-wide">Smjerovi se odnose na povećanje cijene. Kod sniženja ih sistem automatski obrće.</p><div className="form-actions form-wide"><button className="primary-button" type="submit">Sačuvaj šemu nivelacije</button></div></form>
      </section>
      <section className="admin-panel">
        <div className="panel-header"><div><h3>Šema knjiženja prenosa robe</h3><p className="muted-text">Vrijednost izlazi sa konta izvornog, a ulazi na konto odredišnog magacina.</p></div><span>{context.firma.naziv}</span></div>
        <form action={saveInventoryTransferPostingSettings} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><div className="form-wide table-wrap"><table className="admin-table"><thead><tr><th>Stavka knjiženja</th><th>Smjer</th><th>Konto</th></tr></thead><tbody>{inventoryTransferPostingFields.map((field) => { const current = transferSettingMap.get(field.purpose); return <tr key={field.purpose}><td><strong>{field.label}</strong><small className="table-secondary">{field.description}</small></td><td><select name={`smjer_${field.purpose}`} defaultValue={current?.smjer ?? field.defaultDirection}><option value={field.defaultDirection}>{field.defaultDirection === "D" ? "Duguje" : "Potražuje"}</option></select></td><td><AccountSearchSelect name={`konto_${field.purpose}`} defaultValue={current?.sifra_konta ?? ""}><option value="">Nije podešeno</option>{transferAccounts.map((account) => <option key={account.sifra} value={account.sifra}>{account.sifra} · {account.naziv}</option>)}</AccountSearchSelect></td></tr>; })}</tbody></table></div><p className="admin-hint form-wide">Ako oba magacina koriste isto konto zaliha, izaberite isto konto u oba reda. Poslovne jedinice se čuvaju na stavkama naloga.</p><div className="form-actions form-wide"><button className="primary-button" type="submit">Sačuvaj šemu prenosa</button></div></form>
      </section>
      <section className="admin-panel">
        <div className="panel-header"><div><h3>Šema knjiženja izlazne fakture</h3><p className="muted-text">Jedan nalog obuhvata kupca, prihod, izlazni PDV i razduženje robe.</p></div><span>{context.firma.naziv}</span></div>
        <InvoicePostingForm key={`invoice-${context.firma.id}`} firmaId={context.firma.id} settings={invoiceSettings.map(({namjena,pdv_stopa_sifra,sifra_konta,smjer})=>({namjena,pdv_stopa_sifra,sifra_konta,smjer}))} accounts={accounts.map(({sifra,naziv})=>({sifra,naziv}))} rates={invoiceVatRates}/>

      </section>
    </div>
  );
}
