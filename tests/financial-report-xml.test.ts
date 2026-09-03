import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { buildFinancialReportXml, xmlDate, type XmlHeader, type XmlReports, xmlText } from "../src/lib/financial-report-xml";
import template from "../src/lib/financial-report-xml-template.json";

const header: XmlHeader = {
  Godina: "2025", DatumOd: "2025-01-01", DatumDo: "2025-12-31",
  NazivObveznika: 'Test & <firma> "ČćŠšŽžĐđ"', SjedisteObveznika: "Bar",
  SifraDjelatnosti: "6920", MaticniBroj: "00000001",
  LiceKojeSastavljaIskaz_Naziv: "", LiceKojeSastavljaIskaz_JMBG: "", LiceKojeSastavljaIskaz_Email: "",
  OdgovornoLice_Ime: "", OdgovornoLice_Prezime: "", OdgovornoLice_JMBG: "",
  FinansijskiIzvestajSastavljenNaDan: "2026-03-01", FinansijskiIzvestajPodnesenNaDan: ""
};
function reports(): XmlReports {
  return Object.fromEntries(["BilanStanja", "BilanUspjeha", "StatistickiAneks"].map((key) => [key,
    template[key as keyof XmlReports].filter((row) => row.RedniBroj).map((row) => ({
      aop: `A${row.RedniBroj}`, tekucaGodina: 1234.6, prethodnaGodina: -42.2,
      prethodnaGodinaKraj: 25.1, prethodnaGodinaPocetak: 12.8
    }))])) as XmlReports;
}

test("maps AOP including 210a, rounds like reports, preserves all comparison columns and UTF-8", () => {
  const xml = buildFinancialReportXml(header, reports());
  assert.match(xml, /<RedniBroj>001<\/RedniBroj>\n<Iznos1>1235<\/Iznos1>\n<Iznos2>25<\/Iznos2>\n<Iznos3>13<\/Iznos3>/);
  assert.match(xml, /<RedniBroj>210a<\/RedniBroj>\n<Iznos1>1235<\/Iznos1>\n<Iznos2>-42<\/Iznos2>/);
  assert.ok(xml.includes("Test &amp; &lt;firma&gt; &quot;ČćŠšŽžĐđ&quot;"));
  assert.ok(!xml.includes("BilansStanja1a") && !xml.includes("BilansUspjeha2a"));
});
test("unused sections have only zero amounts, including amortization rates", () => {
  const xml = buildFinancialReportXml(header, reports());
  for (const section of ["IskazOTokovimaGotovine", "TokoviGotovine3a", "IskazOPromenamaKapitala", "ObracunAmortizacije"]) {
    const text = xml.split(`<${section}>`)[1].split(`</${section}>`)[0];
    const amounts = [...text.matchAll(/<Iznos\d+>(.*?)<\/Iznos\d+>/g)].map((m) => m[1]);
    assert.ok(amounts.length > 0 && amounts.every((v) => v === "0"));
  }
});
test("uses supplied final corrected values without recalculating accounts", () => {
  const input = reports(); input.BilanStanja[0].tekucaGodina = 9123;
  assert.match(buildFinancialReportXml(header, input), /<RedniBroj>001<\/RedniBroj>\n<Iznos1>9123<\/Iznos1>/);
});
test("missing, extra and duplicate AOP block export instead of silently inserting zero", () => {
  const missing = reports(); missing.BilanStanja.pop();
  assert.throws(() => buildFinancialReportXml(header, missing), /nedostaje AOP/);
  const dup = reports(); dup.BilanUspjeha.push(dup.BilanUspjeha[0]);
  assert.throws(() => buildFinancialReportXml(header, dup), /dupliran/);
  const extra = reports(); extra.StatistickiAneks[0].aop = "999";
  assert.throws(() => buildFinancialReportXml(header, extra), /nepoznat/);
});
test("invalid amounts, characters, dates, email and identity fields block export", () => {
  const input = reports(); input.BilanStanja[0].tekucaGodina = NaN;
  assert.throws(() => buildFinancialReportXml(header, input), /iznos/);
  assert.throws(() => xmlText("bad\u0000text"));
  assert.throws(() => xmlText("bad\ud800text"));
  assert.throws(() => xmlDate("2025-02-29"));
  assert.equal(xmlDate("2024-02-29"), "2024-02-29");
  assert.throws(() => buildFinancialReportXml({ ...header, MaticniBroj: "" }, reports()));
  assert.throws(() => buildFinancialReportXml({ ...header, LiceKojeSastavljaIskaz_JMBG: "123" }, reports()));
  assert.throws(() => buildFinancialReportXml({ ...header, LiceKojeSastavljaIskaz_Email: "bad" }, reports()));
  assert.throws(() => buildFinancialReportXml({ ...header, DatumDo: "2024-12-31" }, reports()));
});
test("generated document passes the supplied XSD, malformed document fails", { skip: process.platform !== "win32" }, () => {
  const validate = (xml: string) => spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "tests/validate-financial-xml.ps1"], { input: xml, encoding: "utf8" });
  const xml = buildFinancialReportXml(header, reports());
  const result = validate(xml);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.notEqual(validate(xml.replace("<Iznos1>1235</Iznos1>", "<Iznos1>bad</Iznos1>")).status, 0);
});
