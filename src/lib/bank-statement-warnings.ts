import "server-only";
import { prisma } from "./prisma";
import type { Korisnik } from "@prisma/client";
type WarningUser = Pick<Korisnik, "id" | "agencija_id" | "rola">;
import { bankStatementGaps } from "./bank-statement-gaps";

export async function warningCompanies(user: WarningUser) {
  if (!user.agencija_id || !["admin_agencije", "korisnik_agencije"].includes(user.rola)) return [];
  return prisma.firma.findMany({
    where: {agencija_id:user.agencija_id, is_deleted:false, aktivan:true,
      ...(user.rola === "admin_agencije" ? {} : {
        korisnici: {some: {korisnik_id:user.id,is_deleted:false}},
        prava: {some: {agencija_id:user.agencija_id,korisnik_id:user.id,modul:"izvodi",akcija:"view",dozvoljeno:true}}
      })},
    select:{id:true,naziv:true,pib:true,poslovne_godine:{select:{id:true,godina:true},orderBy:{godina:"desc"}}},
    orderBy:{naziv:"asc"}
  });
}

export async function loadBankStatementWarnings(user: WarningUser, year: number, companyId?: string) {
  const companies = await warningCompanies(user);
  const selected = companies.filter(company => !companyId || company.id === companyId);
  const years = selected.flatMap(company => company.poslovne_godine.filter(y => y.godina === year).map(y=>({...y,company})));
  const rows = await Promise.all(years.map(async ({id:yearId,company}) => {
    const accounts = await prisma.firmaBankovniRacun.findMany({
      where:{agencija_id:user.agencija_id!,firma_id:company.id,is_deleted:false},
      select:{id:true,naziv_banke:true,broj_racuna:true,aktivan:true,bankStatements:{
        where:{agencija_id:user.agencija_id!,firma_id:company.id,poslovna_godina_id:yearId,is_deleted:false},
        select:{id:true,statement_number:true,statement_date:true},
        orderBy:[{statement_date:"desc"},{id:"asc"}]
      }},orderBy:[{naziv_banke:"asc"},{broj_racuna:"asc"}]
    });
    return accounts.filter(account=>account.aktivan || account.bankStatements.length).map(account=>({
      company,yearId,account,
      ...bankStatementGaps(account.bankStatements.map(s=>s.statement_number),year)
    }));
  }));
  return {companies, rows:rows.flat().sort((a,b)=>b.missingCount-a.missingCount || b.unrecognized.length-a.unrecognized.length || a.company.naziv.localeCompare(b.company.naziv,"sr-Latn")),
    withoutYear: selected.filter(c=>!c.poslovne_godine.some(y=>y.godina===year)),
    withoutAccounts: years.filter((_,i)=>rows[i].length===0).map(y=>y.company)};
}
