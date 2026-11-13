"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { backupDatabases, backupDate, backupRowState, backupSize, type BackupSnapshot } from "@/lib/backup-status";
import { getBackupStatus, startBackup } from "./actions";
import styles from "./backup.module.css";

export function BackupDashboard({ initial, requestId }: { initial: BackupSnapshot; requestId: string }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [refreshing, setRefreshing] = useState(false);
  const [formId, setFormId] = useState(requestId);
  const [action, submit, pending] = useActionState(startBackup, { message: "" });
  const mounted = useRef(true), inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const next = await getBackupStatus();
      if (mounted.current) setSnapshot(next);
    } catch {
      if (mounted.current) setSnapshot({ available: false, message: "Status nije mogao biti osvježen. Provjerite vezu i prijavu." });
    } finally {
      inFlight.current = false;
      if (mounted.current) setRefreshing(false);
    }
  }, []);
  const status = snapshot.available ? snapshot.status : null;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, status?.running || pending ? 5000 : 30000);
    return () => clearInterval(timer);
  }, [refresh, status?.running, pending]);
  useEffect(() => {
    if (!action.message) return;
    void refresh();
    // Keep uncertain/error requests idempotent. Successful responses permit a later new request.
    if (!action.error) setFormId(crypto.randomUUID());
  }, [action, refresh]);
  const healthy = status?.databases.filter(row => backupRowState(row, status).tone === "success").length || 0;
  const summary = !status ? "Status trenutno nije dostupan" : status.running ? "Backup je u toku" : status.retryPending ? "Čeka se ponovni pokušaj" : status.serviceFailed || healthy < 4 || !status.scheduler.active || !status.scheduler.enabled ? "Potrebna je provjera" : "Kopije su ažurne";
  const tone = !status ? "warning" : status.running ? "info" : status.serviceFailed ? "error" : healthy === 4 && status.scheduler.active && status.scheduler.enabled ? "success" : "warning";

  return <div className={`admin-stack ${styles.dashboard}`}>
    <header className="admin-header">
      <div><p className="eyebrow">Admin sajta</p><h2>Backup baze</h2><p>Sigurnosne kopije sve četiri produkcijske baze.</p></div>
      <div className={styles.actions}>
        <button className={`secondary-button ${styles.secondary}`} type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Osvježavam…" : "Osvježi status"}</button>
        <form action={submit}><input type="hidden" name="request_id" value={formId} /><button className="primary-button" type="submit" disabled={pending || !status || status.running}>{pending ? "Pokrećem…" : status?.running ? "Backup u toku…" : "Pokreni backup sada"}</button></form>
      </div>
    </header>

    {action.message ? <p role={action.error ? "alert" : "status"} className={`status-banner ${action.error ? "error" : "success"}`}>{action.message}</p> : null}
    <section className={`${styles.summary} ${styles[tone]}`} aria-live="polite">
      <div><span className={styles.kicker}>Ukupni status</span><h3>{summary}</h3>
        <p>{!snapshot.available ? snapshot.message : status?.running ? "Pravljenje, šifrovanje, slanje na OneDrive i provjera kopija su u toku." : status?.retryPending ? "Prethodni pokušaj nije uspio. Server će pokušati ponovo prema rasporedu ponavljanja." : "OneDrive status prikazuje posljednje uspješno slanje i provjeru preuzete kopije."}</p>
      </div>
      {status ? <span className={styles.count}>{healthy} / 4 <small>{status.running ? "završene" : "ažurne kopije"}</small></span> : null}
    </section>

    <section className={styles.metrics} aria-label="Raspored i čuvanje">
      <div className="metric"><span>Noćni backup</span><strong className="metric-text">Svake noći u 03:00</strong><small>{status ? status.scheduler.active && status.scheduler.enabled ? "Raspored je aktivan" : "Raspored nije aktivan — potrebna provjera" : "Aktivnost rasporeda nije provjerena"} · Crna Gora</small></div>
      <div className="metric"><span>Sljedeći zakazani backup</span><strong className="metric-text">{backupDate(status?.scheduler.nextRunAt || null)}</strong><small>Ručno pokretanje ne mijenja noćni raspored.</small></div>
      <div className="metric"><span>Čuvanje kopija</span><strong className="metric-text">30 dana</strong><small>Na serveru i OneDrive-u. Stare kopije se brišu poslije provjere nove.</small></div>
    </section>

    <section className={styles.cards} aria-label="Status baza">
      {backupDatabases.map(database => {
        const row = status?.databases.find(item => item.database === database.id);
        const state = row && status ? backupRowState(row, status) : { text: "Status nije dostupan", tone: "warning" as const };
        return <article className={`admin-panel ${styles.card}`} key={database.id}>
          <div className={styles.cardHeader}><div><h3>{database.label}</h3><span className={styles.database}>{database.id}</span></div><span className={`${styles.badge} ${styles[state.tone]}`}>{state.text}</span></div>
          <dl>
            <div><dt>Posljednja uspješna OneDrive kopija</dt><dd>{backupDate(row?.lastSuccess?.verifiedAt || null)}</dd></div>
            <div><dt>Veličina šifrovane kopije</dt><dd>{row?.lastSuccess ? backupSize(row.lastSuccess.bytes) : "—"}</dd></div>
            <div><dt>OneDrive folder</dt><dd>Summa backup / {database.folder}</dd></div>
          </dl>
          {row?.lastAttempt?.ok === false && !(status?.running && row.phase === "done") ? <p className={styles.failure}>Pokušaj od {backupDate(row.lastAttempt.finishedAt)} nije završen uspješno. Prethodna potvrđena kopija je prikazana iznad.</p> : null}
          {row?.lastSuccess ? <details><summary>Naziv posljednje kopije</summary><p className={styles.filename}>{row.lastSuccess.filename}</p></details> : null}
        </article>;
      })}
    </section>
    <section className={`admin-panel ${styles.footer}`}>
      <p><strong>Posljednja uspješna provjera vraćanja baza:</strong> {backupDate(status?.lastRestoreAt || null)}</p>
      <p>Kopije su šifrovane. Ključ za njihovo otvaranje čuvajte odvojeno. Ručno pokretanje pravi kopije sve četiri baze.</p>
      <small>Posljednje osvježavanje: {backupDate(status?.checkedAt || null)}. Sva vremena su prikazana po vremenu Crne Gore. Prikaz se automatski osvježava.</small>
    </section>
  </div>;
}
