import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { fiscalPortalContext, fiscalPortalPublicSelect } from "@/lib/fiscal-portals";
import { fiscalPortalKeyConfigured } from "@/lib/fiscal-portal-secrets";
import PortalForm from "./PortalForm";
const messages: Record<string, string> = { sacuvano: "Povezivanje je sačuvano.", kljuc: "Administrator servera treba podesiti ključ za šifrovanje prije čuvanja.", podaci: "Provjerite provajdera i pristupne podatke.", greska: "Podaci nijesu sačuvani. Osvježite stranicu; za promjenu korisničkog imena ponovo unesite lozinku." };
export default async function FiscalPortalsPage({ searchParams }: { searchParams: Promise<{ poruka?: string }> }) {
  const ctx = await fiscalPortalContext("manage"), query = await searchParams;
  const record = await prisma.firmaFiskalniPortal.findFirst({ where: { agencija_id: ctx.agencyId, firma_id: ctx.firm.id, is_deleted: false }, select: fiscalPortalPublicSelect });
  const enabled = fiscalPortalKeyConfigured();
  return <div className="admin-stack"><header className="admin-header"><div><h2>Fiskalni portali</h2><p>{ctx.firm.naziv} · PIB {ctx.firm.pib}</p></div><Link className="secondary-button" href="/agencija/racuni/podesavanja">Podešavanja KIF/KUF</Link></header>
    {query.poruka && messages[query.poruka] ? <p role="status" className="admin-message">{messages[query.poruka]}</p> : null}
    {!enabled ? <p className="admin-message">Nedostaje serverski ključ FISCAL_PORTAL_ENCRYPTION_KEY.</p> : null}
    <section className="admin-panel"><h3>Preuzimanje izvještaja za unos pazara</h3><p>U otvorenoj KIF knjizi izaberite Unesi pazar → Uvezi izvještaj. Izvještaj popunjava formu i preuzima se na vaš računar. Excel se ne čuva na serveru. Pazar potvrđujete postojećim postupkom.</p>
      <PortalForm key={record?.updated_at.toISOString() ?? ctx.firm.id} firmId={ctx.firm.id} configured={Boolean(record)} version={record?.updated_at.toISOString() ?? ""} provider={record?.provider ?? "VG_EFISKAL"} username={record?.korisnicko_ime ?? ""} active={record?.aktivan ?? true} enabled={enabled} defaultDevice={record?.podrazumijevana_kasa ?? ""}/>
    </section></div>;
}
