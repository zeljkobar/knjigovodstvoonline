import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ExistingFiscalAccessForm, FiscalAccessFields } from "@/components/FiscalAccessForms";
import { saveFiscalAccess, resendFiscalAccessInvitation } from "./actions";
export const dynamic = "force-dynamic";
const messages: Record<string, string> = { NALOG_KREIRAN: "Novi nalog i fiskalni pristup su kreirani. Pozivnica za postavljanje lozinke je poslata na uneseni e-mail.", POZIVNICA_POSLATA: "Pozivnica je poslata. Korisnik postavlja lozinku preko linka koji važi 7 dana.", PRISTUP_SACUVAN: "Fiskalni pristup je sačuvan. Korisnik koristi isti nalog.", PRISTUP_UKINUT: "Fiskalni pristup je ukinut. Knjigovodstvena prava i nalog ostaju isti.", POZIVNICA_GRESKA: "Nalog i pristup su sačuvani, ali pozivnica nije poslata. Ponovno slanje je dostupno ispod.", PRISTUP_GRESKA: "Pristup nije sačuvan. Provjerite da korisničko ime ili e-mail već nijesu zauzeti; za postojeći nalog koristite izbor korisnika.", ZASTARIO_PREGLED: "Podaci su izmijenjeni. Osvježite stranicu i ponovite izbor.", KORISNIK_DRUGA_FIRMA: "Nalog je dodijeljen drugoj firmi. Fiskalni nalog mora pripadati samo jednoj firmi.", KORISNIK_NIJE_KLIJENT_FIRME: "Izaberite aktivnog klijenta iste agencije. Radnički nalozi se ne pretvaraju automatski u klijente.", FIRMA_NIJE_FISKALNA: "Prvo uključite fiskalizaciju firmi.", OBAVEZNA_POLJA: "Unesite korisničko ime i ispravan e-mail." };
export default async function FiscalAccessPage({ params, searchParams }: {
    params: Promise<{
        firmaId: string;
    }>;
    searchParams: Promise<{
        q?: string;
        poruka?: string;
    }>;
}) {
    await requireRole("admin");
    const { firmaId } = await params, query = await searchParams;
    const firma = await prisma.firma.findFirst({ where: { id: firmaId, is_deleted: false }, include: { agencija: true, fiscalCompanyLink: true, posPodesavanje:true } });
    if (!firma)
        notFound();
    const q = typeof query.q === "string" ? query.q.trim().slice(0, 100) : "";
    const [grants, candidates] = await Promise.all([
        prisma.korisnikFirma.findMany({ where: { firma_id: firma.id, fiscal_portal_enabled: true, is_deleted: false }, include: { korisnik: { select: { id: true, korisnicko_ime: true, email: true, rola: true, aktivan: true } } }, orderBy: { created_at: "asc" } }),
        prisma.korisnik.findMany({ where: { agencija_id: firma.agencija_id, rola: firma.agencija.is_fiscal_direct_container ? { in: ["klijent", "korisnik_agencije"] } : "klijent", aktivan: true, is_deleted: false, ...(q ? { OR: [{ korisnicko_ime: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }] } : {}), firme: { none: { OR: [{ firma_id: { not: firma.id }, is_deleted: false }, { firma_id: firma.id, fiscal_portal_enabled: true, is_deleted: false }] } } }, select: { id: true, korisnicko_ime: true, email: true, firme: { where: { firma_id: firma.id }, select: { updated_at: true } } }, orderBy: { korisnicko_ime: "asc" }, take: 20 })
    ]);
    return <div className="admin-stack"><header className="admin-header"><div><p className="eyebrow">Fiskalna platforma</p><h2>Fiskalni pristup · {firma.skraceni_naziv || firma.naziv}</h2><p>{firma.agencija.is_fiscal_direct_container ? "Direktni klijent" : firma.agencija.naziv} · PIB {firma.pib}</p></div><Link className="secondary-button" href={`/admin/fiskalizacija/${firma.id}`}>Podešavanje firme</Link></header>
  {query.poruka ? <p role="status" className="admin-message">{messages[query.poruka] || "Zahtjev nije završen."}</p> : null}
  <section className="admin-panel"><h3>POS / Kasa firme</h3><p>{firma.posPodesavanje?.aktivan ? "POS firme je uključen. Korisniku odobrite POS izdavanje u pravima ispod." : "POS firme još nije uključen. Povežite kasu, pa korisniku odobrite POS izdavanje u pravima ispod."}</p><Link className="primary-button" href={`/admin/fiskalizacija/${firma.id}/pos`}>Podesi POS kasu firme</Link></section><section className="admin-panel"><p>Fiskalni pristup i prava dodjeljuje samo admin platforme. Agencija istom klijentskom nalogu zasebno dodjeljuje kartice, robne preglede i dokumentaciju. Nova firma ili novi nalog nijesu potrebni ako nalog već postoji.</p><p>Pristup portalu ne aktivira produkciju. Izdavanje računa zavisi od spremnosti fiskalne konfiguracije firme.</p></section>
  {!firma.fiscalCompanyLink ? <p>Prvo uključite fiskalizaciju firmi.</p> : <>
  <section className="admin-panel"><h3>Odobreni korisnici</h3>{!grants.length ? <p>Fiskalni pristup još nije dodijeljen nijednom korisniku.</p> : grants.map(grant => <details key={grant.id}><summary>{grant.korisnik.korisnicko_ime} · {grant.korisnik.email} · {grant.korisnik.aktivan ? "Aktivan nalog" : "Nalog deaktiviran"}</summary><form action={saveFiscalAccess} className="admin-form"><input type="hidden" name="firma_id" value={firma.id}/><input type="hidden" name="korisnik_id" value={grant.korisnik_id}/><input type="hidden" name="version" value={grant.updated_at.toISOString()}/><FiscalAccessFields permissions={grant.fiscal_portal_permissions}/><div className="header-actions"><button className="primary-button" name="operation" value="grant">Sačuvaj fiskalna prava</button><button className="danger-button" name="operation" value="revoke">Ukini fiskalni pristup</button></div></form><form action={resendFiscalAccessInvitation}><input type="hidden" name="firma_id" value={firma.id}/><input type="hidden" name="korisnik_id" value={grant.korisnik_id}/><button className="secondary-button">Ponovo pošalji pozivnicu za lozinku</button></form></details>)}</section>
  <section className="admin-panel"><h3>Dodijeli pristup postojećem klijentu</h3><form method="get" className="admin-form"><label><span>Pretraga korisničkog imena ili e-maila</span><input name="q" defaultValue={q}/></label><button className="secondary-button">Pretraži</button></form><p>Prikazano do 20 aktivnih klijenata ove agencije bez druge aktivne firme. Ako nema naloga, kreirajte ga ispod.</p><ExistingFiscalAccessForm firmaId={firma.id} candidates={candidates.map(user => ({ id: user.id, username: user.korisnicko_ime, email: user.email, version: user.firme[0]?.updated_at.toISOString() ?? "new" }))} action={saveFiscalAccess}/></section>
  <section className="admin-panel"><h3>Kreiraj novi nalog i odobri fiskalni pristup</h3><p>{firma.agencija.is_fiscal_direct_container ? "Direktni korisnik poslije prijave otvara fiskalni portal." : "Novi nalog biće klijent ove agencije, odmah dodijeljen ovoj firmi i vidljiv među Klijentskim korisnicima. Agencija naknadno određuje knjigovodstvene preglede."}</p><form action={saveFiscalAccess} className="admin-form"><input type="hidden" name="firma_id" value={firma.id}/><input type="hidden" name="operation" value="create"/><label><span>Korisničko ime</span><input name="korisnicko_ime" required maxLength={80} autoComplete="off"/></label><label><span>E-mail za pozivnicu</span><input name="email" type="email" required autoComplete="off"/></label><FiscalAccessFields /><button className="primary-button">Kreiraj nalog i pošalji pozivnicu</button></form></section>
  </>}
  </div>;
}
