import { NewAssetForm } from "@/components/fixed-assets/NewAssetForm";
import { requireAnyRole } from "@/lib/auth";
import { hasPermission, requirePermissionForUser } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { readWorkContext } from "@/lib/work-context";

type NewAssetPageProps = { searchParams?: Promise<{ poruka?: string }> };

const messages: Record<string, string> = {
  poreska_grupa_neispravna: "Izaberite poresku grupu ili tretman koji odgovara vrsti imovine.",
  ucinak_pocetni: "Dosadašnji učinak i akumulirana amortizacija ne odgovaraju izabranoj stopi. Provjerite početne podatke.",
  kontekst_promijenjen: "Firma ili godina je promijenjena u drugom tabu. Ponovo otvorite formu za izabrani kontekst.",
  pdv_zakljucan: "Promjena utiče na zaključani PDV period. Izmjena nije dozvoljena.",
  presjek_pocetka_godine: "Za preuzeto stanje unesite presjek na dan prije početka aktivne godine. Preuzimanje usred godine još nije podržano.",
  datumi_redosljed: "Nabavka ne može biti poslije raspoloživosti, a raspoloživost preuzetog sredstva mora biti najkasnije na datum presjeka.",
  zemljiste_ispravka: "Zemljište se ne amortizuje; akumulirana amortizacija mora biti nula.",

  sredstvo_obavezno: "Popunite obavezna polja i unesite ispravne vrijednosti.",
  pocetno_obavezno: "Za početno stanje unesite datum presjeka i akumuliranu amortizaciju.",
  sredstvo_vrijednosti: "Ispravka i ostatak nijesu usklađeni sa nabavnom vrijednošću.",
  inventarski_broj_postoji: "Inventarski broj već postoji u ovoj firmi.",
  godina_zakljucena: "Poslovna godina je zaključana.",
  datum_van_godine: "Datum promjene mora pripadati aktivnoj poslovnoj godini.",
  sredstvo_greska: "Sredstvo nije sačuvano. Provjerite podatke i kontekst."
};

export default async function NewFixedAssetPage({ searchParams }: NewAssetPageProps) {
  const user = await requireAnyRole(["admin_agencije", "korisnik_agencije"]);
  const context = await readWorkContext();
  const params = await searchParams;

  if (!user.agencija_id || !context.firmaId || !context.poslovnaGodinaId) {
    return <div className="admin-stack"><section className="admin-panel"><p>Izaberite firmu i poslovnu godinu.</p></section></div>;
  }

  await requirePermissionForUser(user, { firmaId: context.firmaId, modul: "osnovna_sredstva", akcija: "create" });
  const company = await prisma.firma.findFirst({ where: { id: context.firmaId, agencija_id: user.agencija_id, is_deleted: false }, select: { id: true, naziv: true } });
  if (!company) return null;

  const [categories, units, year] = await Promise.all([
    prisma.osKategorija.findMany({ where: { agencija_id: user.agencija_id, firma_id: company.id, aktivna: true, is_deleted: false }, orderBy: { sifra: "asc" } }),
    prisma.poslovnaJedinica.findMany({ where: { agencija_id: user.agencija_id, firma_id: company.id, aktivna: true, is_deleted: false }, orderBy: { naziv: "asc" }, select: { id: true, sifra: true, naziv: true } }),
    prisma.poslovnaGodina.findFirst({ where: { id: context.poslovnaGodinaId, firma_id: company.id }, select: { godina: true, datum_od: true, datum_do: true, zakljucena: true } })
  ]);

  const canConfirmOpening = await hasPermission(user, { firmaId: company.id, modul: "osnovna_sredstva", akcija: "post" });
  const cutoff = year ? new Date(year.datum_od.getTime() - 86_400_000).toISOString().slice(0, 10) : "";
  return (
    <div className="admin-stack">
      <header className="admin-header"><div><p className="eyebrow">Osnovna sredstva</p><h2>Novo sredstvo</h2><p className="muted-text">{company.naziv} · {year?.godina}</p></div></header>
      {params?.poruka && messages[params.poruka] ? <p className="admin-note">{messages[params.poruka]}</p> : null}
      {year?.zakljucena ? <p className="admin-note">Poslovna godina je zaključana; unos nije dozvoljen.</p> : null}
      {year ? <NewAssetForm companyId={company.id} yearId={context.poslovnaGodinaId} cutoff={cutoff} yearStart={year.datum_od.toISOString().slice(0,10)} yearEnd={year.datum_do.toISOString().slice(0,10)} locked={year.zakljucena} canOpening={canConfirmOpening} categories={categories.map(c=>({id:c.id,sifra:c.sifra,naziv:c.naziv}))} units={units}/> : null}
    </div>
  );
}