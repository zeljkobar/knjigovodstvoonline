/* global SummaCbcg */
// Separate protocol/state so existing IRMS requests keep their original flow.
(() => {
  const prefix = "cbcg-pending-";
  const key = tabId => `${prefix}${tabId}`;
  let queue = Promise.resolve();
  const enqueue = work => {
    const next = queue.then(work);
    queue = next.catch(() => undefined);
    return next;
  };
  const all = async () => Object.entries(await chrome.storage.session.get(null)).filter(([name]) => name.startsWith(prefix));
  const get = async tabId => (await chrome.storage.session.get(key(tabId)))[key(tabId)];
  async function notify(pending, message) {
    await chrome.tabs.sendMessage(pending.requesterTabId, { ...message, requestId: pending.requestId },
      { documentId: pending.documentId }).catch(() => undefined);
  }
  async function finish(tabId, pending, error, activate = false) {
    await chrome.storage.session.remove(key(tabId));
    await chrome.alarms.clear(key(tabId));
    if (error) await notify(pending, { type: "SUMMA_CBCG_ERROR", message: error });
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    // Never close a pre-existing tab or a helper the user navigated elsewhere.
    if (tab && SummaCbcg.isCbcgUrl(tab.url)) await chrome.tabs.remove(tabId).catch(() => undefined);
    if (activate) await chrome.tabs.update(pending.requesterTabId, { active: true }).catch(() => undefined);
  }
  async function startReader(tabId) {
    const pending = await get(tabId);
    if (!pending || pending.delivered) return;
    if (pending.expiresAt <= Date.now()) return finish(tabId, pending, "CBCG pretraga je istekla. Pokušajte ponovo.");
    await chrome.tabs.sendMessage(tabId, { type: "SUMMA_CBCG_START", ...pending }).catch(() => undefined);
  }
  async function handle(message, sender) {
    const tabId = sender.tab?.id;
    if (tabId == null || sender.frameId !== 0) return { ok: false };
    const appMessage = ["SUMMA_CBCG_LOOKUP", "SUMMA_CBCG_ACK", "SUMMA_CBCG_CANCEL"].includes(message.type);
    if (appMessage) {
      if (!SummaCbcg.isAppUrl(sender.url) || !sender.documentId || !/^cbcg-[a-zA-Z0-9-]{20,80}$/.test(message.requestId ?? "")) return { ok: false };
      if (message.type === "SUMMA_CBCG_LOOKUP") {
        const parts = SummaCbcg.accountParts(message.account);
        if (!parts) return { ok: false, message: "Neispravan domaći žiro račun." };
        const existing = await all();
        if (existing.some(([, p]) => p.requesterTabId === tabId && p.requestId === message.requestId)) return { ok: true };
        if (existing.filter(([, p]) => p.requesterTabId === tabId).length >= 5) return { ok: false, message: "Završite već otvorene CBCG pretrage." };
        const tab = await chrome.tabs.create({ active: true, windowId: sender.tab.windowId, url: "https://eportal.cbcg.me/cbcgPregledi/faces/pages/pregledracuni.jspx" });
        if (tab.id == null) return { ok: false, message: "CBCG tab nije mogao biti otvoren." };
        const pending = { account: parts.account, requestId: message.requestId, requesterTabId: tabId,
          documentId: sender.documentId, submitted: false, delivered: false, expiresAt: Date.now() + 5 * 60_000 };
        try {
          await chrome.storage.session.set({ [key(tab.id)]: pending });
          await chrome.alarms.create(key(tab.id), { when: pending.expiresAt });
          await startReader(tab.id);
        } catch (error) {
          await finish(tab.id, pending);
          throw error;
        }
        return { ok: true };
      }
      for (const [name, pending] of await all()) {
        if (pending.requesterTabId !== tabId || pending.documentId !== sender.documentId || pending.requestId !== message.requestId) continue;
        if (message.type === "SUMMA_CBCG_CANCEL" || pending.delivered) {
          await finish(Number(name.slice(prefix.length)), pending, undefined, message.type === "SUMMA_CBCG_ACK");
        }
      }
      return { ok: true };
    }
    if (!SummaCbcg.isCbcgUrl(sender.url)) return { ok: false };
    if (message.type === "SUMMA_CBCG_READER_READY") { await startReader(tabId); return { ok: true }; }
    const pending = await get(tabId);
    if (!pending || pending.requestId !== message.requestId) return { ok: false };
    if (pending.expiresAt <= Date.now()) { await finish(tabId, pending, "CBCG pretraga je istekla."); return { ok: false }; }
    if (message.type === "SUMMA_CBCG_SUBMITTED") {
      if (pending.submitted) return { ok: false };
      await chrome.storage.session.set({ [key(tabId)]: { ...pending, submitted: true } });
      return { ok: true };
    }
    if (message.type === "SUMMA_CBCG_RESULT" && pending.submitted && !pending.delivered) {
      if (!SummaCbcg.validCompany(message.data, pending.account)) return { ok: false };
      await chrome.storage.session.set({ [key(tabId)]: { ...pending, delivered: true } });
      await notify(pending, { type: "SUMMA_CBCG_RESULT", data: message.data });
      // The app validates and ACKs the payload. Only then may this tab close.
      return { ok: true };
    }
    return { ok: false };
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (typeof message?.type !== "string" || !message.type.startsWith("SUMMA_CBCG_")) return;
    enqueue(() => handle(message, sender)).then(respond, () => respond({ ok: false, message: "CBCG pretraga nije uspjela. Pokušajte ponovo." }));
    return true;
  });
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status === "complete" && SummaCbcg.isCbcgUrl(tab.url)) enqueue(() => startReader(tabId));
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    enqueue(async () => {
      for (const [name, pending] of await all()) {
        const helperId = Number(name.slice(prefix.length));
        if (helperId === tabId) await finish(helperId, pending, "CBCG tab je zatvoren prije prenosa podataka.");
        else if (pending.requesterTabId === tabId) await finish(helperId, pending);
      }
    });
  });
  chrome.alarms.onAlarm.addListener(alarm => {
    if (!alarm.name.startsWith(prefix)) return;
    enqueue(async () => {
      const tabId = Number(alarm.name.slice(prefix.length));
      const pending = await get(tabId);
      if (pending) await finish(tabId, pending, "CBCG pretraga je istekla. Pokušajte ponovo.");
    });
  });
})();
