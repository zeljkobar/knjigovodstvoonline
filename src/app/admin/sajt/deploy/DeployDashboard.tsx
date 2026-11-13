"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { backupDate } from "@/lib/backup-status";
import { deployPhases, deploySites, deployBlockReasons, type DeploySite, type DeploySnapshot } from "@/lib/deploy-status";
import { getDeployStatus, startDeploy } from "./actions";
import styles from "./deploy.module.css";

export function DeployDashboard({ initial, requestId }: { initial: DeploySnapshot; requestId: string }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [selectedSite, setSelectedSite] = useState<DeploySite>("knjigovodstvoonline");
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
    const id = setInterval(() => { if (!document.hidden) void refresh(); }, snapshot.available && snapshot.catalog.running ? 5000 : 30000);
    return () => clearInterval(id);
  }, [refresh, snapshot]);
  useEffect(() => {
    if (!action.message) return;
    void refresh();
    if (!action.error) setFormId(crypto.randomUUID());
  }, [action, refresh]);
  const catalog = snapshot.available ? snapshot.catalog : null;
  const status = catalog?.sites.find(site => site.site === selectedSite) || null;
  const site = deploySites.find(site => site.id === selectedSite)!;
  const busy = Boolean(catalog?.running);
  const activeName = deploySites.find(site => site.id === catalog?.activeSite)?.name;
  const visibleAction = action.site === selectedSite || !action.site ? action : null;
  const title = !status ? "Status nije dostupan" : status.running ? "Deploy je u toku" : status.outcome === "succeeded" ? "Posljednji deploy je uspješan" : status.outcome === "failed" ? "Deploy nije završen uspješno" : !status.ready ? "Sajt trenutno nije spreman" : "Spremno za deploy";
  const failed = status?.outcome === "failed";
  const currentPhase = status ? deployPhases[status.phase] : null;
  return <div className="admin-stack">
    <header className="admin-header">
      <div><p className="eyebrow">Admin sajta</p><h2>Deploy sajta</h2><p>Izaberite sajt koji želite da ažurirate.</p></div>
      <div className={styles.actions}>
        <button className="secondary-button" type="button" onClick={() => void refresh()} disabled={refreshing}>{refreshing ? "Osvježavam…" : "Osvježi status"}</button>
        <form action={submit}>
          <input type="hidden" name="request_id" value={formId} /><input type="hidden" name="site" value={selectedSite} />
          <button className="primary-button" disabled={pending || !status?.ready || busy}>{pending ? "Pokrećem…" : busy ? "Deploy u toku…" : `Pokreni deploy: ${site.name}`}</button>
        </form>
      </div>
    </header>
    <section className={`admin-panel ${styles.selection}`}>
      <label htmlFor="deploy-site">Sajt za deploy</label>
      <select id="deploy-site" value={selectedSite} disabled={pending} onChange={event => { setSelectedSite(event.target.value as DeploySite); setFormId(crypto.randomUUID()); }}>
        {deploySites.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
      </select>
      <p>{site.description}</p>
    </section>
    {visibleAction?.message ? <p className={`status-banner ${visibleAction.error ? "error" : "success"}`} role={visibleAction.error ? "alert" : "status"}>{visibleAction.message}</p> : null}
    {busy ? <p className="status-banner" role="status">Deploy je u toku: <strong>{activeName || "serverski posao"}</strong>. Drugi deploy možete pokrenuti kada se ovaj završi.</p> : null}
    <section className={`admin-panel ${styles.status}`} aria-live="polite">
      <h3>{site.name} — {title}</h3>
      {!snapshot.available ? <p>{snapshot.message}</p> : !status?.ready ? <p>{status?.blockReason ? deployBlockReasons[status.blockReason] : "Provjerite serverska podešavanja za ovaj sajt."}</p> : null}
      {status && (status.running || failed) ? <p><strong>Korak:</strong> {currentPhase}</p> : null}
      {failed ? <p className={styles.error}>{status?.error === "backup_failed" ? "Lokalna kopija baze nije potvrđena. Deploy i migracije nijesu pokrenuti." : "Postupak je zaustavljen. Provjerite uzrok prije novog pokretanja; već primijenjene migracije nijesu automatski vraćene."}</p> : null}
      {status?.backup ? <div>
        <p><strong>Lokalni backup:</strong> {status.backup.local === "not_required" ? "Ovaj sajt nema bazu podataka." :
          status.backup.retained ? `Provjeren — ${status.backup.database}, ${backupDate(status.backup.createdAt)}.` : "Kopija je uklonjena po isteku perioda čuvanja."}</p>
        {status.backup.cloud !== "not_required" ? <p role={status.backup.cloud === "warning" ? "alert" : "status"}>
          <strong>OneDrive:</strong> {status.backup.cloud === "verified" ? `Slanje i provjera završeni ${backupDate(status.backup.uploadedAt)}.` :
            status.backup.cloud === "warning" ? "Slanje ili provjera nijesu uspjeli. Lokalna kopija je sačuvana; slanje će se automatski ponoviti. Ovo ne zaustavlja deploy." :
              status.backup.cloud === "uploading" ? "Slanje i provjera su u toku, nezavisno od deploya." : "Kopija čeka slanje. Deploy može da nastavi."}
        </p> : null}
      </div> : null}
      <dl className={styles.details}>
        <div><dt>Posljednji uspješan deploy iz panela</dt><dd>{backupDate(status?.lastSuccess?.at || null)}</dd></div>
        <div><dt>Verzija posljednjeg uspješnog deploya</dt><dd>{status?.lastSuccess?.commit.slice(0, 8) || "—"}</dd></div>
        <div><dt>Početak posljednjeg posla</dt><dd>{backupDate(status?.startedAt || null)}</dd></div>
        <div><dt>Završetak posljednjeg posla</dt><dd>{backupDate(status?.finishedAt || null)}</dd></div>
      </dl>
    </section>
    <section className="admin-panel">
      <h3>Deploy za {site.name}</h3>
      <ol className={styles.steps}>
        <li>{selectedSite === "royalservices" ? "Sajt nema bazu podataka, pa backup baze nije potreban." : "Pravi i provjerava novu lokalnu kopiju samo baze izabranog sajta. Ako kopija ne uspije, deploy se zaustavlja."}</li>
        {selectedSite !== "royalservices" ? <li>Šalje šifrovanu kopiju na OneDrive odvojeno. Neuspjeh slanja prikazuje upozorenje i automatski ponavlja pokušaj, bez zaustavljanja deploya.</li> : null}
        <li>Pokreće deploy postupak izabranog sajta. Migracije se izvršavaju tamo gdje su dio tog postupka.</li>
        <li>Provjerava završetak postupka i dostupnost izabranog sajta.</li>
      </ol>
      <p>Noćni backup četiri PostgreSQL baze u 03:00 ostaje zaseban postupak.</p>
      <p>Tokom deploya aplikacija može biti privremeno nedostupna. Serverski posao nastavlja rad i kada zatvorite ovu stranicu.</p>
      <small>Posljednja provjera: {backupDate(status?.checkedAt || null)}. Vrijeme Crne Gore.</small>
    </section>
  </div>;
}
