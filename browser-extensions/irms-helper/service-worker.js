const pendingKey = (tabId) => `irms-pending-${tabId}`;

async function savePending(tabId, pending) {
  await chrome.storage.session.set({ [pendingKey(tabId)]: pending });
}

async function getPending(tabId) {
  const key = pendingKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return stored[key];
}

async function removePending(tabId) {
  await chrome.storage.session.remove(pendingKey(tabId));
}

async function startReader(tabId) {
  const pending = await getPending(tabId);
  if (!pending) return;
  await chrome.tabs.sendMessage(tabId, {
    type: "SUMMA_IRMS_START",
    pib: pending.pib
  }).catch(() => undefined);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "SUMMA_IRMS_LOOKUP" && sender.tab?.id) {
    const pib = String(message.pib ?? "").trim();
    if (!/^\d{8}$/.test(pib)) {
      sendResponse({ ok: false, message: "PIB mora imati tačno 8 cifara." });
      return;
    }

    chrome.tabs.create({
      active: true,
      url: `https://irms.tax.gov.me/public/search-register?summaPib=${encodeURIComponent(pib)}`
    }).then(async (tab) => {
      if (!tab.id) {
        sendResponse({ ok: false, message: "IRMS tab nije mogao biti otvoren." });
        return;
      }
      await savePending(tab.id, {
        pib,
        requesterTabId: sender.tab.id,
        requestId: message.requestId
      });
      sendResponse({ ok: true });
    }).catch(() => sendResponse({ ok: false, message: "IRMS tab nije mogao biti otvoren." }));
    return true;
  }

  if (message?.type === "SUMMA_IRMS_READER_READY" && sender.tab?.id) {
    startReader(sender.tab.id);
    return;
  }

  if ((message?.type === "SUMMA_IRMS_RESULT" || message?.type === "SUMMA_IRMS_ERROR") && sender.tab?.id) {
    const irmsTabId = sender.tab.id;
    getPending(irmsTabId).then((pending) => {
      if (!pending) return;
      chrome.tabs.sendMessage(pending.requesterTabId, {
        type: message.type,
        requestId: pending.requestId,
        data: message.data,
        message: message.message
      }).finally(async () => {
        await removePending(irmsTabId).catch(() => undefined);
        chrome.tabs.remove(irmsTabId).catch(() => undefined);
      });
    });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url?.startsWith("https://irms.tax.gov.me/public/search-register")) {
    startReader(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  getPending(tabId).then((pending) => {
    if (!pending) return;
    removePending(tabId).catch(() => undefined);
    chrome.tabs.sendMessage(pending.requesterTabId, {
      type: "SUMMA_IRMS_ERROR",
      requestId: pending.requestId,
      message: "IRMS tab je zatvoren prije završetka pretrage."
    }).catch(() => undefined);
  });
});
