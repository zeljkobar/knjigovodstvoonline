import Link from "next/link";
import { Suspense } from "react";
import { scanStatementCloud, statementCloudFolders } from "@/lib/bank-statement-cloud";
import { hasPermission } from "@/lib/permissions";
import type { DokumentaScope } from "@/lib/dokumentacija";
import { getIzvodiContext, MissingContext } from "../_shared";
import { CloudStatements } from "./CloudStatements";

async function FolderStatements({ scope, year, bankId, canImport }: {
  scope: DokumentaScope; year: number; bankId: string; canImport: boolean;
}) {
  const folders = (await statementCloudFolders(scope)).filter(folder => folder.bankovni_racun_id === bankId);
  try {
    if (!folders.length) return <p>Izaberite povezani bankovni račun.</p>;
    const [group] = await scanStatementCloud(scope, year, folders);
    const count = (status: string) => group.rows.filter(row => row.status === status).length;
    return <>
      <p>{count("NEW")} čeka uvoz · {count("IMPORTED")} čeka knjiženje · {count("POSTED")} proknjiženo · {count("REVIEW")} za provjeru</p>
      <CloudStatements key={JSON.stringify([scope.firma_id, scope.poslovna_godina_id, bankId])}
        rows={group.rows} firmaId={scope.firma_id} yearId={scope.poslovna_godina_id} bankId={bankId} canImport={canImport} />
    </>;
  } catch {
    return <p role="alert">Povezani OneDrive folder trenutno nije dostupan.</p>;
  }
}

export default async function OneDriveStatementsPage({ searchParams }: { searchParams: Promise<{ banka?: string }> }) {
  const { user, firma, godina } = await getIzvodiContext();
  if (!user.agencija_id || !firma || !godina) return <MissingContext title="OneDrive izvodi" />;
  const scope = { agencija_id: user.agencija_id, firma_id: firma.id, poslovna_godina_id: godina.id };
  const [folders, params, canCreate] = await Promise.all([statementCloudFolders(scope), searchParams,
    hasPermission(user, { firmaId: firma.id, modul: "izvodi", akcija: "create" })]);
  const selected = folders.find(folder => folder.bankovni_racun_id === params.banka) ?? folders[0];
  return <div className="admin-stack">
    <header className="admin-header"><div><h2>OneDrive izvodi</h2><p>{firma.naziv} · {godina.godina}</p></div>
      <Link className="table-button" href="/agencija/izvodi">Pregled i knjiženje izvoda</Link>
    </header>
    <section className="admin-panel">
      {selected ? <>
        <form method="get" className="table-actions">
          <label>Bankovni račun <select name="banka" defaultValue={selected.bankovni_racun_id}>
            {folders.map(folder => <option key={folder.bankovni_racun_id} value={folder.bankovni_racun_id}>
              {folder.bankovni_racun.naziv_banke} · {folder.bankovni_racun.broj_racuna}
            </option>)}
          </select></label>
          <button className="secondary-button" type="submit">Prikaži izvode</button>
        </form>
        {godina.zakljucena && <p>Poslovna godina je zaključena.</p>}
        <Suspense key={JSON.stringify(scope) + selected.bankovni_racun_id} fallback={<p role="status">Provjera izvoda na OneDrive-u…</p>}>
          <FolderStatements scope={scope} year={godina.godina} bankId={selected.bankovni_racun_id} canImport={canCreate && !godina.zakljucena} />
        </Suspense>
      </> : <p>Za ovu godinu nema povezanog foldera. {user.rola === "admin_agencije" &&
        <Link href="/agencija/izvodi/podesavanja#onedrive-izvodi">Otvori podešavanja</Link>}</p>}
    </section>
  </div>;
}
