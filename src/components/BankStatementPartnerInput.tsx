"use client";

import { useEffect, useRef, useState } from "react";
import { PartnerSearchInput, type PartnerResult } from "@/components/PartnerSearchInput";
import { QuickPartnerCreateModal } from "@/components/QuickPartnerCreateModal";
import { cbcgAccountParts, lookupCbcgThroughBrowser, type CbcgCompany } from "@/lib/cbcg-browser-bridge";

type Props = {
  account: string | null;
  disabled: boolean;
  initialPartner: PartnerResult | null;
  // In the statement's read view the surrounding form saves only this row.
  compact?: boolean;
};

export function BankStatementPartnerInput({ account, disabled, initialPartner, compact = false }: Props) {
  const [externalPartner, setExternalPartner] = useState(initialPartner);
  const [selected, setSelected] = useState(initialPartner);
  const [result, setResult] = useState<CbcgCompany | null>(null);
  const [matches, setMatches] = useState<PartnerResult[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  function choose(partner: PartnerResult) {
    request.current?.abort();
    setExternalPartner(partner);
    setSelected(partner);
    setMatches([]);
    setNotFound(false);
    setCreating(false);
    setStatus(compact ? "Provjerite partnera pa kliknite Poveži partnera." : "Partner je izabran. Sačuvajte predlog naloga.");
  }
  async function lookup() {
    if (disabled || !account || (request.current && !request.current.signal.aborted && busy)) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setResult(null);
    setMatches([]);
    setNotFound(false);
    setStatus("Otvoren je CBCG tab. Ako prikaže poruku, potvrdite OK i sačekajte rezultat (do 5 minuta).");
    try {
      const data = await lookupCbcgThroughBrowser(account, controller.signal);
      if (controller.signal.aborted) return;
      setResult(data);
      const response = await fetch(`/api/partners/search?q=${encodeURIComponent(data.pib)}&exactPib=1`, { signal: controller.signal });
      if (!response.ok) throw new Error("CBCG podaci su preuzeti, ali pretraga partnera nije dostupna. Pokušajte ponovo.");
      const payload = await response.json() as { results?: PartnerResult[] };
      if (controller.signal.aborted) return;
      const found = (payload.results ?? []).filter(partner => partner.pib === data.pib);
      if (found.length === 1) choose(found[0]);
      else if (found.length > 1) {
        setMatches(found);
        setStatus("Više dostupnih partnera ima ovaj PIB. Izaberite odgovarajućeg.");
      } else {
        setNotFound(true);
        setStatus("Partner nije pronađen. Provjerite preuzete podatke prije čuvanja novog partnera.");
        setCreating(true);
      }
    } catch (error) {
      if (!controller.signal.aborted) setStatus(error instanceof Error ? error.message : "CBCG pretraga nije uspjela.");
    } finally {
      if (request.current === controller) setBusy(false);
    }
  }

  return <div className="statement-cbcg-lookup">
    {!compact || selected || result ? <PartnerSearchInput
      disabled={disabled}
      initialPartner={externalPartner}
      label=""
      name="partner_id"
      onPartnerChange={partner => {
        request.current?.abort();
        setBusy(false);
        setSelected(partner);
        setStatus("");
        setMatches([]);
      }}
    /> : <input name="partner_id" type="hidden" value="" />}
    {!disabled && !selected && cbcgAccountParts(account ?? "") ? <button
      className="table-link" disabled={busy} type="button" title={`Pronađi vlasnika računa ${account} na CBCG`}
      onClick={() => void lookup()}
    >{busy ? "CBCG pretraga..." : "CBCG"}</button> : null}
    {busy ? <button type="button" className="table-link" onClick={() => {
      request.current?.abort(); setBusy(false); setStatus("CBCG pretraga je otkazana.");
    }}>Odustani</button> : null}
    {status ? <p className="partner-search-status" role="status">{status}</p> : null}
    {result ? <small>CBCG: {result.name} · PIB {result.pib}<br />{[result.address, result.city].filter(Boolean).join(", ")}</small> : null}
    {matches.map(partner => <button key={partner.id} className="table-link" type="button" onClick={() => choose(partner)}>
      {partner.label} · {partner.scope}
    </button>)}
    {result && notFound && !selected && !busy ? <button className="table-link" type="button" onClick={() => setCreating(true)}>Novi partner iz CBCG podataka</button> : null}
    {compact && selected ? <button className="table-link" disabled={disabled} type="submit">Poveži partnera</button> : null}
    {creating && result ? <QuickPartnerCreateModal
      initialName={result.name} initialPib={result.pib} initialAddress={result.address}
      initialCity={result.city} initialAccountNumber={account ?? ""}
      onClose={() => setCreating(false)} onCreated={choose}
    /> : null}
  </div>;
}
