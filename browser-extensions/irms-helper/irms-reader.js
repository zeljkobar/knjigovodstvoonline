const normalize = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const normalizeKey = (value) => normalize(value).toLocaleLowerCase("sr-Latn");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(find, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = find();
    if (result) return result;
    await delay(250);
  }
  throw new Error("IRMS nije prikazao očekivane podatke na vrijeme.");
}

function setInputValue(input, value) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  for (const type of ["input", "change", "blur"]) input.dispatchEvent(new Event(type, { bubbles: true }));
}

function findPibInput() {
  const inputs = [...document.querySelectorAll("input")];
  return inputs.find((input) => {
    const directDescription = normalizeKey([
      input.name, input.id, input.placeholder, input.getAttribute("aria-label")
    ].join(" "));
    return directDescription.includes("pib") || directDescription.includes("matični broj") || directDescription.includes("maticni broj");
  }) || inputs.find((input) => {
    const description = normalizeKey([
      input.closest("label")?.textContent, input.parentElement?.textContent
    ].join(" "));
    return description.includes("pib") || description.includes("matični broj") || description.includes("maticni broj");
  });
}

function findButton(text) {
  const expected = normalizeKey(text);
  return [...document.querySelectorAll("button, [role='button'], input[type='submit']")].find((element) => {
    const label = element instanceof HTMLInputElement ? element.value : element.textContent;
    return normalizeKey(label) === expected;
  });
}

function findResultRow(pib) {
  return [...document.querySelectorAll("tr, [role='row']")].find((row) => {
    const cells = [...row.querySelectorAll("td, [role='cell']")].map((cell) => normalize(cell.textContent));
    return cells.some((cell) => cell === pib);
  });
}

function parseResultRow(row, pib) {
  const cells = [...row.querySelectorAll("td, [role='cell']")].map((cell) => normalize(cell.textContent));
  const pibIndex = cells.findIndex((cell) => cell === pib);
  return {
    registrationNumber: pibIndex > 1 ? cells[pibIndex - 2] : "",
    pib,
    name: pibIndex >= 0 ? cells[pibIndex + 1] || "" : "",
    legalForm: pibIndex >= 0 ? cells[pibIndex + 2] || "" : "",
    activity: pibIndex >= 0 ? cells[pibIndex + 3] || "" : "",
    status: pibIndex >= 0 ? cells[pibIndex + 4] || "" : ""
  };
}

async function openDetails(row) {
  const directLink = row.querySelector("a[href*='/business-entities/']");
  if (directLink instanceof HTMLElement) {
    directLink.click();
    return;
  }

  const action = [...row.querySelectorAll("button, [role='button'], a")].at(-1);
  if (action instanceof HTMLElement) action.click();
  else if (row instanceof HTMLElement) row.click();

  const detailsLink = await waitFor(() => {
    const link = document.querySelector("a[href*='/business-entities/']");
    if (link instanceof HTMLElement) return link;
    return [...document.querySelectorAll("button, [role='menuitem']")].find((element) =>
      normalizeKey(element.textContent).includes("detalj")
    );
  }, 5000).catch(() => null);

  if (detailsLink instanceof HTMLElement) detailsLink.click();
  else if (row instanceof HTMLElement) row.click();
}

function textValue(labels) {
  const keys = labels.map(normalizeKey);
  for (const element of document.querySelectorAll("body *")) {
    if (element.children.length > 2) continue;
    const text = normalize(element.textContent);
    const key = normalizeKey(text);
    const label = keys.find((candidate) => key === candidate || key.startsWith(`${candidate}:`));
    if (!label) continue;

    if (text.includes(":")) {
      const inlineValue = text.slice(text.indexOf(":") + 1).trim();
      if (inlineValue) return inlineValue;
    }
    const siblingValue = normalize(element.nextElementSibling?.textContent);
    if (siblingValue) return siblingValue;
    const parentValue = normalize(element.parentElement?.textContent).slice(text.length).replace(/^\s*:?\s*/, "");
    if (parentValue) return parentValue;
  }
  return "";
}

function parsePeople() {
  const directors = [];
  for (const row of document.querySelectorAll("tr, [role='row']")) {
    const cells = [...row.querySelectorAll("td, [role='cell']")].map((cell) => normalize(cell.textContent));
    if (cells.length >= 3 && /direktor|zastupnik/i.test(cells[2])) {
      directors.push({ name: cells[0], lastname: cells[1], role: cells[2], fullName: normalize(`${cells[0]} ${cells[1]}`) });
    }
  }
  return directors;
}

function cleanWebAddress(value) {
  const clean = normalize(value).replace(/^web\s*(adresa|sajt)\s*:?\s*/i, "");
  if (!clean || clean.includes("@")) return "";
  return /^(https?:\/\/|www\.)/i.test(clean) || /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(clean) ? clean : "";
}

function parseDetails(pib, resultRow = {}) {
  const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((el) => normalize(el.textContent)).filter(Boolean);
  const legalName = textValue(["Puni naziv", "Naziv društva", "Naziv privrednog subjekta"]);
  const headingName = headings.find((heading) => !/pretraga registra|detalji subjekta|informacije|adresa i kontakt|lica u privrednom|članovi privrednog|dijelovi društva|finansijski izvještaji/i.test(heading));
  const name = legalName || resultRow.name || headingName || "";
  const cityValue = textValue(["Sjedište društva", "Mjesto sjedišta"]);
  return {
    id: location.pathname.split("/").filter(Boolean).at(-1) || "",
    name,
    legalName: legalName || resultRow.name || name,
    shortName: resultRow.name || name,
    pib: textValue(["PIB/Matični broj", "PIB", "Matični broj"]) || pib,
    registrationNumber: textValue(["Registarski broj"]) || resultRow.registrationNumber,
    legalForm: textValue(["Oblik organizovanja", "Pravna forma"]) || resultRow.legalForm,
    status: textValue(["Status društva", "Status"]) || resultRow.status,
    founded: textValue(["Datum osnivanja", "Datum registracije"]),
    activity: textValue(["Djelatnost", "Glavna djelatnost"]) || resultRow.activity,
    address: textValue(["Adresa sjedišta", "Adresa"]),
    city: cityValue.split(",")[0]?.trim() || cityValue,
    email: textValue(["Email adresa", "Email"]),
    phone: textValue(["Telefon"]),
    webAddress: cleanWebAddress(textValue(["Web adresa", "Web sajt"])),
    capital: textValue(["Ukupan kapital"]),
    directors: parsePeople()
  };
}

async function run(pib) {
  let resultRow = {};
  try {
    resultRow = JSON.parse(sessionStorage.getItem(`summa-irms-row-${pib}`) || "{}");
  } catch {
    resultRow = {};
  }
  if (!/\/business-entities\/\d+/.test(location.pathname)) {
    const params = new URLSearchParams(location.search);
    if (params.get("identificationNumber") !== pib) {
      location.assign(
        `/public/search-register/business-entities?identificationNumber=${encodeURIComponent(pib)}&page=1&perPage=5`
      );
      return new Promise(() => {});
    }

    const row = await waitFor(() => findResultRow(pib));
    resultRow = parseResultRow(row, pib);
    sessionStorage.setItem(`summa-irms-row-${pib}`, JSON.stringify(resultRow));
    await openDetails(row);
    await waitFor(() => /\/business-entities\/\d+/.test(location.pathname));
  }
  await waitFor(() => document.body.innerText.includes(pib));
  const details = parseDetails(pib, resultRow);
  sessionStorage.removeItem(`summa-irms-row-${pib}`);
  return details;
}

let lookupRunning = false;

function startLookup(pib) {
  const cleanPib = String(pib ?? "").trim();
  if (lookupRunning || !/^\d{8}$/.test(cleanPib)) return;
  lookupRunning = true;
  run(cleanPib)
    .then((data) => chrome.runtime.sendMessage({ type: "SUMMA_IRMS_RESULT", data }))
    .catch((error) => chrome.runtime.sendMessage({
      type: "SUMMA_IRMS_ERROR",
      message: error instanceof Error ? error.message : "IRMS pretraga nije uspjela."
    }))
    .finally(() => { lookupRunning = false; });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "SUMMA_IRMS_START") return;
  startLookup(message.pib);
});

chrome.runtime.sendMessage({ type: "SUMMA_IRMS_READER_READY" });

// Pouzdani početni tok: PIB je dio URL-a pomoćnog taba, pa popunjavanje ne
// zavisi od trenutka u kojem se Manifest V3 service worker probudio.
startLookup(new URLSearchParams(window.location.search).get("summaPib"));
