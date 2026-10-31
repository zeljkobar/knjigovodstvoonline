"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
export type ImportedPazarForm = { periodType: string; periodFrom: string; periodTo: string; cashRegister: string; reportNumber: string; total: string; taxLines: Array<{ vatRateId: string; taxBase: string; vatAmount: string }>; payments: Array<{ method: string; amount: string }> };
export function PazarImportPanel({ bookId, companyId, month, disabled, onImport, onBusyChange }: { bookId: string; companyId: string; month: string; disabled: boolean; onImport: (data: ImportedPazarForm, token: string) => void; onBusyChange: (busy: boolean) => void }) {
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Podgorica", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const end = last < today ? last : today < `${month}-01` ? `${month}-01` : today;
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [devices, setDevices] = useState<Array<{ id: string; label: string }>>([]), [device, setDevice] = useState(""), [provider, setProvider] = useState("");
  const [mode, setMode] = useState("MONTH"), [from, setFrom] = useState(`${month}-01`), [to, setTo] = useState(end);
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null);
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url); }, [download]);
  async function loadDevices() {
    setOpen(true); setBusy(true); onBusyChange(true); setMessage("");
    try { const response = await fetch(`/api/pazar-import/devices?firma=${companyId}`, { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.message); setDevices(data.devices); setProvider(data.provider); setDevice(data.defaultDevice && data.devices.some((d: { id: string }) => d.id === data.defaultDevice) ? data.defaultDevice : data.devices[0]?.id ?? ""); if (!data.devices.length) setMessage("Za ovu firmu nema dostupnih kasa."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Kase nije moguće učitati."); } finally { setBusy(false); onBusyChange(false); }
  }
  async function loadReport() {
    setBusy(true); onBusyChange(true); setMessage("");
    try {
      const response = await fetch("/api/pazar-import/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ bookId, companyId, deviceId: device, from, to }), cache: "no-store" });
      const data = await response.json(); if (!response.ok) throw new Error(data.message);
      const binary = atob(data.file.base64), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      setDownload({ url, name: data.file.name }); onImport(data.form, data.token);
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = data.file.name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setMessage("Izvještaj je preuzet i forma je popunjena. Provjerite podatke, pa unesite pazar u KIF.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Izvještaj nije moguće preuzeti."); } finally { setBusy(false); onBusyChange(false); }
  }
  return <section className="form-wide pazar-import-panel">
    <div className="panel-header"><div><h4>Uvoz fiskalnog izvještaja</h4><span>Popunjava formu i preuzima Excel na vaš računar.</span></div><button type="button" className="secondary-button" disabled={disabled || busy} onClick={loadDevices}>{busy ? "Učitavam…" : "Uvezi izvještaj"}</button></div>
    {open ? <div className="pazar-import-fields"><label>Kasa{provider ? ` · ${provider === "VG_EFISKAL" ? "VG eFiskal" : "Summa Fiskal"}` : ""}<select value={device} onChange={e => setDevice(e.target.value)} disabled={busy}><option value="">Izaberite kasu</option>{devices.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
      <label>Period<select value={mode} onChange={e => { setMode(e.target.value); if (e.target.value === "MONTH") { setFrom(`${month}-01`); setTo(end); } }} disabled={busy}><option value="MONTH">Mjesec KIF knjige · {month}</option><option value="RANGE">Izaberi datume</option></select></label>
      <label>Od<input type="date" min={`${month}-01`} max={end} value={from} onChange={e => setFrom(e.target.value)} disabled={busy || mode === "MONTH"}/></label><label>Do<input type="date" min={from} max={end} value={to} onChange={e => setTo(e.target.value)} disabled={busy || mode === "MONTH"}/></label>
      <button type="button" disabled={disabled || busy || !device || !from || !to || from > to} onClick={loadReport}>Preuzmi i popuni formu</button>
    </div> : null}
    {message ? <p className="admin-message" role="status">{message}</p> : null}
    {download ? <p><a href={download.url} download={download.name}>Preuzmi Excel ponovo</a></p> : null}
    <p><Link href="/agencija/racuni/fiskalni-portali">Podešavanja fiskalnih portala</Link></p>
  </section>;
}
