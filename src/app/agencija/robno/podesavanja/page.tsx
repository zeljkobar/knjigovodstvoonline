import { mergeCompanyAccountPlan } from "@/lib/account-plan";
import { requireRole } from "@/lib/auth";
import {
  calculationPostingFields,
  calculationPostingScope
} from "@/lib/inventory-calculation";
import { prisma } from "@/lib/prisma";
import { inventoryCountPostingFields, inventoryCountPostingScope } from "@/lib/inventory-count";
import { outgoingInvoicePostingFields, outgoingInvoicePostingScope } from "@/lib/outgoing-invoice";
import { inventoryTransferPostingFields, inventoryTransferPostingScope } from "@/lib/inventory-transfer";
import { inventoryWriteOffPostingFields, inventoryWriteOffPostingScope } from "@/lib/inventory-write-off";
import { inventoryPriceAdjustmentPostingFields, inventoryPriceAdjustmentPostingScope } from "@/lib/inventory-price-adjustment";
import {
  getInventoryContext,
  InventoryAccessDenied,
  MissingInventoryContext
} from "../_shared";
import { saveCalculationPostingSettings, saveInventoryCountPostingSettings, saveInventoryPriceAdjustmentPostingSettings, saveInventoryTransferPostingSettings, saveInventoryWriteOffPostingSettings, saveOutgoingInvoicePostingSettings } from "./actions";

type PageProps = {
  searchParams: Promise<{ poruka?: string }>;
};

const messages: Record<string, string> = {
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

  const [baseAccounts, companyAccounts, settings, invoiceSettings, transferSettings, countSettings, writeOffSettings, adjustmentSettings] = await Promise.all([
    prisma.konto.findMany({ where: { aktivan: true }, orderBy: { sifra: "asc" } }),
    prisma.firmaKonto.findMany({
      where: { firma_id: context.firma.id },
      orderBy: { sifra: "asc" }
    }),
    prisma.firmaPodrazumijevanoKonto.findMany({
      where: {
        firma_id: context.firma.id,
        dokument_tip: calculationPostingScope.documentType,
        podvrsta: calculationPostingScope.subtype,
        pdv_stopa_sifra: calculationPostingScope.vatRate
      }
    }),
    prisma.firmaPodrazumijevanoKonto.findMany({ where: { firma_id: context.firma.id, dokument_tip: outgoingInvoicePostingScope.documentType, podvrsta: outgoingInvoicePostingScope.subtype, pdv_stopa_sifra: outgoingInvoicePostingScope.vatRate } }),
    prisma.firmaPodrazumijevanoKonto.findMany({ where: { firma_id: context.firma.id, dokument_tip: inventoryTransferPostingScope.documentType, podvrsta: inventoryTransferPostingScope.subtype, pdv_stopa_sifra: inventoryTransferPostingScope.vatRate } }),
    prisma.firmaPodrazumijevanoKonto.findMany({ where: { firma_id: context.firma.id, dokument_tip: inventoryCountPostingScope.documentType, podvrsta: inventoryCountPostingScope.subtype, pdv_stopa_sifra: inventoryCountPostingScope.vatRate } }),
    prisma.firmaPodrazumijevanoKonto.findMany({ where: { firma_id: context.firma.id, dokument_tip: inventoryWriteOffPostingScope.documentType, podvrsta: inventoryWriteOffPostingScope.subtype, pdv_stopa_sifra: inventoryWriteOffPostingScope.vatRate } }),
    prisma.firmaPodrazumijevanoKonto.findMany({ where: { firma_id: context.firma.id, dokument_tip: inventoryPriceAdjustmentPostingScope.documentType, podvrsta: inventoryPriceAdjustmentPostingScope.subtype, pdv_stopa_sifra: inventoryPriceAdjustmentPostingScope.vatRate } })
  ]);
  const accounts = mergeCompanyAccountPlan(baseAccounts, companyAccounts).filter(
    (account) => account.aktivan && account.tip_konta === "analiticko"
  );
  const settingMap = new Map(settings.map((setting) => [setting.namjena, setting]));
  const invoiceSettingMap = new Map(invoiceSettings.map((setting) => [setting.namjena, setting]));
  const transferSettingMap = new Map(transferSettings.map((setting) => [setting.namjena, setting]));
  const countSettingMap = new Map(countSettings.map((setting) => [setting.namjena, setting]));
  const writeOffSettingMap = new Map(writeOffSettings.map((setting) => [setting.namjena, setting]));
  const adjustmentSettingMap = new Map(adjustmentSettings.map((setting) => [setting.namjena, setting]));
  const transferAccounts = accounts.filter((account) => !account.analitika_obavezna);

  return (
    <div className="admin-stack">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Robno</p>
          <h2>Podešavanja</h2>
          <p className="muted-text">Konta koja program koristi kada knjiži domaću kalkulaciju.</p>
        </div>
      </header>

      {poruka ? <p className="admin-message">{messages[poruka] ?? poruka}</p> : null}

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
        <form action={saveCalculationPostingSettings} className="admin-form">
          <input type="hidden" name="firma_id" value={context.firma.id} />
          <div className="form-wide table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Stavka knjiženja</th>
                  <th>Smjer</th>
                  <th>Konto</th>
                </tr>
              </thead>
              <tbody>
                {calculationPostingFields.map((field) => {
                  const current = settingMap.get(field.purpose);
                  return (
                    <tr key={field.purpose}>
                      <td>
                        <strong>{field.label}</strong>
                        <small className="table-secondary">{field.description}</small>
                      </td>
                      <td>
                        <select
                          name={`smjer_${field.purpose}`}
                          defaultValue={current?.smjer ?? field.defaultDirection}
                        >
                          <option value="D">Duguje</option>
                          <option value="P">Potražuje</option>
                        </select>
                      </td>
                      <td>
                        <select
                          name={`konto_${field.purpose}`}
                          defaultValue={current?.sifra_konta ?? ""}
                        >
                          <option value="">Nije podešeno</option>
                          {accounts.map((account) => (
                            <option key={account.sifra} value={account.sifra}>
                              {account.sifra} · {account.naziv}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="admin-hint form-wide">
            Za veleprodaju se koriste roba, ulazni PDV, dobavljač i zavisni troškovi.
            Maloprodaja dodatno koristi razliku u cijeni i ukalkulisani PDV. Konto je obavezno
            samo kada pripadajući iznos postoji.
          </p>
          <div className="form-actions form-wide">
            <button className="primary-button" type="submit">Sačuvaj podešavanja</button>
          </div>
        </form>
      </section>
      <section className="admin-panel">
        <div className="panel-header"><div><h3>Šema knjiženja popisa robe</h3><p className="muted-text">Višak zadužuje zalihe i odobrava prihod, a manjak zadužuje trošak i odobrava zalihe.</p></div><span>{context.firma.naziv}</span></div>
        <form action={saveInventoryCountPostingSettings} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><div className="form-wide table-wrap"><table className="admin-table"><thead><tr><th>Stavka knjiženja</th><th>Smjer</th><th>Konto</th></tr></thead><tbody>{inventoryCountPostingFields.map((field) => { const current = countSettingMap.get(field.purpose); const choices = field.purpose === "STOCK_COUNT_SURPLUS_INCOME" ? transferAccounts.filter((account) => account.sifra.startsWith("6")) : field.purpose === "STOCK_COUNT_SHORTAGE_EXPENSE" ? transferAccounts.filter((account) => account.sifra.startsWith("5")) : transferAccounts; return <tr key={field.purpose}><td><strong>{field.label}</strong><small className="table-secondary">{field.description}</small></td><td><select name={`smjer_${field.purpose}`} defaultValue={current?.smjer ?? field.defaultDirection}><option value={field.defaultDirection}>{field.defaultDirection === "D" ? "Duguje" : "Potražuje"}</option></select></td><td><select name={`konto_${field.purpose}`} defaultValue={current?.sifra_konta ?? ""}><option value="">Nije podešeno</option>{choices.map((account) => <option key={account.sifra} value={account.sifra}>{account.sifra} · {account.naziv}</option>)}</select></td></tr>; })}</tbody></table></div><p className="admin-hint form-wide">Konta se koriste samo za vrstu razlike koja postoji na popisu.</p><div className="form-actions form-wide"><button className="primary-button" type="submit">Sačuvaj šemu popisa</button></div></form>
      </section>
      <section className="admin-panel">
        <div className="panel-header"><div><h3>Šema knjiženja otpisa robe</h3><p className="muted-text">Otpis zadužuje konto troška i odobrava konto zaliha po nabavnoj vrijednosti.</p></div><span>{context.firma.naziv}</span></div>
        <form action={saveInventoryWriteOffPostingSettings} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><div className="form-wide table-wrap"><table className="admin-table"><thead><tr><th>Stavka knjiženja</th><th>Smjer</th><th>Konto</th></tr></thead><tbody>{inventoryWriteOffPostingFields.map((field) => { const current = writeOffSettingMap.get(field.purpose); const choices = field.purpose === "WRITE_OFF_EXPENSE" ? transferAccounts.filter((account) => account.sifra.startsWith("5")) : transferAccounts; return <tr key={field.purpose}><td><strong>{field.label}</strong><small className="table-secondary">{field.description}</small></td><td><select name={`smjer_${field.purpose}`} defaultValue={current?.smjer ?? field.defaultDirection}><option value={field.defaultDirection}>{field.defaultDirection === "D" ? "Duguje" : "Potražuje"}</option></select></td><td><select name={`konto_${field.purpose}`} defaultValue={current?.sifra_konta ?? ""}><option value="">Nije podešeno</option>{choices.map((account) => <option key={account.sifra} value={account.sifra}>{account.sifra} · {account.naziv}</option>)}</select></td></tr>; })}</tbody></table></div><p className="admin-hint form-wide">Konto troška mora biti iz klase 5. Izabrana konta ne smiju zahtijevati partnera.</p><div className="form-actions form-wide"><button className="primary-button" type="submit">Sačuvaj šemu otpisa</button></div></form>
      </section>
      <section className="admin-panel">
        <div className="panel-header"><div><h3>Šema knjiženja nivelacije</h3><p className="muted-text">Povećanje cijene zadužuje robu i odobrava RUC i PDV; smanjenje automatski obrće smjerove.</p></div><span>{context.firma.naziv}</span></div>
        <form action={saveInventoryPriceAdjustmentPostingSettings} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><div className="form-wide table-wrap"><table className="admin-table"><thead><tr><th>Stavka knjiženja</th><th>Smjer povećanja</th><th>Konto</th></tr></thead><tbody>{inventoryPriceAdjustmentPostingFields.map((field) => { const current = adjustmentSettingMap.get(field.purpose); return <tr key={field.purpose}><td><strong>{field.label}</strong><small className="table-secondary">{field.description}</small></td><td><select name={`smjer_${field.purpose}`} defaultValue={current?.smjer ?? field.defaultDirection}><option value={field.defaultDirection}>{field.defaultDirection === "D" ? "Duguje" : "Potražuje"}</option></select></td><td><select name={`konto_${field.purpose}`} defaultValue={current?.sifra_konta ?? ""}><option value="">Nije podešeno</option>{transferAccounts.map((account) => <option key={account.sifra} value={account.sifra}>{account.sifra} · {account.naziv}</option>)}</select></td></tr>; })}</tbody></table></div><p className="admin-hint form-wide">Smjerovi se odnose na povećanje cijene. Kod sniženja ih sistem automatski obrće.</p><div className="form-actions form-wide"><button className="primary-button" type="submit">Sačuvaj šemu nivelacije</button></div></form>
      </section>
      <section className="admin-panel">
        <div className="panel-header"><div><h3>Šema knjiženja prenosa robe</h3><p className="muted-text">Vrijednost izlazi sa konta izvornog, a ulazi na konto odredišnog magacina.</p></div><span>{context.firma.naziv}</span></div>
        <form action={saveInventoryTransferPostingSettings} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><div className="form-wide table-wrap"><table className="admin-table"><thead><tr><th>Stavka knjiženja</th><th>Smjer</th><th>Konto</th></tr></thead><tbody>{inventoryTransferPostingFields.map((field) => { const current = transferSettingMap.get(field.purpose); return <tr key={field.purpose}><td><strong>{field.label}</strong><small className="table-secondary">{field.description}</small></td><td><select name={`smjer_${field.purpose}`} defaultValue={current?.smjer ?? field.defaultDirection}><option value={field.defaultDirection}>{field.defaultDirection === "D" ? "Duguje" : "Potražuje"}</option></select></td><td><select name={`konto_${field.purpose}`} defaultValue={current?.sifra_konta ?? ""}><option value="">Nije podešeno</option>{transferAccounts.map((account) => <option key={account.sifra} value={account.sifra}>{account.sifra} · {account.naziv}</option>)}</select></td></tr>; })}</tbody></table></div><p className="admin-hint form-wide">Ako oba magacina koriste isto konto zaliha, izaberite isto konto u oba reda. Poslovne jedinice se čuvaju na stavkama naloga.</p><div className="form-actions form-wide"><button className="primary-button" type="submit">Sačuvaj šemu prenosa</button></div></form>
      </section>
      <section className="admin-panel">
        <div className="panel-header"><div><h3>Šema knjiženja izlazne fakture</h3><p className="muted-text">Jedan nalog obuhvata kupca, prihod, izlazni PDV i razduženje robe.</p></div><span>{context.firma.naziv}</span></div>
        <form action={saveOutgoingInvoicePostingSettings} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><div className="form-wide table-wrap"><table className="admin-table"><thead><tr><th>Stavka knjiženja</th><th>Smjer</th><th>Konto</th></tr></thead><tbody>{outgoingInvoicePostingFields.map((field) => { const current = invoiceSettingMap.get(field.purpose); return <tr key={field.purpose}><td><strong>{field.label}</strong><small className="table-secondary">{field.description}</small></td><td><select name={`smjer_${field.purpose}`} defaultValue={current?.smjer ?? field.defaultDirection}><option value="D">Duguje</option><option value="P">Potražuje</option></select></td><td><select name={`konto_${field.purpose}`} defaultValue={current?.sifra_konta ?? ""}><option value="">Nije podešeno</option>{accounts.map((account) => <option key={account.sifra} value={account.sifra}>{account.sifra} · {account.naziv}</option>)}</select></td></tr>; })}</tbody></table></div><div className="form-actions form-wide"><button className="primary-button" type="submit">Sačuvaj šemu fakture</button></div></form>
      </section>
    </div>
  );
}
