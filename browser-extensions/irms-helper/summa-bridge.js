window.postMessage({ type: "SUMMA_IRMS_EXTENSION_READY" }, window.location.origin);
window.postMessage({ type: "SUMMA_CBCG_EXTENSION_READY" }, window.location.origin);

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data;
  if (message?.type === "SUMMA_CBCG_EXTENSION_PROBE") {
    window.postMessage({ type: "SUMMA_CBCG_EXTENSION_READY" }, window.location.origin);
    return;
  }
  if (!["SUMMA_CBCG_LOOKUP", "SUMMA_CBCG_ACK", "SUMMA_CBCG_CANCEL"].includes(message?.type)) return;
  try {
    if (!chrome.runtime?.id) throw new Error("Extension context invalidated");
    chrome.runtime.sendMessage({ type: message.type, requestId: message.requestId, account: message.account }).then(response => {
      if (response?.ok === false && message.type === "SUMMA_CBCG_LOOKUP") {
        window.postMessage({ type: "SUMMA_CBCG_ERROR", requestId: message.requestId,
          message: response.message ?? "CBCG pretraga nije pokrenuta." }, window.location.origin);
      }
    }).catch(() => extensionError());
  } catch { extensionError(); }
  function extensionError() {
    if (message.type !== "SUMMA_CBCG_LOOKUP") return;
    window.postMessage({ type: "SUMMA_CBCG_ERROR", requestId: message.requestId,
      message: "Osvježite ekstenziju i stranicu programa pa pokušajte ponovo." }, window.location.origin);
  }
});

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;

  if (event.data?.type === "SUMMA_IRMS_EXTENSION_PROBE") {
    window.postMessage({ type: "SUMMA_IRMS_EXTENSION_READY" }, window.location.origin);
    return;
  }
  if (event.data?.type !== "SUMMA_IRMS_LOOKUP") return;

  try {
    if (!chrome.runtime?.id) {
      throw new Error("Extension context invalidated");
    }

    chrome.runtime.sendMessage({
      type: "SUMMA_IRMS_LOOKUP",
      requestId: event.data.requestId,
      pib: event.data.pib
    }).then((response) => {
      if (response?.ok === false) {
        window.postMessage({
          type: "SUMMA_IRMS_ERROR",
          requestId: event.data.requestId,
          message: response.message
        }, window.location.origin);
      }
    }).catch(() => {
      window.postMessage({
        type: "SUMMA_IRMS_ERROR",
        requestId: event.data.requestId,
        message: "Ekstenzija je osvježena. Osvježite i stranicu programa pa pokušajte ponovo."
      }, window.location.origin);
    });
  } catch {
    window.postMessage({
      type: "SUMMA_IRMS_ERROR",
      requestId: event.data.requestId,
      message: "Ekstenzija je osvježena. Osvježite i stranicu programa pa pokušajte ponovo."
    }, window.location.origin);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (["SUMMA_IRMS_RESULT", "SUMMA_IRMS_ERROR", "SUMMA_CBCG_RESULT", "SUMMA_CBCG_ERROR"].includes(message?.type)) {
    window.postMessage(message, window.location.origin);
  }
});
