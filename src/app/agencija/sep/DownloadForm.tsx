"use client";
import { useState, type FormEvent } from "react";
export function DownloadForm({ firmId, from, to }: { firmId: string; from: string; to: string }) {
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true); setMessage("Prijava na SEP i preuzimanje računa…");
    try {
      const response = await fetch("/agencija/sep/preuzmi", { method: "POST", body: data });
      if (!response.ok) {
        const result = await response.json();
        setMessage(result.error ?? "Preuzimanje nije uspjelo."); return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "SEP-racuni.xlsx";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setMessage(`Excel je preuzet. Broj računa: ${response.headers.get("X-SEP-Count") ?? "—"}.`);
    } catch { setMessage("Preuzimanje nije uspjelo. Provjerite vezu i pokušajte ponovo."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={download} className="admin-form">
    <input type="hidden" name="firma_id" value={firmId}/>
    <label><span>Datum fiskalizacije od</span><input type="date" name="od" defaultValue={from} required disabled={busy}/></label>
    <label><span>Datum fiskalizacije do</span><input type="date" name="do" defaultValue={to} required disabled={busy}/></label>
    <div className="form-wide"><button type="submit" disabled={busy}>{busy ? "Preuzimanje…" : "Preuzmi Excel sa SEP-a"}</button></div>
    {message ? <p role="status" className="form-wide admin-message">{message}</p> : null}
  </form>;
}
