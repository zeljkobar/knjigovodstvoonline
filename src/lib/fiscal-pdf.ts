import "server-only";
import puppeteer from "puppeteer";
import { fiscalReportSheets } from "./fiscal-report-xlsx";
import type { DirectPortalReport,DirectPortalReportKind } from "./direct-portal-reports";

export const htmlEscape=(value:unknown)=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export function pdfDocument(title:string,body:string) {
  return `<!doctype html><html lang="sr-Latn"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><title>${htmlEscape(title)}</title><style>
  @page{size:A4 landscape;margin:14mm 12mm 18mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#172b42;font-size:10px;margin:0}h1{font-size:22px;margin:0 0 10px}h2{font-size:15px;margin:18px 0 8px}p{line-height:1.5}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:10px 0 18px}th,td{padding:7px;border:1px solid #cbd5e1;overflow-wrap:anywhere;vertical-align:top}th{background:#eaf0f7;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}.section{break-before:page}.record{break-inside:avoid}.record td:first-child{width:28%;font-weight:bold}.qr{width:105px;height:105px}.numbers{font-variant-numeric:tabular-nums}.test{color:#9b1c1c;font-weight:bold}.muted{color:#53667c}
  </style></head><body>${body}</body></html>`;
}
let busy=false;
export async function htmlPdf(html:string,landscape=true) {
  if(html.length>8_000_000) throw Error("PDF_PREVELIK");
  if(busy) throw Error("PDF_ZAUZET");
  busy=true;
  let browser;
  try {
    browser=await puppeteer.launch({headless:true,executablePath:process.env.PUPPETEER_EXECUTABLE_PATH||undefined,timeout:30000});
    const page=await browser.newPage();await page.setJavaScriptEnabled(false);await page.setRequestInterception(true);
    page.on("request",req=>{if(req.url().startsWith("data:"))void req.continue();else void req.abort();});
    await page.setContent(html,{waitUntil:"load",timeout:30000});
    const bytes=await page.pdf({format:"A4",landscape,printBackground:true,displayHeaderFooter:true,headerTemplate:"<span></span>",footerTemplate:'<div style="font:9px Arial;width:100%;text-align:center;color:#53667c">Strana <span class="pageNumber"></span> / <span class="totalPages"></span></div>',margin:{top:"14mm",bottom:"18mm",left:"12mm",right:"12mm"},timeout:60000});
    if(bytes.length>10_485_760)throw Error("PDF_PREVELIK");
    return Buffer.from(bytes);
  } finally {try{await browser?.close();}finally{busy=false;}}
}
export function fiscalReportHtml(report:DirectPortalReport,company:{naziv:string;pib:string|null},at:Date,kind:DirectPortalReportKind) {
  if(report.documents.length>2000 || report.documents.reduce((sum,d)=>sum+d.lines.length,0)>10000)throw Error("PDF_PREVELIK");
  const sheets=fiscalReportSheets(report,company,at,kind);
  const cell=(v:unknown, monetary=false)=>htmlEscape(v instanceof Date?v.toISOString().replace("T"," ").slice(0,19):typeof v==="number"?v.toLocaleString("sr-Latn-ME",{minimumFractionDigits:monetary?2:0,maximumFractionDigits:monetary?2:3}):v);
  const body=sheets.map(([name,rows],i)=>{
    const renderTable=(indices:number[],caption="")=>`${caption?`<h2>${htmlEscape(caption)}</h2>`:""}<table>${i?`<thead><tr>${indices.map(k=>`<th>${cell(rows[0][k])}</th>`).join("")}</tr></thead>`:""}<tbody>${(i?rows.slice(1):rows).map(row=>`<tr>${indices.map(k=>`<td>${cell(row[k],/EUR|Iznos korišćenja/.test(String(i?rows[0]?.[k]:row[0])))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    const table=rows[0]?.length>10
      ? Array.from({length:Math.ceil((rows[0].length-1)/6)},(_,band)=>renderTable([0,...Array.from({length:Math.min(6,rows[0].length-1-band*6)},(_,k)=>1+band*6+k)],`${name} - dio ${band+1} (veza: ID računa)`)).join("")
      : renderTable(Array.from({length:Math.max(...rows.map(r=>r.length),1)},(_,k)=>k));
    return `<section class="${i?"section":""}"><h${i?2:1}>${htmlEscape(name)}</h${i?2:1}>${report.filters.environment==="Test"?'<p class="test">TESTNO OKRUŽENJE</p>':""}${table||"<p>Nema podataka.</p>"}</section>`;
  }).join("");
  return pdfDocument("Fiskalni izvještaj",body);
}
export async function fiscalReportPdf(report:DirectPortalReport,company:{naziv:string;pib:string|null},at:Date,kind:DirectPortalReportKind) {return htmlPdf(fiscalReportHtml(report,company,at,kind));}
