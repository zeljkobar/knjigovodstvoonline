export type IrmsBrowserCompany = {
  address?: string;
  activity?: string;
  city?: string;
  directors?: Array<{ fullName?: string; role?: string }>;
  email?: string;
  founded?: string;
  legalForm?: string;
  legalName?: string;
  name?: string;
  phone?: string;
  pib?: string;
  registrationNumber?: string;
  shortName?: string;
  status?: string;
  webAddress?: string;
};

export async function lookupIrmsThroughBrowser(pib: string) {
  const requestId = `irms-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise<IrmsBrowserCompany>((resolve, reject) => {
    let lookupStarted = false;
    const probeTimeout = window.setTimeout(() => finish(new Error("IRMS_EXTENSION_NOT_AVAILABLE")), 500);
    const lookupTimeout = window.setTimeout(() => finish(new Error("IRMS pretraga je istekla. Pokušajte ponovo.")), 60000);

    function cleanup() {
      window.clearTimeout(probeTimeout);
      window.clearTimeout(lookupTimeout);
      window.removeEventListener("message", onMessage);
    }
    function finish(error?: Error, data?: IrmsBrowserCompany) {
      cleanup();
      if (error) reject(error);
      else if (data) resolve(data);
    }
    function onMessage(event: MessageEvent) {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (event.data?.type === "SUMMA_IRMS_EXTENSION_READY" && !lookupStarted) {
        lookupStarted = true;
        window.clearTimeout(probeTimeout);
        window.postMessage({ type: "SUMMA_IRMS_LOOKUP", requestId, pib }, window.location.origin);
        return;
      }
      if (event.data?.requestId !== requestId) return;
      if (event.data?.type === "SUMMA_IRMS_RESULT" && event.data.data) finish(undefined, event.data.data);
      else if (event.data?.type === "SUMMA_IRMS_ERROR") finish(new Error(String(event.data.message ?? "IRMS pretraga nije uspjela.")));
    }

    window.addEventListener("message", onMessage);
    window.postMessage({ type: "SUMMA_IRMS_EXTENSION_PROBE" }, window.location.origin);
  });
}

export async function lookupIrmsCompany(pib: string) {
  try {
    return await lookupIrmsThroughBrowser(pib);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "IRMS_EXTENSION_NOT_AVAILABLE") {
      throw error;
    }
  }

  const response = await fetch("/api/irms/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pib })
  });
  const result = (await response.json()) as {
    data?: IrmsBrowserCompany;
    message?: string;
  };

  if (!response.ok || !result.data) {
    throw new Error(result.message ?? "Podaci nisu pronađeni u IRMS-u.");
  }

  return result.data;
}
