export type CbcgCompany = {
  account: string;
  name: string;
  pib: string;
  address: string;
  city: string;
};

// CBCG uses three domestic BBAN fields; a printed middle part may be zero-padded.
export function cbcgAccountParts(value: string) {
  const clean = value.trim();
  const parts = clean.match(/^(\d{3})\s*-\s*(\d{1,13})\s*-\s*(\d{2})$/)
    ?? clean.replace(/\s/g, "").match(/^(\d{3})(\d{1,13})(\d{2})$/);
  if (!parts) return null;
  const middle = parts[2].replace(/^0+(?=\d)/, "");
  if (middle === "0") return null;
  return { bank: parts[1], middle, check: parts[3], account: `${parts[1]}-${middle}-${parts[3]}` };
}

export function validateCbcgCompany(value: unknown, account: string): CbcgCompany | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const expected = cbcgAccountParts(account);
  const received = typeof data.account === "string" ? cbcgAccountParts(data.account) : null;
  if (!expected || expected.account !== received?.account) return null;
  for (const field of ["name", "pib", "address", "city"]) {
    if (typeof data[field] !== "string" || (data[field] as string).length > 1000) return null;
  }
  if (!(data.name as string).trim() || !/^\d{8}$/.test(data.pib as string)) return null;
  return {
    account: expected.account, name: (data.name as string).trim(), pib: data.pib as string,
    address: (data.address as string).trim(), city: (data.city as string).trim()
  };
}

export function lookupCbcgThroughBrowser(account: string, signal?: AbortSignal) {
  const parts = cbcgAccountParts(account);
  if (!parts) return Promise.reject(new Error("CBCG pretraga traži domaći žiro račun (npr. 530-19109-13)."));
  const requestedAccount = parts.account;
  const requestId = `cbcg-${crypto.randomUUID()}`;
  return new Promise<CbcgCompany>((resolve, reject) => {
    let started = false;
    let finished = false;
    const post = (type: string) => window.postMessage({ type, requestId, account: requestedAccount }, window.location.origin);
    const probeTimer = window.setTimeout(() => finish(new Error(
      "Učitajte ili osvježite ekstenziju Summa IRMS i CBCG pretraga, pa osvježite ovu stranicu."
    )), 1000);
    const timeout = window.setTimeout(() => finish(new Error("CBCG pretraga je istekla. Pokušajte ponovo.")), 5 * 60_000);
    function finish(error?: Error, data?: CbcgCompany) {
      if (finished) return;
      finished = true;
      window.clearTimeout(probeTimer);
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      if (started) post(error ? "SUMMA_CBCG_CANCEL" : "SUMMA_CBCG_ACK");
      if (error) reject(error);
      else if (data) resolve(data);
    }
    function onAbort() { finish(new DOMException("Pretraga je otkazana.", "AbortError")); }
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (event.data?.type === "SUMMA_CBCG_EXTENSION_READY" && !started) {
        started = true;
        window.clearTimeout(probeTimer);
        post("SUMMA_CBCG_LOOKUP");
        return;
      }
      if (!started || event.data?.requestId !== requestId) return;
      if (event.data?.type === "SUMMA_CBCG_RESULT") {
        const data = validateCbcgCompany(event.data.data, requestedAccount);
        if (data) finish(undefined, data);
        else finish(new Error("CBCG rezultat ne odgovara traženom računu ili nema ispravan PIB."));
      } else if (event.data?.type === "SUMMA_CBCG_ERROR") {
        finish(new Error(String(event.data.message ?? "CBCG pretraga nije uspjela.")));
      }
    }
    window.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    else post("SUMMA_CBCG_EXTENSION_PROBE");
  });
}
