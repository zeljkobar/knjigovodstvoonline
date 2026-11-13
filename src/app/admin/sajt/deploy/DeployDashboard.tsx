"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { backupDate } from "@/lib/backup-status";
import { deployPhases, type DeploySnapshot } from "@/lib/deploy-status";
import { getDeployStatus, startDeploy } from "./actions";
import styles from "./deploy.module.css";

export function DeployDashboard({ initial, requestId }: { initial: DeploySnapshot; requestId: string }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [formId, setFormId] = useState(requestId);
  const [action, submit, pending] = useActionState(startDeploy, { message: "" });
  const [refreshing, setRefreshing] = useState(false);
  const active = useRef(true), inFlight = useRef(false);
  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const next = await getDeployStatus();
      if (active.current) setSnapshot(next);
    } catch {
      if (active.current) setSnapshot({ available: false, message: "Veza sa aplikacijom je privremeno prekinuta. Pokrenuti deploy nastavlja rad na serveru. Sačekajte ponovno povezivanje; po potrebi osvježite stranicu." });
    } finally {
      inFlight.current = false;
      if (active.current) setRefreshing(false);
    }
  }, []);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    return () => clearInterval(id);
  }, [refresh]);
  useEffect(() => {
    if (!action.message) return;
    void refresh();
    if (!action.error) setFormId(crypto.randomUUID());
  }, [action, refresh]);
  const status = snapshot.available ? snapshot.status : null;
  const title = !status ? "Status nije dostupan" : status.running ? "Deploy je u toku" : status.outcome === "succeeded" ? "Posljednji deploy je uspješan" : status.outcome === "failed" ? "Deploy nije završen uspješno" : !status.ready ? "Potrebna je prva objava" : "Spremno za deploy";
  const failed = status?.outcome === "failed";
  const currentPhase = status ? deployPhases[status.phase] : null;
  return <div className="admin-stack">
    <header className="admin-header">
      <div><p className="eyebrow">Admin sajta</p><h2>Deploy sajta</h2><p>Knjigovodstvo online — deploy i migracije baze jednim dugmetom.</p></div>
      <div className={styles.actions}>
        <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Osvježavam…" : "Osvježi status"}</button>
        <form action={submit}><input type="hidden" name="request_id" value={formId} /><button className="primary-button" disabled={pending || !status?.ready || status.running}>{pending ? "Pokrećem…" : status?.running ? "Deploy u toku…" : "Pokreni deploy i migracije"}</button></form>
      </div>
    </header>
    {action.message ? <p className={`status-banner ${action.error ? "error" : "success"}`} role={action.error ? "alert" : "status"}>{action.message}</p> : null}
    <section className={`admin-panel ${styles.status}`} aria-live="polite">
      <h3>{title}</h3>
      {!snapshot.available ? <p>{snapshot.message}</p> : !status?.ready ? <p>Potrebno je prvo objaviti verziju aplikacije sa pripremljenom deploy skriptom na serveru.</p> : null}
      {status && (status.running || failed) ? <p><strong>Korak:</strong> {currentPhase}</p> : null}
      {failed ? <p className={styles.error}>{status?.error === "backup_failed" ? "Backup prije deploya nije potvrđen. Deploy i migracije nijesu pokrenuti." : "Postupak je zaustavljen. Provjerite uzrok prije novog pokretanja; već primijenjene migracije nijesu automatski vraćene."}</p> : null}
      <dl className={styles.details}>
        <div><dt>Posljednji uspješan deploy iz panela</dt><dd>{backupDate(status?.lastSuccess?.at || null)}</dd></div>
        <div><dt>Verzija posljednjeg uspješnog deploya</dt><dd>{status?.lastSuccess?.commit.slice(0, 8) || "—"}</dd></div>
        <div><dt>Početak posljednjeg posla</dt><dd>{backupDate(status?.startedAt || null)}</dd></div>
        <div><dt>Završetak posljednjeg posla</dt><dd>{backupDate(status?.finishedAt || null)}</dd></div>
      </dl>
    </section>
    <section className="admin-panel">
      <h3>Šta pokreće ovo dugme</h3>
      <ol className={styles.steps}>
        <li>Pravi backup i provjerava kopije na OneDrive-u.</li>
        <li>Preuzima novu verziju aplikacije sa glavne grane.</li>
        <li>Priprema aplikaciju i primjenjuje potrebne migracije baze.</li>
        <li>Pravi novu verziju sajta, restartuje aplikaciju i provjerava dostupnost.</li>
      </ol>
      <p>Tokom deploya aplikacija može biti privremeno nedostupna. Serverski posao nastavlja rad i kada zatvorite ovu stranicu.</p>
      <p>Ostali sajtovi dodaju se nakon provjere njihovih deploy skripti.</p>
      <small>Posljednja provjera: {backupDate(status?.checkedAt || null)}. Vrijeme Crne Gore.</small>
    </section>
  </div>;
}
