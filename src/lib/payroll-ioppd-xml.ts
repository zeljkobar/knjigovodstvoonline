import { buildIoppdReportLines } from "./payroll-ioppd";
import type { IoppdLine, IoppdMonthData } from "./payroll-ioppd";

type IoppdXmlLine = {
  row: IoppdLine;
  osnovId: string;
  osnov: string;
  periodOd: string;
  periodDo: string;
  brutoCent: number;
  porezCent: number;
  zaposleniPioCent: number;
  zaposleniZdravstvoCent: number;
  zaposleniNezaposleniCent: number;
  poslodavacPioCent: number;
  poslodavacZdravstvoCent: number;
  poslodavacNezaposleniCent: number;
  fondRadaCent: number;
};

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatXmlNumberFromCents(value: number) {
  return (Number(value || 0) / 100).toFixed(2);
}

function formatIoppdDate(year: number, month: number, day: number) {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");

  return `${year}-${mm}-${dd}T00:00:00+01:00`;
}

function ioppdOsnovId(value: string) {
  const numeric = Number(value);

  return Number.isFinite(numeric) && numeric > 0 ? String(numeric) : value || "1";
}

function buildXmlLines(data: IoppdMonthData) {
  const lastDay = new Date(data.godina, data.mjesec, 0).getDate();
  const periodOd = formatIoppdDate(data.godina, data.mjesec, 1);
  const periodDo = formatIoppdDate(data.godina, data.mjesec, lastDay);
  const porezPeriod = formatIoppdDate(data.godina, data.mjesec, lastDay);
  const rows: IoppdXmlLine[] = [];

  for (const line of buildIoppdReportLines(data)) {
    if (Number(line.sifra) === 65) {
      rows.push({
        row: line,
        osnovId: "65",
        osnov: line.nazivPrimanja || "Zarada",
        periodOd: porezPeriod,
        periodDo: porezPeriod,
        brutoCent: line.osnovicaCent,
        porezCent: line.porezCent,
        zaposleniPioCent: 0,
        zaposleniZdravstvoCent: 0,
        zaposleniNezaposleniCent: 0,
        poslodavacPioCent: 0,
        poslodavacZdravstvoCent: 0,
        poslodavacNezaposleniCent: 0,
        fondRadaCent: 0
      });
      continue;
    }

    if (Number(line.sifra) === 97) {
      rows.push({
        row: line,
        osnovId: "97",
        osnov: line.nazivPrimanja || "Zarada",
        periodOd: porezPeriod,
        periodDo: porezPeriod,
        brutoCent: line.osnovicaCent,
        porezCent: line.porezCent,
        zaposleniPioCent: 0,
        zaposleniZdravstvoCent: 0,
        zaposleniNezaposleniCent: 0,
        poslodavacPioCent: 0,
        poslodavacZdravstvoCent: 0,
        poslodavacNezaposleniCent: 0,
        fondRadaCent: 0
      });
      continue;
    }

    rows.push({
      row: line,
      osnovId: ioppdOsnovId(line.sifra),
      osnov: line.nazivPrimanja || "Zarada",
      periodOd,
      periodDo,
      brutoCent: line.brutoCent,
      porezCent: 0,
      zaposleniPioCent: line.zaposleniPioCent,
      zaposleniZdravstvoCent: line.zaposleniZdravstvoCent,
      zaposleniNezaposleniCent: line.zaposleniNezaposleniCent,
      poslodavacPioCent: line.poslodavacPioCent,
      poslodavacZdravstvoCent: line.poslodavacZdravstvoCent,
      poslodavacNezaposleniCent: line.poslodavacNezaposleniCent,
      fondRadaCent: line.fondRadaCent
    });
  }

  return rows;
}

export function buildIoppdXml(data: IoppdMonthData) {
  const rows = buildXmlLines(data);
  const distinctPeople = new Set(
    data.lines.filter((line) => Number(line.sifra || 1) === 1 && line.jmbg).map((line) => line.jmbg)
  ).size;
  const total = rows.reduce(
    (acc, item) => {
      acc.brutoCent += item.brutoCent;
      acc.porezCent += item.porezCent;
      acc.zaposleniPioCent += item.zaposleniPioCent;
      acc.zaposleniZdravstvoCent += item.zaposleniZdravstvoCent;
      acc.zaposleniNezaposleniCent += item.zaposleniNezaposleniCent;
      acc.poslodavacPioCent += item.poslodavacPioCent;
      acc.poslodavacZdravstvoCent += item.poslodavacZdravstvoCent;
      acc.poslodavacNezaposleniCent += item.poslodavacNezaposleniCent;
      acc.fondRadaCent += item.fondRadaCent;
      return acc;
    },
    {
      brutoCent: 0,
      porezCent: 0,
      zaposleniPioCent: 0,
      zaposleniZdravstvoCent: 0,
      zaposleniNezaposleniCent: 0,
      poslodavacPioCent: 0,
      poslodavacZdravstvoCent: 0,
      poslodavacNezaposleniCent: 0,
      fondRadaCent: 0
    }
  );
  const unosXml = rows
    .map((item, index) => {
      const punoIme = item.row.imePrezime.trim();

      return `    <Unos>
      <Unos-PIB>${xmlEscape(item.row.jmbg)}</Unos-PIB>
      <Unos-PrezimeIIme>${xmlEscape(punoIme)}</Unos-PrezimeIIme>
      <Unos-OsnovID>${xmlEscape(item.osnovId)}</Unos-OsnovID>
      <Index>${index + 1}</Index>
      <Unos-Osnov>${xmlEscape(item.osnov)}</Unos-Osnov>
      <Unos-PeriodOd>${item.periodOd}</Unos-PeriodOd>
      <Unos-PeriodDo>${item.periodDo}</Unos-PeriodDo>
      <Unos-BrutoOsnov>${formatXmlNumberFromCents(item.brutoCent)}</Unos-BrutoOsnov>
      <Unos-TeretOsiguranikaPorez>${formatXmlNumberFromCents(item.porezCent)}</Unos-TeretOsiguranikaPorez>
      <Unos-TeretOsiguranikaPIO>${formatXmlNumberFromCents(item.zaposleniPioCent)}</Unos-TeretOsiguranikaPIO>
      <Unos-TeretOsiguranikaRFZO>${formatXmlNumberFromCents(item.zaposleniZdravstvoCent)}</Unos-TeretOsiguranikaRFZO>
      <Unos-TeretOsiguranikaZZZ>${formatXmlNumberFromCents(item.zaposleniNezaposleniCent)}</Unos-TeretOsiguranikaZZZ>
      <Unos-TeretIsplatiocaPIO>${formatXmlNumberFromCents(item.poslodavacPioCent)}</Unos-TeretIsplatiocaPIO>
      <Unos-TeretIsplatiocaRFZO>${formatXmlNumberFromCents(item.poslodavacZdravstvoCent)}</Unos-TeretIsplatiocaRFZO>
      <Unos-TeretIsplatiocaZZZ>${formatXmlNumberFromCents(item.poslodavacNezaposleniCent)}</Unos-TeretIsplatiocaZZZ>
      <Unos-TeretIsplatiocaFondRada>${formatXmlNumberFromCents(item.fondRadaCent)}</Unos-TeretIsplatiocaFondRada>
    </Unos>`;
    })
    .join("\n");

  return `<?xml version="1.0"?>
<Izvjestaj xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns="urn:IOPD_V1_0.xsd">
  <Ukupno>
    <Ukupno-BrojLica>${distinctPeople}</Ukupno-BrojLica>
    <Ukupno-BrutoIznos>${formatXmlNumberFromCents(total.brutoCent)}</Ukupno-BrutoIznos>
    <TeretOsiguraonika>
      <TeretOsiguraonika-Porez>${formatXmlNumberFromCents(total.porezCent)}</TeretOsiguraonika-Porez>
      <TeretOsiguraonika-PIO>${formatXmlNumberFromCents(total.zaposleniPioCent)}</TeretOsiguraonika-PIO>
      <TeretOsiguraonika-RFZO>${formatXmlNumberFromCents(total.zaposleniZdravstvoCent)}</TeretOsiguraonika-RFZO>
      <TeretOsiguraonika-ZZZ>${formatXmlNumberFromCents(total.zaposleniNezaposleniCent)}</TeretOsiguraonika-ZZZ>
    </TeretOsiguraonika>
    <TeretIsplatioca>
      <TeretIsplatioca-PIO>${formatXmlNumberFromCents(total.poslodavacPioCent)}</TeretIsplatioca-PIO>
      <TeretIsplatioca-RFZO>${formatXmlNumberFromCents(total.poslodavacZdravstvoCent)}</TeretIsplatioca-RFZO>
      <TeretIsplatioca-ZZZ>${formatXmlNumberFromCents(total.poslodavacNezaposleniCent)}</TeretIsplatioca-ZZZ>
      <TeretIsplatioca-FondRada>${formatXmlNumberFromCents(total.fondRadaCent)}</TeretIsplatioca-FondRada>
    </TeretIsplatioca>
  </Ukupno>
  <PojedinacniObracun>
${unosXml}
  </PojedinacniObracun>
  <DoprinosZbogNezaposljavanjaInvalida>
    <UkupanBrojZaposlenih>${distinctPeople}</UkupanBrojZaposlenih>
    <BrojZaposlenihInvalida>0</BrojZaposlenihInvalida>
    <Osnovica>0.00</Osnovica>
    <Stopa>0.00</Stopa>
    <Iznos>0.00</Iznos>
  </DoprinosZbogNezaposljavanjaInvalida>
</Izvjestaj>
`;
}

export function sanitizeIoppdFileName(value: string) {
  return String(value || "firma").replace(/[<>:"/\\|?*]/g, "_").trim();
}

export function asciiIoppdFileName(value: string) {
  return sanitizeIoppdFileName(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "_");
}
