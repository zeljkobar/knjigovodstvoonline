import { ensureDefaultInvoiceBookTypes } from "@/lib/invoice-books";
import Link from "next/link";
import { getSepAdmin } from "@/lib/sep-context";
import { readWorkContext } from "@/lib/work-context";
import { prisma } from "@/lib/prisma";
import { saveSepAutomation } from "./actions";

const messages: Record<string, string> = {
  nezavrseno: "Prvo završite knjiženje ranije uvezenih SEP računa prije promjene KIF vrste.",
  sacuvano: "Postavke su sačuvane.", revizija: "Postavke su promijenjene. Osvježite stranicu.",
  podaci: "Izaberite sertifikat i aktivnu KIF vrstu sa podešenom šemom i vrstom naloga. Serverski ključ mora biti podešen.",
};
export default async function SepAutomationPage({ searchParams }: { searchParams: Promise<{ poruka?: string }> }) {
  const { agencyId, user } = await getSepAdmin();
  const work = await readWorkContext(), query = await searchParams;
  const firm = work.firmaId ? await prisma.firma.findFirst({ where: { id: work.firmaId, agencija_id: agencyId, aktivan: true, is_deleted: false }, select: { id: true, naziv: true } }) : null;
  if (firm) await ensureDefaultInvoiceBookTypes(firm.id, agencyId, user.id);
  const [certificates, types, config, configurations] = await Promise.all([
    prisma.agencijaSepSertifikat.findMany({ where: { agencija_id: agencyId, is_deleted: false, sifrovani_podaci: { not: null }, korisnik: { aktivan: true, is_deleted: false, rola: "admin_agencije" } }, select: { id: true, naziv: true, korisnik: { select: { korisnicko_ime: true } } } }),
    firm ? prisma.racunVrsta.findMany({ where: { agencija_id: agencyId, firma_id: firm.id, dokument_tip: "KIF", aktivna: true }, select: { id: true, naziv: true }, orderBy: { redosljed: "asc" } }) : [],
    firm ? prisma.sepAutomatikaPodesavanje.findUnique({ where: { firma_id: firm.id } }) : null,
    prisma.sepAutomatikaPodesavanje.findMany({ where: { agencija_id: agencyId, firma: { is_deleted: false } }, include: { firma: { select: { naziv: true } }, racun_vrsta: { select: { naziv: true } } }, orderBy: { firma: { naziv: "asc" } } })
  ]);
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Podešavanja</p><h1>SEP automatika</h1><p>Obrada počinje u 04:00, firma po firma. Jedna mjesečna KIF knjiga i jedan proknjižen nalog.</p></div><Link className="secondary-button" href="/agencija/automatski-obradjena-dokumenta">Pregled obrada</Link></header>
    {query.poruka && messages[query.poruka] ? <p role="status" className="admin-message">{messages[query.poruka]}</p> : null}
    {process.env.SEP_AUTOMATION_ENABLED === "false" ? <p className="admin-message">Noćna obrada je isključena na serveru.</p> : process.env.NODE_ENV !== "production" && process.env.SEP_AUTOMATION_ENABLED !== "true" ? <p className="admin-message">Razvojno okruženje: noćni raspored se pokreće na produkcijskom serveru. Ovdje možete pripremiti postavke.</p> : null}
    <section className="admin-panel"><h2>{firm ? `Postavke — ${firm.naziv}` : "Izaberite firmu u gornjoj traci"}</h2>
      <p>Svake noći preuzima se od 1. u mjesecu do juče. Samo prvog dana novog mjeseca provjerava se cijeli prethodni mjesec. Novi računi se uvoze i konačno knjiže; zaključani periodi zahtijevaju provjeru. Excel se obrađuje u memoriji i ne čuva na serveru.</p>
      <p className="muted-text">Uključivanje poslije 04:00 važi od sljedeće noći. Ponovnu obradu možete pokrenuti iz pregleda automatski obrađenih dokumenata.</p>
      {firm ? <form key={`${firm.id}:${config?.revizija ?? 0}`} action={saveSepAutomation} className="admin-form">
        <input type="hidden" name="firma_id" value={firm.id}/><input type="hidden" name="revizija" value={config?.revizija ?? 0}/>
        <label><span>SEP sertifikat</span><select name="sertifikat_id" defaultValue={config?.sertifikat_id ?? ""}><option value="">Izaberite sertifikat</option>{certificates.map(c => <option key={c.id} value={c.id}>{c.naziv} · {c.korisnik.korisnicko_ime}</option>)}</select></label>
        <label><span>Vrsta KIF knjige</span><select name="racun_vrsta_id" defaultValue={config?.racun_vrsta_id ?? ""}><option value="">Izaberite vrstu</option>{types.map(t => <option key={t.id} value={t.id}>{t.naziv}</option>)}</select></label>
        <label className="single-checkbox form-checkbox" style={{ display: "flex" }}><input type="checkbox" name="aktivna" style={{ minHeight: 16 }} defaultChecked={config?.aktivna ?? false}/><span>Uključi noćni uvoz i knjiženje za ovu firmu</span></label>
        <div className="form-actions form-wide"><button type="submit">Sačuvaj postavke</button></div>
      </form> : null}

    </section>
    <section className="admin-panel"><h2>Firme u automatici</h2><div className="table-wrap"><table className="admin-table"><thead><tr><th>Firma</th><th>Vrsta KIF-a</th><th>Status</th></tr></thead><tbody>{configurations.length ? configurations.map(c => <tr key={c.id}><td>{c.firma.naziv}</td><td>{c.racun_vrsta.naziv}</td><td>{c.aktivna ? "Uključena" : "Isključena"}</td></tr>) : <tr><td colSpan={3}>Automatika još nije podešena ni za jednu firmu.</td></tr>}</tbody></table></div></section>
  </div>;
}
