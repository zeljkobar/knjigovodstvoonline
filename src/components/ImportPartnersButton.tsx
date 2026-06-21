"use client";

import { useActionState } from "react";
import { runGlobalPartnerImport, type ImportResult } from "@/app/admin/actions";

const initialState: ImportResult = { ok: false };

export function ImportPartnersButton() {
  const [result, action, isPending] = useActionState(runGlobalPartnerImport, initialState);

  return (
    <div className="import-partners-section">
      <div className="panel-header">
        <h3>Import iz stare baze</h3>
      </div>
      <p className="import-partners-desc">
        Povlači nove globalne partnere iz MySQL baze starog sajta. Postojeći partneri se ne
        mijenjaju — dodaju se samo oni kojih nema (po PIB-u).
      </p>
      <form action={action}>
        <button className="primary-btn" disabled={isPending} type="submit">
          {isPending ? "Import u toku..." : "Pokreni import"}
        </button>
      </form>
      {!isPending && result.ok && result.inserted !== undefined ? (
        <p className="import-result import-result--ok">
          Završeno: <strong>{result.inserted}</strong> novo dodato,{" "}
          <strong>{result.skipped}</strong> preskočeno (ukupno {result.total} kandidata u izvoru).
        </p>
      ) : null}
      {!isPending && !result.ok && result.error ? (
        <p className="import-result import-result--error">Greška: {result.error}</p>
      ) : null}
    </div>
  );
}
