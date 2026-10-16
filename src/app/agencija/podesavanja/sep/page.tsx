import { requireRole } from "@/lib/auth";
import Link from "next/link";
import { getSepAdmin } from "@/lib/sep-context";
import { prisma } from "@/lib/prisma";
import { sepKeyConfigured } from "@/lib/sep-secrets";
import { CertificateForm } from "@/app/agencija/sep/CertificateForm";
const messages: Record<string, string> = {
  sacuvano: "Sertifikat i podaci za pristup su sačuvani.", uklonjen: "Sačuvani pristup je uklonjen.",
  podaci: "Provjerite naziv i izaberite PFX/P12 fajl do 512 KB.", kljuc: "Serverski ključ za šifrovanje nije podešen.",
  sertifikat: "Čuvanje nije uspjelo. Provjerite fajl, lozinku i JMBG; ako se greška ponovi, provjerite serversku konfiguraciju.",
};
export default async function SepPage({ searchParams }: { searchParams: Promise<{ poruka?: string }> }) {
  await requireRole("admin_agencije");
  const { user, agencyId } = await getSepAdmin();
  const record = await prisma.agencijaSepSertifikat.findFirst({
    where: { agencija_id: agencyId, korisnik_id: user.id, is_deleted: false },
    select: { naziv: true, updated_at: true },
  });
  const enabled = sepKeyConfigured(), params = await searchParams;
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">Podešavanja</p><h1>SEP sertifikat</h1><p className="muted-text">Dodavanje i zamjena vašeg sertifikata za pristup SEP portalu.</p></div><Link className="table-button" href="/agencija/racuni/sep">Preuzmi sa SEP-a</Link></header>
    {params.poruka && messages[params.poruka] ? <p role="status" className="admin-message">{messages[params.poruka]}</p> : null}
    {!enabled ? <p className="admin-message">Administrator servera treba da podesi ključ za šifrovanje prije dodavanja sertifikata.</p> : null}
    <section className="admin-panel"><div className="panel-header"><h2>Vaš elektronski pečat / sertifikat</h2></div>
      <p className="muted-text">Pristup je vezan za vaš administratorski nalog u agenciji. Lozinka i JMBG se ne prikazuju nakon čuvanja. Sertifikat prethodno mora biti registrovan na SEP-u.</p>
      {record ? <p className="admin-message">Sačuvan sertifikat: {record.naziv} · {record.updated_at.toLocaleDateString("sr-Latn-ME", { timeZone: "Europe/Podgorica" })}</p> : null}
      <CertificateForm configured={Boolean(record)} enabled={enabled}/>
    </section>
  </div>;
}
