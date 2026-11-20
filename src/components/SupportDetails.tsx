"use client";

import { useState } from "react";

export function SupportDetails({ text }: { text: string }) {
  const [message, setMessage] = useState("");
  return <div>
    <label className="muted-text" htmlFor="support-details">Podaci za podršku</label>
    <textarea id="support-details" readOnly value={text} rows={8} style={{ width: "100%", margin: "12px 0", padding: 16, border: "1px solid var(--border)", borderRadius: 8, background: "var(--surface-blue)", color: "var(--foreground)", font: "inherit", resize: "vertical" }} />
    <button className="secondary-button" type="button" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setMessage("Podaci su kopirani. Dopunite opis problema prije slanja podršci."); }
      catch { setMessage("Označite tekst iznad i kopirajte ga ručno."); }
    }}>Kopiraj podatke za podršku</button>
    <p role="status" aria-live="polite">{message}</p>
  </div>;
}
