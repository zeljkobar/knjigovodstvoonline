import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getSepAdmin, getSepCompany } from "@/lib/sep-context";
import { prisma } from "@/lib/prisma";
import { sepKeyConfigured } from "@/lib/sep-secrets";
import { DownloadForm } from "@/app/agencija/sep/DownloadForm";

export default async function SepDownloadPage() {
  await requireRole("admin_agencije");
  const { user, agencyId } = await getSepAdmin();
  const record = await prisma.agencijaSepSertifikat.findFirst({
    where: { agencija_id: agencyId, korisnik_id: user.id, is_deleted: false },
    select: { id: true },
  });
  let firm: Awaited<ReturnType<typeof getSepCompany>>["firm"] | null = null;
  try { firm = (await getSepCompany()).firm; } catch { /* The page explains how to select a valid company. */ }
  const enabled = sepKeyConfigured();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Podgorica", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return <div className="admin-stack">
    <header className="admin-header"><div><p className="eyebrow">KIF/KUF</p><h1>Preuzmi sa SEP-a</h1><p className="muted-text">Excel fiskalizovanih računa izabrane firme.</p></div><Link className="table-button" href="/agencija/podesavanja/sep">Podešavanje sertifikata</Link></header>
    {!record ? <p className="admin-message">Prvo dodajte svoj sertifikat kroz <Link href="/agencija/podesavanja/sep">Podešavanje sertifikata</Link>.</p> : null}
    {!enabled ? <p className="admin-message">Serverski ključ za šifrovanje nije podešen. Obratite se administratoru servera.</p> : null}
    <section className="admin-panel"><div className="panel-header"><h2>Preuzmi račune</h2></div>
      {firm ? <p>{firm.naziv} · PIB {firm.pib}</p> : <p className="admin-message">Izaberite aktivnu firmu sa ispravnim PIB-om u gornjem biraču.</p>}
      <p className="muted-text">Izaberite period do godinu dana. Preuzimanje ne uvozi račune u knjigovodstvo.</p>
      {firm && record && enabled ? <DownloadForm key={firm.id} firmId={firm.id} from={`${today.slice(0, 7)}-01`} to={today}/> : null}
    </section>
  </div>;
}
