import { requireImapAgency } from "../imap/access";
import { prisma } from "@/lib/prisma";

export default async function AutomationPage() {
  const user = await requireImapAgency();
  const runs = await prisma.auditLog.findMany({ where: { agencija_id: user.agencija_id!, akcija: "AUTO_BANK_RUN" }, orderBy: { created_at: "desc" }, take: 100, include: { firma: { select: { naziv: true } } } });
  const enabled = process.env.BANK_AUTOMATION_ENABLED === "true" && process.env.NODE_ENV === "production";
  return <div className="admin-stack"><header className="admin-header"><h2>Automatska obrada izvoda</h2></header>
    <section className="admin-panel"><p>{enabled ? "Uključeno — svakog dana u 10:00 po vremenu Crne Gore." : "Automatska obrada nije uključena na ovom serveru."}</p><p>Obrađuju se samo aktivne firme sa uključenim mailom i podešenim izvorom. Knjiže se samo spremni izvodi preuzeti iz maila. Greške ostaju za provjeru. Ako je server bio ugašen u 10:00, obrada se pokreće nakon njegovog uključivanja istog dana.</p></section>
    <section className="admin-panel"><h3>Posljednje obrade po firmama</h3><div className="table-wrap"><table><thead><tr><th>Datum</th><th>Firma</th><th>Uvezeno</th><th>Proknjiženo</th><th>Za provjeru</th><th>Napomena</th></tr></thead><tbody>{runs.map(run => {
      const result = run.nova_vrijednost as { day?: string; imported?: number; posted?: number; review?: number; errors?: string[] } | null;
      return <tr key={run.id}><td>{run.created_at.toLocaleString("sr-Latn-ME", { timeZone: "Europe/Podgorica" })}</td><td>{run.firma?.naziv ?? "Firma"}</td><td>{result?.imported ?? 0}</td><td>{result?.posted ?? 0}</td><td>{(result?.review ?? 0) + (result?.errors?.length ?? 0)}</td><td>{result?.errors?.join(" ") || ((result?.review ?? 0) ? "Provjerite statuse mailova." : "Završeno")}</td></tr>;
    })}{!runs.length && <tr><td colSpan={6}>Još nema automatskih obrada.</td></tr>}</tbody></table></div></section>
  </div>;
}
