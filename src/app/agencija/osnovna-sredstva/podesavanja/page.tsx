import { createFixedAssetCategory } from "../actions";
import { requireRole } from "@/lib/auth";
import { requirePermissionForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type SettingsPageProps = { searchParams?: Promise<{ poruka?: string }> };
const messages: Record<string, string> = { kontekst_promijenjen: "Kontekst firme/godine je promijenjen. Ponovo otvorite formu.", kategorija_sacuvana: "Kategorija je sačuvana.", kategorija_obavezno: "Šifra i naziv su obavezni.", kategorija_vijek: "Korisni vijek mora biti pozitivan broj mjeseci.", kategorija_duplikat: "Kategorija sa tom šifrom već postoji.", kategorija_greska: "Kategorija nije sačuvana." };

export default async function FixedAssetSettingsPage({ searchParams }: SettingsPageProps) {
  const user = await requireRole("admin_agencije");
  const context = await readWorkContext();
  const params = await searchParams;
  if (!user.agencija_id || !context.firmaId) return <div className="admin-stack"><section className="admin-panel"><p>Izaberite firmu.</p></section></div>;
  await requirePermissionForUser(user, { firmaId: context.firmaId, modul: "osnovna_sredstva", akcija: "manage" });
  const [categories, accounts] = await Promise.all([
    prisma.osKategorija.findMany({ where: { agencija_id: user.agencija_id, firma_id: context.firmaId, is_deleted: false }, orderBy: { sifra: "asc" } }),
    prisma.firmaKonto.findMany({ where: { firma_id: context.firmaId, aktivan: true }, orderBy: { sifra: "asc" }, select: { id: true, sifra: true, naziv: true } })
  ]);
  const accountOptions = <>{accounts.map((account) => <option key={account.id} value={account.id}>{account.sifra} - {account.naziv}</option>)}</>;
  return (
    <div className="admin-stack"><header className="admin-header"><div><p className="eyebrow">Osnovna sredstva</p><h2>Podešavanja</h2></div></header>
      {params?.poruka && messages[params.poruka] ? <p className="admin-note">{messages[params.poruka]}</p> : null}
      <section className="admin-panel"><div className="panel-header"><div><h3>Nova kategorija</h3><span>Šifra, korisni vijek i podrazumijevana konta firme.</span></div></div><form action={createFixedAssetCategory} className="compact-form"><input type="hidden" name="ocekivana_firma_id" value={context.firmaId} /><input type="hidden" name="ocekivana_godina_id" value={context.poslovnaGodinaId ?? ""} /><div className="form-grid"><label>Šifra<input name="sifra" required /></label><label>Naziv<input name="naziv" required /></label><label>Predloženi vijek (mjeseci)<input min="1" name="korisni_vijek_mjeseci" type="number" /></label><label>Konto sredstva<select name="konto_sredstva_id"><option value="">Nije izabrano</option>{accountOptions}</select></label><label>Konto ispravke<select name="konto_ispravke_id"><option value="">Nije izabrano</option>{accountOptions}</select></label><label>Konto troška amortizacije<select name="konto_troska_id"><option value="">Nije izabrano</option>{accountOptions}</select></label><label>Konto neotpisane vrijednosti<select name="konto_neotpisane_vrijednosti_id"><option value="">Nije izabrano</option>{accountOptions}</select></label></div><button type="submit">Dodaj kategoriju</button></form></section>
      <section className="admin-panel"><div className="table-wrap"><table><thead><tr><th>Šifra</th><th>Naziv</th><th>Predloženi vijek</th><th>Status</th></tr></thead><tbody>{categories.map((category) => <tr key={category.id}><td>{category.sifra}</td><td>{category.naziv}</td><td>{category.predlozeni_korisni_vijek_mjeseci ? `${category.predlozeni_korisni_vijek_mjeseci} mjeseci` : "-"}</td><td>{category.aktivna ? "Aktivna" : "Neaktivna"}</td></tr>)}{categories.length === 0 ? <tr><td colSpan={4}>Nema kategorija.</td></tr> : null}</tbody></table></div></section>
    </div>
  );
}