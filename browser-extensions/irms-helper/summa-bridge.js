window.postMessage({ type: "SUMMA_IRMS_EXTENSION_READY" }, window.location.origin);

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
  if (message?.type === "SUMMA_IRMS_RESULT" || message?.type === "SUMMA_IRMS_ERROR") {
    window.postMessage(message, window.location.origin);
  }
});
