// Shared by the CBCG content script and extension worker (no page globals).
globalThis.SummaCbcg = (() => {
  function accountParts(value) {
    const clean = String(value ?? "").trim();
    const parts = clean.match(/^(\d{3})\s*-\s*(\d{1,13})\s*-\s*(\d{2})$/)
      ?? clean.replace(/\s/g, "").match(/^(\d{3})(\d{1,13})(\d{2})$/);
    if (!parts) return null;
    const middle = parts[2].replace(/^0+(?=\d)/, "");
    if (middle === "0") return null;
    return { bank: parts[1], middle, check: parts[3], account: `${parts[1]}-${middle}-${parts[3]}` };
  }
  function isCbcgUrl(value) {
    try {
      const url = new URL(value);
      return url.origin === "https://eportal.cbcg.me"
        && url.pathname.split(";")[0] === "/cbcgPregledi/faces/pages/pregledracuni.jspx";
    } catch { return false; }
  }
  function isAppUrl(value) {
    try {
      const url = new URL(value);
      return (url.protocol === "http:" && url.hostname === "localhost")
        || (url.protocol === "https:" && ["knjigovodstvoonline.me", "www.knjigovodstvoonline.me"].includes(url.hostname))
        || (url.protocol === "https:" && url.hostname.endsWith(".summasummarum.me"));
    } catch { return false; }
  }
  function validCompany(data, expectedAccount) {
    const expected = accountParts(expectedAccount);
    if (!expected || !data || expected.account !== accountParts(data.account)?.account) return false;
    return ["name", "pib", "address", "city"].every(key => typeof data[key] === "string" && data[key].length <= 1000)
      && Boolean(data.name.trim()) && /^\d{8}$/.test(data.pib);
  }
  function readResult(doc, account) {
    const expected = accountParts(account);
    if (!expected) return null;
    const text = doc.body?.innerText ?? "";
    const heading = text.match(/Rezultat pretrage za transakcioni ra[čc]un\s+(\d{3}\s*-\s*\d{1,13}\s*-\s*\d{2})/i);
    if (!heading || accountParts(heading[1])?.account !== expected.account) return null;
    const root = doc.getElementById("pt1:lv2::db");
    if (!root) return null;
    const items = root.querySelectorAll('[id^="pt1:lv2:"][id$=":li3"]');
    // Never choose the first business from an ambiguous result.
    if (items.length !== 1) return null;
    const lines = items[0].innerText.split(/\n/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
    const read = label => {
      const index = lines.findIndex(line => line === label || line.startsWith(label + " "));
      if (index < 0) return "";
      return lines[index] === label ? lines[index + 1] ?? "" : lines[index].slice(label.length).trim();
    };
    const data = { account: expected.account, name: read("Naziv"), pib: read("Matični broj"), address: read("Adresa"), city: read("Sjedište") };
    return validCompany(data, expected.account) ? data : null;
  }
  return { accountParts, isCbcgUrl, isAppUrl, validCompany, readResult };
})();
