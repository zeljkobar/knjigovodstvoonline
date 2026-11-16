"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CloudRow } from "@/lib/bank-statement-cloud";
import { importOneDriveStatement } from "./actions";

const labels = { NEW: "Čeka uvoz", IMPORTED: "Čeka knjiženje", POSTED: "Proknjižen", REVIEW: "Za provjeru" };

export function CloudStatements({ rows, firmaId, yearId, bankId, canImport }: {
  rows: CloudRow[]; firmaId: string; yearId: string; bankId: string; canImport: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, { status: string; message: string }>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const available = rows.filter(row => row.status === "NEW" && (!results[row.id] || results[row.id].status === "ERROR"));

  async function importRows(items: CloudRow[]) {
    setProgress({ done: 0, total: items.length });
    try {
      for (const [index, row] of items.entries()) {
        let result;
        try {
          result = await importOneDriveStatement({ firmaId, yearId, bankId, itemId: row.id, version: row.version });
        } catch {
          result = { status: "ERROR", message: "Uvoz nije završen. Pokušajte ponovo." };
        }
        setResults(current => ({ ...current, [row.id]: result }));
        setProgress({ done: index + 1, total: items.length });
      }
    } finally {
      setProgress(null);
      router.refresh();
    }
  }

  return <>
    {canImport && <div className="table-actions">
      <button className="secondary-button" disabled={!!progress || !available.some(row => selected.includes(row.id))}
        onClick={() => void importRows(available.filter(row => selected.includes(row.id)))}>Uvezi izabrane</button>
      <button className="primary-button" disabled={!!progress || !available.length}
        onClick={() => void importRows(available)}>Uvezi sve nove ({available.length})</button>
    </div>}
    <p role="status">{progress ? `Obrađeno ${progress.done} od ${progress.total}` :
      Object.keys(results).length > 0 ? `Uvezeno ${Object.values(results).filter(result => result.status === "IMPORTED").length} u ovom pregledu` : ""}</p>
    {rows.length ? <div className="table-wrap"><table>
      <thead><tr>{canImport && <th>Izbor</th>}<th>Fajl</th><th>Broj izvoda</th><th>Status</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>
        {canImport && <td>{row.status === "NEW" && <input type="checkbox" aria-label={`Izaberi ${row.name}`}
          disabled={!!progress || (!!results[row.id] && results[row.id].status !== "ERROR")} checked={selected.includes(row.id)}
          onChange={event => setSelected(current => event.target.checked ? [...current, row.id] : current.filter(id => id !== row.id))} />}</td>}
        <td>{row.name}</td><td>{row.number || "—"}</td>
        <td>{labels[row.status]}{row.reason && ` · ${row.reason}`}
          {results[row.id] && <small>{results[row.id].message}</small>}</td>
      </tr>)}</tbody>
    </table></div> : <p>Nema podržanih izvoda u folderu.</p>}
  </>;
}
