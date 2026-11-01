/* global SummaCbcg */
(() => {
  let currentRequest = null;
  let timer = null;
  function send(message) { chrome.runtime.sendMessage(message).catch(() => undefined); }
  function start(message) {
    if (currentRequest === message.requestId) return;
    if (!SummaCbcg.isCbcgUrl(location.href)) return;
    const parts = SummaCbcg.accountParts(message.account);
    if (!parts) return;
    currentRequest = message.requestId;
    clearInterval(timer);
    let submitted = message.submitted;
    const tick = () => {
      if (Date.now() >= message.expiresAt) { clearInterval(timer); return; }
      const result = submitted ? SummaCbcg.readResult(document, parts.account) : null;
      if (result) {
        clearInterval(timer);
        send({ type: "SUMMA_CBCG_RESULT", requestId: message.requestId, data: result });
        return;
      }
      // Popups (including a reCAPTCHA error) are left for the user. They are
      // not a final failure: ADF can still display a result after the user's OK.
      if (submitted) return;
      const fields = ["pt1:it3::content", "pt1:it4::content", "pt1:it5::content"].map(id => document.getElementById(id));
      const button = document.querySelector("button.g-recaptcha[data-action='pregledRacuni']");
      if (fields.some(field => !field) || !button) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      fields.forEach((field, index) => {
        setter.call(field, [parts.bank, parts.middle, parts.check][index]);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
        field.dispatchEvent(new Event("blur", { bubbles: true }));
      });
      submitted = true;
      // Persist before clicking: a complete ADF navigation must not resubmit.
      chrome.runtime.sendMessage({ type: "SUMMA_CBCG_SUBMITTED", requestId: message.requestId }).then(response => {
        if (response?.ok) button.click(); // The ordinary visible search button.
      }).catch(() => undefined);
    };
    timer = setInterval(tick, 500);
    tick();
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "SUMMA_CBCG_START") start(message);
  });
  send({ type: "SUMMA_CBCG_READER_READY" });
})();
