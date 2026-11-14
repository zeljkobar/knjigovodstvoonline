import Link from "next/link";
import { notFound } from "next/navigation";
import { DokumentaUpload } from "@/components/DokumentaUpload";
import { dokumentaContext, dokumentaKategorije } from "@/lib/dokumentacija";
import { hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export default async function KlijentDokumentacija({ searchParams }: { searchParams: Promise<{ godina?: string; dopuna?: string }> }) {
  const query = await searchParams;
  const context = await dokumentaContext("view", query.godina).catch(() => null);
  if (!context?.client) notFound();
  const { user, year, years, scope, firma } = context;
  const [sent, canSend, folder] = await Promise.all([
    prisma.primljeniDokument.findMany({ where: { ...scope, poslao_id: user.id, status: { not: "UPLOAD" } },
      orderBy: { created_at: "desc" } }),
    hasPermission(user, { firmaId: firma.id, modul: "dokumentacija", akcija: "create" }),
    prisma.dokumentaFolder.findFirst({ where: { firma_id: firma.id, agencija_id: scope.agencija_id }, select: { firma_id: true } })
  ]);
  const supplement = sent.find(doc => doc.id === query.dopuna && doc.status === "DOPUNA");
  return <div className="admin-stack">
    <header className="admin-header"><div><h2>Dokumentacija</h2><p>{firma.naziv} · {year.godina}</p></div></header>
    <form method="get" className="admin-form">
      <label>Poslovna godina<select name="godina" defaultValue={year.id}>{years.map(item => <option key={item.id} value={item.id}>{item.godina}</option>)}</select></label>
      <button type="submit">Izaberi godinu</button>
    </form>
    {canSend && folder ? <DokumentaUpload key={`${year.id}:${supplement?.id ?? ""}`} yearId={year.id} categories={dokumentaKategorije}
      supplement={supplement ? { id: supplement.id, category: supplement.kategorija, comment: supplement.zahtjev_dopune ?? "" } : undefined} />
      : <p>Slanje dokumentacije trenutno nije dostupno.</p>}
    <section className="admin-panel"><h3>Poslato</h3>
      <ul>{sent.map(doc => <li key={doc.id}>
        <a href={`/api/dokumentacija/original?id=${doc.id}`} target="_blank" rel="noreferrer">{doc.naziv}</a>
        {" · "}{doc.created_at.toLocaleDateString("sr-Latn", { timeZone: "Europe/Podgorica" })}{" · "}
        {doc.status === "ARHIVIRANO" ? "Obrađeno" : doc.status === "DOPUNA" ? "Potrebna dopuna" : "Primljeno"}
        {doc.zahtjev_dopune && <p>{doc.zahtjev_dopune}</p>}
        {doc.status === "DOPUNA" && <Link href={`?godina=${year.id}&dopuna=${doc.id}`}>Pošalji dopunu</Link>}
      </li>)}</ul>
    </section>
  </div>;
}
