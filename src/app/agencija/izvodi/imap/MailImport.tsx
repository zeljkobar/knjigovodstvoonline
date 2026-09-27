"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { discoverMailImport } from "./import-actions";
import { importBankStatementMailMessage } from "../actions";

const labels: Record<string, string> = { IMPORTED: "Uvezen", DUPLICATE: "Već postoji", REVIEW: "Potrebna provjera", ERROR: "Greška", SKIPPED: "Preskočen" };
export default function MailImport({ firmaId, yearId, disabled }: { firmaId: string; yearId: string; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof importBankStatementMailMessage>>>([]);
  const stopped = useRef(false);
  async function start() {
    if (busy) return;
    stopped.current = false; setBusy(true); setResults([]); setMessage("Traženje izvoda u podešenim folderima i INBOX-u…");
    try {
      const found = await discoverMailImport(firmaId, yearId);
      if (!found.references) { setMessage(found.error || "Uvoz nije moguće pokrenuti."); return; }
      let completed = 0;
      for (const ref of found.references) {
        if (stopped.current) break;
        setMessage(`Obrada poruke ${completed + 1} od ${found.references.length}…`);
        const batch = await importBankStatementMailMessage({ ...ref, firmaId, yearId });
        setResults((items) => [...items, ...batch]); completed++;
      }
      setMessage(`${stopped.current ? "Zaustavljeno" : "Završeno"}: obrađeno ${completed} od ${found.references.length} poruka. Izvodi nijesu proknjiženi.`);
      router.refresh();
    } catch { setMessage("Obrada je prekinuta. Osvježite stranicu i provjerite firmu, godinu i pristup. Ponovni pokušaj neće duplirati uvezene izvode."); }
    finally { setBusy(false); }
  }
  return <section className="admin-panel" style={{ minWidth: 0 }}>
    <button type="button" className="primary-button" disabled={busy || disabled} onClick={start}>Uvezi nove izvode iz maila</button>
    {busy && <button type="button" className="secondary-button" onClick={() => { stopped.current = true; setMessage("Zaustavljanje nakon tekuće poruke…"); }}>Zaustavi</button>}
    <p>Uvoz iz svih podešenih izvora, uz provjeru računa firme i duplikata. Primjenjuju se postojeća pravila obrade; knjiženje pokrećete iz Pregleda izvoda.</p>
    {disabled && <p>Za uvoz izaberite otvorenu poslovnu godinu i provjerite pravo unosa izvoda.</p>}
    <p role="status" aria-live="polite">{message}</p>
    {results.length > 0 && <ul>{results.map((result, i) => <li key={i} style={{ overflowWrap: "anywhere" }}>
      {result.filename}: <strong>{labels[result.status]}</strong>{result.reason && ` — ${result.reason}`}
      {result.statementId && <> · <Link href={`/agencija/izvodi?izvod=${result.statementId}`}>Otvori izvod</Link></>}
    </li>)}</ul>}
  </section>;
}
