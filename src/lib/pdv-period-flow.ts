import { effectivePdvSettings } from "@/lib/posting-template";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { auditLogInTransaction } from "./audit";
import { calculatePdvReturn } from "./pdv-service";
import { calculatePdvPostingAmounts, periodDateRange } from "./pdv";
import { formatJournalCode } from "./journals";

type Context = { agencijaId: string; user: {id: string; rola: string; korisnicko_ime: string}; firma: {id: string; pdv_obveznik: boolean}; poslovnaGodina: {id: string; godina: number} };
export class PdvFlowError extends Error {}
const fail = (message: string): never => { throw new PdvFlowError(message); };
const cents = (v: unknown) => {
  const result = new Prisma.Decimal(String(v ?? 0)).mul(100).toDecimalPlaces(0).toNumber();
  if (!Number.isSafeInteger(result)) fail("Iznos je izvan dozvoljenog opsega.");
  return result;
};
const amount = (n: number) => (n / 100).toFixed(2);
const json = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v));
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([key])=>!["payment_status","updated_at","updated_by"].includes(key)).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)]));
  return v;
}
function sourceHash(v: unknown) {return createHash("sha256").update(JSON.stringify(canonical(JSON.parse(JSON.stringify(v))))).digest("hex");}
export type PdvOperation = "refresh" | "save" | "post" | "lock" | "reopen";

export async function mutatePdv(context: Context, month: number, operation: PdvOperation, form: FormData) {
  if (!Number.isInteger(month) || month<1 || month>12) fail("Neispravan mjesec.");
  if (operation === "reopen" && context.user.rola !== "admin_agencije") fail("Samo administrator agencije može otključati PDV period.");
  if (!context.firma.pdv_obveznik) fail("Firma nije PDV obveznik.");
  return prisma.$transaction(async tx => {
    const years = await tx.$queryRaw<Array<{zakljucena: boolean}>>(Prisma.sql`SELECT g.zakljucena FROM poslovne_godine g JOIN firme f ON f.id=g.firma_id WHERE g.id=${context.poslovnaGodina.id}::uuid AND g.firma_id=${context.firma.id}::uuid AND f.agencija_id=${context.agencijaId}::uuid AND NOT f.is_deleted FOR UPDATE OF g`);
    if (!years.length || years[0].zakljucena) fail("Poslovna godina je zaključana.");
    const scope = {agencija_id:context.agencijaId,firma_id:context.firma.id,poslovna_godina_id:context.poslovnaGodina.id};
    const dates=periodDateRange(context.poslovnaGodina.godina,month);
    const period=await tx.pdvPeriod.upsert({where:{firma_id_poslovna_godina_id_mjesec:{firma_id:scope.firma_id,poslovna_godina_id:scope.poslovna_godina_id,mjesec:month}},update:{},create:{...scope,mjesec:month,datum_od:dates.dateFrom,datum_do:dates.dateTo,created_by:context.user.id}});
    const current=await tx.pdvPrijava.findUnique({where:{pdv_period_id:period.id},include:{stavke:{orderBy:{redosljed:"asc"}},journal:{include:{stavke:true}}}});
    if (form.get("prijava_id") && form.get("prijava_id")!==current?.id) fail("Prijava ne pripada izabranom periodu.");
    const activeJournal=current?.journal && !current.journal.is_deleted ? current.journal : null;
    const audit=async (action:string, after:unknown) => auditLogInTransaction(tx,{korisnikId:context.user.id,agencijaId:scope.agencija_id,firmaId:scope.firma_id,modul:"pdv",akcija:action,tipEntiteta:"PdvPeriod",entitetId:period.id,staraVrijednost:{period,prijava:current},novaVrijednost:after});
    if (operation === "reopen") {
      const reason=String(form.get("razlog")??"").trim();
      if (period.status!=="LOCKED" && !activeJournal) fail("Period nije zaključan niti ima aktivan PDV nalog.");
      if (reason.length<5 || reason.length>1000 || form.get("potvrda")!=="DA") fail("Unesite razlog i potvrdite otključavanje i rasknjižavanje PDV prijave.");
      if (activeJournal && activeJournal.source_type!=="PDV_RETURN") fail("Povezani nalog nije nalog PDV prijave.");
      if(period.status!=="LOCKED" && current) {
        const previous=await tx.pdvVerzija.findFirst({where:{pdv_period_id:period.id},orderBy:{broj:"desc"}});
        await tx.pdvVerzija.create({data:{pdv_period_id:period.id,broj:(previous?.broj??0)+1,created_by:context.user.id,korisnik_ime:context.user.korisnicko_ime,snapshot:json({prijava:current,period,razlog:reason})}});
      }
      // Period first, so guards allow the atomic reversal. Any later failure rolls everything back.
      await tx.pdvPeriod.update({where:{id:period.id},data:{status:"REOPENED",reopened_at:new Date(),reopened_by:context.user.id,reopen_reason:reason,updated_by:context.user.id}});
      if (activeJournal) {
        const dependencies=(await tx.kifEntry.count({where:{journal_id:activeJournal.id}}))+(await tx.kufEntry.count({where:{journal_id:activeJournal.id}}));
        if (dependencies) fail("PDV nalog ima povezane KIF/KUF račune. Prvo razriješite veze.");
        await tx.nalog.update({where:{id:activeJournal.id},data:{status:"DELETED",is_deleted:true,deleted_at:new Date(),deleted_by:context.user.id,updated_by:context.user.id}});
      }
      if (current) await tx.pdvPrijava.update({where:{id:current.id},data:{status:"DRAFT",journal_id:null,posted_at:null,posted_by:null,izvor_hash:null,updated_by:context.user.id}});
      await audit("pdv_period_otkljucan",{razlog:reason,ponistenNalog:activeJournal?.id});
      return "PDV period je otključan. Osvježite prijavu poslije ispravki. Predaja se i dalje prati u Rokovima.";
    }
    if (period.status==="LOCKED") fail("PDV period je zaključan.");
    if ((operation==="refresh"||operation==="save") && activeJournal) fail("Prijava je proknjižena. Prvo razriješite povezani PDV nalog.");
    const calculation=await calculatePdvReturn({agencijaId:scope.agencija_id,firmaId:scope.firma_id,poslovnaGodinaId:scope.poslovna_godina_id,godina:context.poslovnaGodina.godina,mjesec:month},tx);
    const hash=sourceHash({kif:calculation.kifBooks,kuf:calculation.kufBooks});
    if(operation==="refresh") {
      const totals={total_output_vat:calculation.totals.totalOutput,total_input_vat:calculation.totals.totalInput,deductible_vat:calculation.totals.deductible,non_deductible_vat:calculation.totals.nonDeductible,payable_vat:calculation.totals.payable,credit_vat:calculation.totals.credit};
      const record=await tx.pdvPrijava.upsert({where:{pdv_period_id:period.id},create:{...scope,pdv_period_id:period.id,...totals,izvor_hash:hash,created_by:context.user.id},update:{...totals,izvor_hash:hash,status:"DRAFT",journal_id:null,posted_at:null,posted_by:null,updated_by:context.user.id}});
      await tx.pdvPrijavaStavka.deleteMany({where:{pdv_prijava_id:record.id}});
      await tx.pdvPrijavaStavka.createMany({data:calculation.rows.map(row=>({pdv_prijava_id:record.id,sifra:row.sifra,opis:row.opis,redosljed:row.redosljed,kolona:row.kolona,sistemska_vrijednost:row.value}))});
      await audit("prijava_osvjezena",record);
      return "Prijava je osvježena iz KIF/KUF. Ručne korekcije su uklonjene.";
    }
    if(!current) fail("Prvo osvježite prijavu iz KIF/KUF.");
    const prijava=current!;
    if(prijava.izvor_hash!==hash) fail("KIF/KUF su promijenjeni. Osvježite prijavu iz evidencija prije nastavka.");
    if(operation==="save") {
      const values=new Map<string,number>();
      const reason=String(form.get("razlog")??"").trim();
      for(const row of prijava.stavke) {
        const raw=String(form.get(`vrijednost_${row.sifra}_${row.kolona}`)??"").trim();
        const normalized=raw.includes(",")?raw.replace(/\./g,"").replace(",","."):raw;
        if(!/^-?\d+(\.\d{1,2})?$/.test(normalized)) fail("Provjerite unesene iznose.");
        values.set(`${row.sifra}_${row.kolona}`,cents(normalized));
      }
      const get=(key:string)=>values.get(key)??0;
      for(const [grossCode,taxCode,rate] of [["10","16",21],["11","17",15],["12","18",7]] as const) {
        const originalGross=prijava.stavke.find(r=>r.sifra===grossCode&&r.kolona==="OUTPUT");
        const originalTax=prijava.stavke.find(r=>r.sifra===taxCode&&r.kolona==="OUTPUT");
        values.set(`${taxCode}_OUTPUT`,get(`${grossCode}_OUTPUT`)===cents(originalGross?.sistemska_vrijednost)
          ? cents(originalTax?.sistemska_vrijednost) : Math.round(get(`${grossCode}_OUTPUT`)*rate/(100+rate)));
      }
      if(![0,100].includes(get("9_CHECK")) || ![0,100].includes(get("30_CHECK"))) fail("Neispravna oznaka prijave.");
      const output=get("16_OUTPUT")+get("17_OUTPUT")+get("18_OUTPUT")+get("21_OUTPUT");
      const input=get("19_INPUT")+get("20_INPUT")+get("21_INPUT")+get("22_INPUT");
      const non=get("26_INPUT"),deductible=Math.max(input-non,0),payable=Math.max(output-deductible,0),credit=Math.max(deductible-output,0);
      for(const [key,val] of Object.entries({"24_OUTPUT":output,"25_INPUT":input,"27_INPUT":deductible,"28_OUTPUT":payable,"29_INPUT":credit}))values.set(key,val);
      for(const row of prijava.stavke) {
        const n=get(`${row.sifra}_${row.kolona}`),changed=n!==cents(row.sistemska_vrijednost);
        if(changed && (reason.length<5||reason.length>1000)) fail("Unesite razlog ručne korekcije (5–1000 znakova).");
        await tx.pdvPrijavaStavka.update({where:{id:row.id},data:{rucna_vrijednost:changed?amount(n):null,razlog_korekcije:changed?reason:null}});
      }
      await tx.pdvPrijava.update({where:{id:prijava.id},data:{total_output_vat:amount(output),total_input_vat:amount(input),non_deductible_vat:amount(non),deductible_vat:amount(deductible),payable_vat:amount(payable),credit_vat:amount(credit),updated_by:context.user.id}});
      await audit("prijava_sacuvana",{values:Object.fromEntries(values),razlog:reason});
      return "PDV prijava je sačuvana.";
    }
    // Mandatory controls, repeated under the same lock as posting/closing.
    const orphanCount=(await tx.kifEntry.count({where:{...scope,kif_book_id:null,is_deleted:false,invoice_date:{gte:dates.dateFrom,lte:dates.dateTo}}}))+(await tx.kufEntry.count({where:{...scope,kuf_book_id:null,is_deleted:false,invoice_date:{gte:dates.dateFrom,lte:dates.dateTo}}}));
    if(orphanCount)fail("Postoje računi bez KIF/KUF knjige i pouzdanog PDV perioda.");
    const entries=[...calculation.kifBooks.flatMap(b=>b.entries),...calculation.kufBooks.flatMap(b=>b.entries)];
    if(entries.some(e=>e.posting_status!=="POSTED"||!e.journal_id)) fail("Postoje neproknjiženi KIF/KUF računi. Provjerite PDV kontrole.");
    const ids=entries.map(e=>e.journal_id!);
    if(ids.length && await tx.nalog.count({where:{id:{in:ids},...scope,status:"POSTED",is_deleted:false}})!==new Set(ids).size) fail("KIF/KUF ima neaktivan nalog.");
    if(calculation.kifBooks.some(b=>b.entries.some(e=>e.vat_transaction_type==="EXPORT"&&cents(e.total_output_vat)!==0))) fail("Izvoz ima izlazni PDV.");
    if(calculation.kufBooks.some(b=>b.entries.some(e=>e.vat_transaction_type==="IMPORT"&&!e.customs_declaration_number))) fail("Uvoznom računu nedostaje JCI broj.");
    const postingAmounts=calculatePdvPostingAmounts(calculation.kifBooks,calculation.kufBooks);
    const settings=await effectivePdvSettings(tx, context.firma.id, context.poslovnaGodina.id, true);
    const value=(code:string,column:string)=>cents(prijava.stavke.find(r=>r.sifra===code&&r.kolona===column)?.rucna_vrijednost??prijava.stavke.find(r=>r.sifra===code&&r.kolona===column)?.sistemska_vrijednost);
    postingAmounts.set("VAT_PAYABLE",value("28","OUTPUT")/100);postingAmounts.set("VAT_CREDIT",value("29","INPUT")/100);
    const nonzero=[...postingAmounts].filter(([,v])=>cents(v)!==0);
    // Zero declarations can be locked without manufacturing an empty journal.
    if(nonzero.length && !settings?.vrsta_naloga) fail("Podesite šemu knjiženja PDV-a.");
    const lines=nonzero.map(([code,n])=>{
      const rule=settings?.pravila.find(r=>r.polje_sifra===code);
      if(!rule?.konto || !rule.konto.aktivan || rule.konto.sifra.length<4 || rule.konto.tip_konta!=="analiticko" || rule.konto.analitika_obavezna) fail(`Neispravan konto za ${code}.`);
      const v=cents(n);return {konto_id:rule!.konto_id!,duguje:rule!.smjer==="D"?v:0,potrazuje:rule!.smjer==="P"?v:0,opis:rule!.polje_naziv,code};
    });
    if(lines.reduce((n,l)=>n+l.duguje-l.potrazuje,0)!==0) fail("Šema/korekcije daju nebalansiran PDV nalog. Uskladite kontrole.");
    // Input/output balances must agree with the return. VAT_RETURN itself is excluded.
    const expected=new Map<string,number>();
    for(const rule of settings?.pravila??[])if(rule.konto_id&&!["VAT_PAYABLE","VAT_CREDIT"].includes(rule.polje_sifra))expected.set(rule.konto_id,0);
    for(const line of lines.filter(l=>!["VAT_PAYABLE","VAT_CREDIT"].includes(l.code)))expected.set(line.konto_id,(expected.get(line.konto_id)??0)+line.potrazuje-line.duguje);
    const ledger=await tx.stavkaNaloga.findMany({where:{konto_id:{in:[...expected.keys()]},nalog:{...scope,status:"POSTED",is_deleted:false,datum:{gte:dates.dateFrom,lte:dates.dateTo},source_type:{not:"PDV_RETURN"}}}});
    for(const [account,n] of expected)if(ledger.filter(l=>l.konto_id===account).reduce((sum,l)=>sum+cents(l.duguje)-cents(l.potrazuje),0)!==n)fail("PDV evidencija nije usklađena sa glavnom knjigom. Otvorite Kontrole.");
    if(operation==="post") {
      if(activeJournal)fail("Prijava je već proknjižena.");
      if(!lines.length)fail("Nema iznosa za knjiženje. Nultu prijavu možete zaključati bez naloga.");
      const kind=settings!.vrsta_naloga!;
      const last=await tx.nalog.findFirst({where:{...scope,vrsta_naloga_id:kind.id},orderBy:{broj:"desc"}});
      const number=(last?.broj??0)+1;
      const journal=await tx.nalog.create({data:{...scope,vrsta_naloga_id:kind.id,broj:number,sifra:formatJournalCode(kind.prefiks,context.poslovnaGodina.godina,number),datum:dates.dateTo,datum_knjizenja:dates.dateTo,opis:`PDV ${month}/${context.poslovnaGodina.godina}`,status:"POSTED",source_type:"PDV_RETURN",source_module:"PDV",izvorni_dokument_id:prijava.id,created_by:context.user.id,stavke:{create:lines.map((l,i)=>({konto_id:l.konto_id,duguje:amount(l.duguje),potrazuje:amount(l.potrazuje),opis:l.opis,redni_broj:i+1,datum_dokumenta:dates.dateTo}))}}});
      await tx.pdvPrijava.update({where:{id:prijava.id},data:{status:"POSTED",journal_id:journal.id,posted_at:new Date(),posted_by:context.user.id,updated_by:context.user.id}});
      await audit("prijava_proknjizena",{nalog:journal.id});return "PDV prijava je proknjižena.";
    }
    if(form.get("potvrda")!=="DA")fail("Potvrdite zaključavanje perioda.");
    if(lines.length && (!activeJournal || activeJournal.status!=="POSTED"))fail("Prvo proknjižite PDV prijavu.");
    if(activeJournal && JSON.stringify(activeJournal.stavke.map(l=>[l.konto_id,cents(l.duguje),cents(l.potrazuje)]).sort())!==JSON.stringify(lines.map(l=>[l.konto_id,l.duguje,l.potrazuje]).sort()))fail("Nalog ne odgovara prijavi/šemi. Uskladite knjiženje prije zaključavanja.");
    const last=await tx.pdvVerzija.findFirst({where:{pdv_period_id:period.id},orderBy:{broj:"desc"}});
    await tx.pdvVerzija.create({data:{pdv_period_id:period.id,broj:(last?.broj??0)+1,created_by:context.user.id,korisnik_ime:context.user.korisnicko_ime,snapshot:json({prijava,izvori:calculation,period})}});
    await tx.pdvPrijava.update({where:{id:prijava.id},data:{status:"LOCKED",updated_by:context.user.id}});
    await tx.pdvPeriod.update({where:{id:period.id},data:{status:"LOCKED",locked_at:new Date(),locked_by:context.user.id,updated_by:context.user.id}});
    await audit("pdv_period_zakljucan",{verzija:(last?.broj??0)+1});
    return "PDV period je zaključan. Predaju pratite na stranici Rokovi.";
  },{timeout:30000});
}
