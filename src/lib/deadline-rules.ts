export const deadlineNames = {PDV:"PDV",PLATE:"Plate",ZAVRSNI:"Završni račun"} as const;
export type DeadlineKind = keyof typeof deadlineNames;
export function localToday(now=new Date()) {
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Podgorica",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
  const field=(type:string)=>parts.find(p=>p.type===type)!.value;
  return new Date(`${field("year")}-${field("month")}-${field("day")}T00:00:00Z`);
}
export function deadlineDate(kind:DeadlineKind,year:number,month:number) {return new Date(Date.UTC(year,month-1,kind==="ZAVRSNI"?31:15));}
export function deadlinePeriod(kind:DeadlineKind,year:number,month:number) {return kind==="ZAVRSNI"?String(year-1):`${month===1?12:month-1}/${month===1?year-1:year}`;}
export function deadlineState(due:Date,complete:boolean,today=localToday()) {
  if(complete)return "Završeno";
  const days=Math.round((due.getTime()-today.getTime())/86400000);
  return days<0?"Kasni":days===0?"Danas ističe":days<=5?"Uskoro ističe":"Predstoji";
}
export function validDeadline(kind:string,year:number,month:number):kind is DeadlineKind {
 return Object.hasOwn(deadlineNames,kind)&&Number.isInteger(year)&&year>=2000&&year<=2100&&Number.isInteger(month)&&month>=1&&month<=12&&(kind!=="ZAVRSNI"||month===3);
}

export const annualChecklist = {
 izvodi: "Izvodi provjereni", kupci: "Kupci usaglašeni", dobavljaci: "Dobavljači usaglašeni",
 plate: "Plate provjerene", amortizacija: "Amortizacija provjerena", pdv: "PDV provjeren",
 dobit: "Dobit obračunata", izvjestaj: "Završni račun pripremljen", dobit_predata: "Prijava dobiti predata"
} as const;
export function deadlineSelection(kind: DeadlineKind, period?: string, now = new Date()) {
 const today = localToday(now);
 const fallback = kind === "ZAVRSNI" ? String(today.getUTCFullYear()-1)
   : new Date(Date.UTC(today.getUTCFullYear(),today.getUTCMonth()-1,1)).toISOString().slice(0,7);
 const valid = kind === "ZAVRSNI" ? /^20\d{2}$/.test(period??"") : /^20\d{2}-(0[1-9]|1[0-2])$/.test(period??"");
 const selected = valid ? period! : fallback;
 const [y,m] = selected.split("-").map(Number);
 const year = kind === "ZAVRSNI" || m === 12 ? y+1 : y;
 const month = kind === "ZAVRSNI" ? 3 : m === 12 ? 1 : m+1;
 return {period:selected,year,month,due:deadlineDate(kind,year,month)};
}
