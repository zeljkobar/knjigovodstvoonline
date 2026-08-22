import Link from "next/link";
import { requireDirectPortalContext } from "@/lib/direct-portal";
import { hasDirectPortalPermission } from "@/lib/direct-portal-policy";
import { prisma } from "@/lib/prisma";
import { registerPortalInitialCashDeposit, updatePortalContactSettings, updatePortalMainBankAccount, updatePortalPosSettings } from "./actions";

const success = new Set(["kontakt", "racun_sacuvan", "pos", "depozit"]);

function message(code?: string, apiCode?: string) {
  const values: Record<string, string> = {
    kontakt: "Kontakt podaci za dokumente su sačuvani.",
    racun_sacuvan: "Glavni račun za štampu je sačuvan.",
    pos: "Operativna POS podešavanja su sačuvana.",
    depozit: "Početni depozit je prijavljen u Test okruženju.",
    depozit_iznos: "Unesite ispravan nenegativan iznos sa najviše dvije decimale.",
    depozit_production: "Produkcijski depozit još nije podržan ugovorom Fiscal API-ja. Testna ruta nije pozvana.",
    depozit_podesavanje: "Kasa ili fiskalna veza nijesu spremne.",
    unos: "Provjerite izabranu kasu, magacin i vrijednosti podešavanja.",
    racun: "Izabrani bankovni račun nije dostupan ovoj firmi.",
    scope: "Firma nije dostupna ovom nalogu."
  };
  return values[code ?? ""] ?? `Operacija nije završena${apiCode ? ` (${apiCode})` : ""}.`;
}

export default async function PortalSettingsPage({ searchParams }: { searchParams: Promise<{ poruka?: string; kod?: string }> }) {
  const [query, context] = await Promise.all([searchParams, requireDirectPortalContext([{ modul: "pos", akcija: "manage" }, { modul: "robno", akcija: "manage" }], "/portal/podesavanja", "any")]);
  const canManagePos = hasDirectPortalPermission(context.permissionKeys, { modul: "pos", akcija: "manage" });
  const [firm, settings, registers, warehouses, accounts] = await Promise.all([
    prisma.firma.findFirst({ where: { id: context.firma.id, agencija_id: context.user.agencija_id! }, select: { naziv: true, pib: true, adresa: true, grad: true, telefon: true, email: true, web_sajt: true, dozvoli_negativan_lager: true } }),
    prisma.posPodesavanje.findUnique({ where: { firma_id: context.firma.id } }),
    prisma.posRegister.findMany({ where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, aktivan: true, is_deleted: false }, include: { magacin: { select: { id: true, dozvoli_negativan_lager: true } } }, orderBy: { naziv: "asc" } }),
    prisma.magacin.findMany({ where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, aktivan: true, is_deleted: false }, select: { id: true, sifra: true, naziv: true, dozvoli_negativan_lager: true }, orderBy: [{ sifra: "asc" }, { naziv: "asc" }] }),
    prisma.firmaBankovniRacun.findMany({ where: { agencija_id: context.user.agencija_id!, firma_id: context.firma.id, aktivan: true, is_deleted: false }, orderBy: [{ glavni: "desc" }, { created_at: "asc" }] })
  ]);
  if (!firm) return null;
  const selectedRegister = registers.find((item) => item.id === settings?.podrazumijevana_kasa_id) ?? registers[0] ?? null;
  const selectedWarehouse = selectedRegister?.magacin;
  const stockPolicy = selectedWarehouse?.dozvoli_negativan_lager === null || selectedWarehouse?.dozvoli_negativan_lager === undefined ? "INHERIT" : selectedWarehouse.dozvoli_negativan_lager ? "ALLOW" : "BLOCK";
  return <div className="admin-stack portal-settings-page">
    <header className="admin-header"><div><p className="eyebrow">Portal / Podešavanja</p><h2>Operativna podešavanja</h2><p className="muted-text">Podešavanja prodaje i podataka koji se prikazuju na dokumentima.</p></div><Link className="secondary-button" href="/portal">Početna</Link></header>
    {query.poruka ? <p className={`status-banner ${success.has(query.poruka) ? "success" : "error"}`}>{message(query.poruka, query.kod)}</p> : null}
    <section className="admin-panel"><div className="panel-header"><h3>Fiskalni identitet</h3><span>Samo pregled</span></div><div className="invoice-summary-grid"><span>Naziv <strong>{firm.naziv}</strong></span><span>PIB <strong>{firm.pib ?? "—"}</strong></span><span>Sjedište <strong>{[firm.adresa, firm.grad].filter(Boolean).join(", ") || "—"}</strong></span><span>Okruženje <strong>{context.firma.fiscalCompanyLink?.fiscal_environment ?? "—"}</strong></span></div><p className="muted-text">Naziv, PIB, adresa, sertifikat, ENU i operateri mijenjaju se isključivo preko podrške.</p></section>
    <section className="admin-panel"><div className="panel-header"><h3>Kontakt na dokumentima</h3></div><form action={updatePortalContactSettings} className="portal-settings-form"><label>Telefon<input name="telefon" defaultValue={firm.telefon ?? ""}/></label><label>E-mail<input name="email" type="email" defaultValue={firm.email ?? ""}/></label><label>Web sajt<input name="web_sajt" defaultValue={firm.web_sajt ?? ""}/></label><div className="form-actions"><button className="primary-button" type="submit">Sačuvaj kontakt</button></div></form></section>
    <section className="admin-panel"><div className="panel-header"><h3>Glavni račun za štampu</h3><span>{accounts.length}</span></div>{accounts.length ? <form action={updatePortalMainBankAccount} className="portal-settings-form portal-settings-form--compact"><label>Bankovni račun<select name="bank_account_id" defaultValue={accounts.find((item) => item.glavni)?.id ?? accounts[0].id}>{accounts.map((account) => <option value={account.id} key={account.id}>{account.naziv_banke} · {account.broj_racuna}</option>)}</select></label><div className="form-actions"><button className="primary-button" type="submit">Postavi kao glavni</button></div></form> : <p className="status-banner error">Nema aktivnog bankovnog računa. Kontaktirajte podršku da ga doda.</p>}</section>
    {canManagePos ? <section className="admin-panel"><div className="panel-header"><h3>POS i štampa</h3><span>{registers.length} kasa</span></div>{selectedRegister ? <form action={updatePortalPosSettings} className="portal-settings-form"><label>Podrazumijevana kasa<select name="register_id" defaultValue={selectedRegister.id}>{registers.map((register) => <option value={register.id} key={register.id}>{register.sifra} · {register.naziv}</option>)}</select></label><label>Magacin kase<select name="magacin_id" defaultValue={selectedRegister.magacin_id ?? ""}><option value="">Bez magacina</option>{warehouses.map((warehouse) => <option value={warehouse.id} key={warehouse.id}>{warehouse.sifra} · {warehouse.naziv}</option>)}</select></label><label>Podrazumijevano plaćanje<select name="payment_method" defaultValue={selectedRegister.podrazumijevano_placanje}><option value="CASH">Gotovina</option><option value="CARD">Kartica</option><option value="BANK_TRANSFER">Virman</option></select></label><label>Format termalne štampe<select name="print_format" defaultValue={settings?.format_stampe ?? "58"}><option value="58">58 mm</option><option value="80">80 mm</option></select></label><label>Rok plaćanja OFFICE fakture<input name="due_days" type="number" min="0" max="365" defaultValue={settings?.podrazumijevani_rok_dana ?? 7}/></label><label>Negativan lager<select name="stock_policy" defaultValue={stockPolicy}><option value="INHERIT">Pravilo firme ({firm.dozvoli_negativan_lager ? "dozvoljen" : "blokiran"})</option><option value="ALLOW">Dozvoli za izabrani magacin</option><option value="BLOCK">Blokiraj za izabrani magacin</option></select></label><label className="single-checkbox"><input name="requires_shift" type="checkbox" defaultChecked={settings?.zahtijeva_smjenu ?? false}/><span>Smjena je obavezna prije prodaje</span></label><label className="single-checkbox"><input name="auto_print" type="checkbox" defaultChecked={settings?.automatska_stampa ?? false}/><span>Automatski otvori štampu poslije naplate</span></label><div className="form-actions"><button className="primary-button" type="submit">Sačuvaj POS podešavanja</button></div></form> : <p className="status-banner error">Nema aktivne kase. Kreiranje kase radi podrška.</p>}</section> : null}
    {canManagePos ? <section className="admin-panel"><div className="panel-header"><h3>Početni gotovinski depozit</h3><span>{context.firma.fiscalCompanyLink?.fiscal_environment ?? "—"}</span></div><p className="muted-text">Depozit se prijavljuje po kasi. Testna prijava radi odmah; produkcijska prijava ostaje bezbjedno blokirana dok Fiscal API ne dobije produkcijsku rutu.</p><div className="portal-register-grid">{registers.map((register) => <article className="settings-card" key={register.id}><strong>{register.sifra} · {register.naziv}</strong><p className="muted-text">ENU {register.fiscal_device_code ?? register.fiscal_device_id}</p>{register.cash_deposit_registered_at ? <p className="status-banner success">{Number(register.cash_deposit_amount ?? 0).toFixed(2)} € · {register.cash_deposit_environment} · {register.cash_deposit_registered_at.toLocaleString("sr-Latn-ME")}{register.cash_deposit_fcdc ? ` · FCDC ${register.cash_deposit_fcdc}` : ""}</p> : <p className="status-banner error">Depozit nije prijavljen.</p>}<form action={registerPortalInitialCashDeposit} className="portal-settings-form portal-settings-form--deposit"><input name="register_id" type="hidden" value={register.id}/><label>Iznos (€)<input name="cash_amount" inputMode="decimal" defaultValue={register.cash_deposit_amount?.toString() ?? "0,00"} required/></label><div className="form-actions"><button className="primary-button" type="submit">Prijavi depozit</button></div></form></article>)}</div></section> : null}
  </div>;
}
