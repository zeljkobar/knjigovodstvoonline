import Link from "next/link";
import { getPosContext } from "@/lib/pos";
import { warehouseSalesTypeLabel } from "@/lib/pos-pricing";
import { prisma } from "@/lib/prisma";
import { configureDefaultPosRegister, registerInitialCashDeposit, updatePosAccountingIntegration, updatePosRegisterWarehouse } from "./actions";

const successMessages = new Set(["sacuvano", "depozit_sacuvan", "integracija_sacuvana", "magacin_sacuvan"]);

function messageText(message: string, code?: string) {
  if (message === "sacuvano") return "Kasa je povezana i POS je aktiviran.";
  if (message === "magacin_sacuvan") return "Magacin kase je sačuvan.";
  if (message === "lager_magacin") return "Izabrani magacin nije dostupan ovoj firmi.";
  if (message === "integracija_sacuvana") return "Računovodstvena integracija je sačuvana. Postojeći POS računi su razvrstani prema načinu plaćanja.";
  if (message === "depozit_sacuvan") return "Početni gotovinski depozit je uspješno prijavljen Poreskoj upravi.";
  if (message === "depozit_iznos") return "Unesite ispravan iznos depozita (nula ili pozitivan iznos, najviše dvije decimale).";
  if (message === "depozit_production") return "Produkcijska prijava depozita nije dostupna kroz postojeću Fiscal API rutu. Testni endpoint se neće koristiti za produkciju.";
  if (message === "depozit_greska") return `Prijava depozita nije uspjela${code ? ` (${code})` : ""}.`;
  if (message === "api") return `Fiscal API trenutno nije dostupan${code ? ` (${code})` : ""}. Pokrenite API i pokušajte ponovo.`;
  return "POS nije moguće aktivirati. Provjerite fiskalni readiness firme.";
}

export default async function PosSettingsPage({ searchParams }: { searchParams: Promise<{ poruka?: string; kod?: string }> }) {
  const [{ poruka, kod }, ctx] = await Promise.all([searchParams, getPosContext("manage")]);
  if (!ctx.firma || !ctx.allowed) return <section className="admin-panel"><p>Nemate pravo upravljanja POS podešavanjima.</p></section>;
  const firma = ctx.firma;
  const [settings, registers, warehouses] = await Promise.all([
    prisma.posPodesavanje.findUnique({ where: { firma_id: firma.id } }),
    prisma.posRegister.findMany({ where: { agencija_id: ctx.user.agencija_id!, firma_id: firma.id, is_deleted: false }, include: { magacin: { select: { id: true, naziv: true, sifra: true, tip_prodaje: true, dozvoli_negativan_lager: true } } }, orderBy: { naziv: "asc" } }),
    prisma.magacin.findMany({ where: { agencija_id: ctx.user.agencija_id!, firma_id: firma.id, aktivan: true, is_deleted: false }, select: { id: true, naziv: true, sifra: true, tip_prodaje: true }, orderBy: [{ sifra: "asc" }, { naziv: "asc" }] })
  ]);

  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">POS / Podešavanja</p><h2>Povezivanje kase</h2><p className="muted-text">Kasa koristi aktivnu poslovnu jedinicu, ENU i operatora iz Fiscal API-ja.</p></div><Link className="secondary-button" href="/agencija/pos">Otvori POS</Link></header>
    {poruka ? <p className={`status-banner ${successMessages.has(poruka) ? "success" : "error"}`}>{messageText(poruka, kod)}</p> : null}
    <section className="admin-panel"><div className="panel-header"><h3>Aktivacija</h3><span>{settings?.aktivan ? "POS aktivan" : "POS nije aktivan"}</span></div><p>Automatsko povezivanje bira prvi aktivni objekat, pripadajući ENU i aktivnog operatora iz istog Test ili Production okruženja. Ova akcija ne mijenja izabrani magacin kase.</p><form action={configureDefaultPosRegister}><button className="primary-button" type="submit">Poveži / osvježi KASU-1</button></form></section>
    <section className="admin-panel"><div className="panel-header"><h3>Računovodstvena integracija</h3><span>{settings?.racunovodstvena_integracija ? "Uključena" : "Isključena"}</span></div><p className="muted-text">Kada je uključena, fiskalizovani virmani se pojedinačno pripremaju za KIF po šemi izlaznih računa. Gotovina i kartica ulaze u kontrolisani zbirni pazar i zbirni nalog istog perioda.</p><form action={updatePosAccountingIntegration} className="form-grid"><label><input name="accounting_integration" type="checkbox" defaultChecked={settings?.racunovodstvena_integracija ?? false}/> Uključi povezivanje POS-a sa KIF-om i glavnom knjigom</label><label>Period zbirne obrade<select name="kif_mode" defaultValue={settings?.kif_rezim ?? "DAILY"}><option value="DAILY">Dnevno</option><option value="MONTHLY">Mjesečno</option></select></label><button className="primary-button" type="submit">Sačuvaj integraciju</button></form><p><Link href="/agencija/pos/obrada">Otvori zbirnu obradu POS računa</Link></p></section>
    <section className="admin-panel"><div className="panel-header"><h3>Kase, magacini i početni depozit</h3><span>{registers.length} ukupno</span></div><p className="muted-text">Za prodaju robe koja prati zalihe izaberite magacin kase. Usluge i artikli koji ne prate zalihe mogu se prodavati bez magacina.</p>
      {registers.map((register) => {
        const negativeStockAllowed = register.magacin ? (register.magacin.dozvoli_negativan_lager ?? firma.dozvoli_negativan_lager) : false;
        return <div className="settings-card" key={register.id}>
          <strong>{register.naziv}</strong><p className="muted-text">{register.sifra} · {register.fiscal_business_unit_name ?? "Objekat"} · ENU {register.fiscal_device_code ?? register.fiscal_device_id}</p>
          <form action={updatePosRegisterWarehouse} className="form-grid"><input type="hidden" name="register_id" value={register.id}/><label>Magacin kase<select name="magacin_id" defaultValue={register.magacin_id ?? ""}><option value="">Bez magacina (samo usluge / bez praćenja zaliha)</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.sifra} · {warehouse.naziv} · {warehouseSalesTypeLabel(warehouse.tip_prodaje)}</option>)}</select></label><button className="secondary-button" type="submit">Sačuvaj magacin</button></form>
          {register.magacin ? <p className="muted-text">Tip prodaje: {warehouseSalesTypeLabel(register.magacin.tip_prodaje)} · izvor cijene: {register.magacin.tip_prodaje === "WHOLESALE" ? "cijena bez PDV-a" : "cijena sa PDV-om"}. Negativan lager: {negativeStockAllowed ? "dozvoljen" : "blokiran"} ({register.magacin.dozvoli_negativan_lager === null ? "pravilo firme" : "pravilo magacina"}).</p> : <p className="status-banner error">Kasa nema izabran magacin. Prodaja robe koja prati zalihe biće blokirana prije fiskalizacije.</p>}
          {register.cash_deposit_registered_at ? <p className="status-banner success">Prijavljeno {Number(register.cash_deposit_amount ?? 0).toFixed(2)} € · {register.cash_deposit_environment} · {register.cash_deposit_registered_at.toLocaleString("sr-Latn-ME")}{register.cash_deposit_fcdc ? ` · FCDC ${register.cash_deposit_fcdc}` : ""}</p> : <p className="status-banner error">Početni depozit još nije prijavljen.</p>}
          <form action={registerInitialCashDeposit} className="form-grid"><input type="hidden" name="register_id" value={register.id}/><label>Iznos početnog depozita (€)<input name="cash_amount" inputMode="decimal" defaultValue={register.cash_deposit_amount?.toString() ?? "0,00"} required /></label><button className="primary-button" type="submit">Prijavi početni depozit</button></form>
        </div>;
      })}
    </section>
  </div>;
}
