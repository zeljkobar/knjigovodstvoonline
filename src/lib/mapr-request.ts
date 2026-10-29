// MAPR rejects fractional seconds (HTTP 404), including Date.toISOString()'s .000Z.
// Keep the original offset and instant; only adapt the wire format.
export function dateTimeForMapr(crtd: string) {
  return crtd.trim().replace(/\.\d+(?=Z$|[+ -]\d{2}:\d{2}$)/, "").replace(/\+(\d{2}:\d{2})$/, " $1");
}

export function maprHttpError(status: number) {
  if (status === 404) return "MAPR nije pronašao račun ili nije prihvatio podatke za provjeru (HTTP 404). Provjerite fiskalni link.";
  if (status === 429) return "MAPR je privremeno ograničio broj zahtjeva (HTTP 429). Pokušajte kasnije.";
  return `MAPR provjera nije uspjela (HTTP ${status}). Pokušajte kasnije.`;
}
