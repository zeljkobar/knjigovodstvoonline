import { mergeCompanyAccountPlan } from "@/lib/account-plan";
import {
  calculationPostingFields,
  calculationPostingScope
} from "@/lib/inventory-calculation";
import { prisma } from "@/lib/prisma";
import { outgoingInvoicePostingFields, outgoingInvoicePostingScope } from "@/lib/outgoing-invoice";
import {
  getInventoryContext,
  InventoryAccessDenied,
  MissingInventoryContext
} from "../_shared";
import { saveCalculationPostingSettings, saveOutgoingInvoicePostingSettings } from "./actions";

type PageProps = {
  searchParams: Promise<{ poruka?: string }>;
};

const messages: Record<string, string> = {
  sacuvano: "Podešavanja knjiženja kalkulacije su sačuvana.",
  prava: "Nemate pravo da mijenjate robna podešavanja.",
  neispravna_konta: "Izabrano konto nije dostupno u kontnom planu firme."
  ,faktura_sacuvano: "Podešavanja knjiženja izlazne fakture su sačuvana."
};

export default async function InventorySettingsPage({ searchParams }: PageProps) {
  const [{ poruka }, context] = await Promise.all([searchParams, getInventoryContext("manage")]);
  if (!context.firma) return <MissingInventoryContext title="Podešavanja robnog" />;
  if (!context.allowed) return <InventoryAccessDenied title="Podešavanja robnog" />;

  const [baseAccounts, companyAccounts, settings, invoiceSettings] = await Promise.all([
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
    prisma.firmaPodrazumijevanoKonto.findMany({ where: { firma_id: context.firma.id, dokument_tip: outgoingInvoicePostingScope.documentType, podvrsta: outgoingInvoicePostingScope.subtype, pdv_stopa_sifra: outgoingInvoicePostingScope.vatRate } })
  ]);
  const accounts = mergeCompanyAccountPlan(baseAccounts, companyAccounts).filter(
    (account) => account.aktivan && account.tip_konta === "analiticko"
  );
  const settingMap = new Map(settings.map((setting) => [setting.namjena, setting]));
  const invoiceSettingMap = new Map(invoiceSettings.map((setting) => [setting.namjena, setting]));

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
        <div className="panel-header"><div><h3>Šema knjiženja izlazne fakture</h3><p className="muted-text">Jedan nalog obuhvata kupca, prihod, izlazni PDV i razduženje robe.</p></div><span>{context.firma.naziv}</span></div>
        <form action={saveOutgoingInvoicePostingSettings} className="admin-form"><input type="hidden" name="firma_id" value={context.firma.id} /><div className="form-wide table-wrap"><table className="admin-table"><thead><tr><th>Stavka knjiženja</th><th>Smjer</th><th>Konto</th></tr></thead><tbody>{outgoingInvoicePostingFields.map((field) => { const current = invoiceSettingMap.get(field.purpose); return <tr key={field.purpose}><td><strong>{field.label}</strong><small className="table-secondary">{field.description}</small></td><td><select name={`smjer_${field.purpose}`} defaultValue={current?.smjer ?? field.defaultDirection}><option value="D">Duguje</option><option value="P">Potražuje</option></select></td><td><select name={`konto_${field.purpose}`} defaultValue={current?.sifra_konta ?? ""}><option value="">Nije podešeno</option>{accounts.map((account) => <option key={account.sifra} value={account.sifra}>{account.sifra} · {account.naziv}</option>)}</select></td></tr>; })}</tbody></table></div><div className="form-actions form-wide"><button className="primary-button" type="submit">Sačuvaj šemu fakture</button></div></form>
      </section>
    </div>
  );
}
