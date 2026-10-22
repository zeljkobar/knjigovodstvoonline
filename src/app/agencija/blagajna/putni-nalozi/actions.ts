"use server";
import { effectiveTravelSettings } from "@/lib/posting-template";
import { hasPermission } from "@/lib/permissions";
import { formatJournalCode } from "@/lib/journals";
import { travelPostingAccount, travelJournalType, travelPostingAmounts, validateTravelScheme, travelCentsDecimal } from "@/lib/travel-posting";
import { Prisma } from "@prisma/client";
import initialRoutes from "@/lib/travel-routes.json";
import { prisma } from "@/lib/prisma";
import { auditLogInTransaction } from "@/lib/audit";
import { jobPositions } from "@/lib/job-positions";
import { travelContext, travelPath } from "./context";
import { TravelError, fuelRate, travelVehicle, calculateTravel, city, dailyCount, routeKey, travelDate, travelDefaults, travelDuration, travelMoney, travelNumber, type TravelData, type TravelSettings } from "@/lib/travel-orders";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { travelCountries, travelCountry, countryDaily } from "@/lib/travel-countries";

const uuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
function reader(form: FormData) {
  return (key: string, max = 200) => { const s = String(form.get(key) ?? "").trim(); if(s.length > max) throw new TravelError("Tekst je predugačak."); return s; };
}
async function lockedContext(tx: Prisma.TransactionClient, c: Awaited<ReturnType<typeof travelContext>>, form: FormData) {
  if(form.get("firma_id") !== c.firma.id || form.get("godina_id") !== c.godina.id) throw new TravelError("Promijenjen je izbor firme ili godine. Ponovo otvorite obrazac.");
  await tx.$queryRaw`SELECT id FROM firme WHERE id=${c.firma.id}::uuid FOR UPDATE`;
  const firm = await tx.firma.findFirst({where:{id:c.firma.id,agencija_id:c.agencyId,aktivan:true,is_deleted:false,...(c.user.rola === "admin_agencije" ? {} : {korisnici:{some:{korisnik_id:c.user.id,is_deleted:false}}})}});
  if(!firm) throw new TravelError("Firma nije dostupna.");
  await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${c.godina.id}::uuid FOR UPDATE`;
  if(!await tx.poslovnaGodina.findFirst({where:{id:c.godina.id,firma_id:c.firma.id,zakljucena:false}})) throw new TravelError("Poslovna godina je zaključana.");
}
async function lockReturnYears(tx: Prisma.TransactionClient, c: Awaited<ReturnType<typeof travelContext>>, end: string) {
  if(!end) return;
  const lastYear=travelDate(end.slice(0,10)).getUTCFullYear();
  for(let year=c.godina.godina+1;year<=lastYear;year++) {
    const row=await tx.poslovnaGodina.findFirst({where:{firma_id:c.firma.id,godina:year}});
    if(!row) throw new TravelError(`Za povratak u ${year}. prvo otvorite tu poslovnu godinu firme.`);
    await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${row.id}::uuid FOR UPDATE`;
    if((await tx.poslovnaGodina.findUnique({where:{id:row.id}}))?.zakljucena) throw new TravelError("Godina povratka je zaključana.");
  }
}
function failure(e: unknown): never {
  if(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") redirect(`${travelPath}?greska=${encodeURIComponent("Broj naloga već postoji u ovoj godini.")}`);
  if(e instanceof TravelError) redirect(`${travelPath}?greska=${encodeURIComponent(e.message)}`);
  throw e;
}
export async function saveTravel(form: FormData) {
  const id = String(form.get("id") ?? ""), deleting = form.get("akcija") === "obrisi";
  const c = await travelContext(deleting ? "delete" : id ? "update" : "create");
  let savedId = id;
  try {
    const t = reader(form);
    if(id && !uuid(id)) throw new TravelError("Neispravan nalog.");
    await prisma.$transaction(async tx => {
      await lockedContext(tx,c,form);
      const scope = {agencija_id:c.agencyId,firma_id:c.firma.id,poslovna_godina_id:c.godina.id,is_deleted:false};
      const old = id ? await tx.putniNalog.findFirst({where:{id,...scope}}) : null;
      if(id && (!old || old.updated_at.toISOString() !== t("verzija"))) throw new TravelError("Nalog je promijenjen. Osvježite stranicu.");
      if(old?.nalog_id) throw new TravelError("Proknjiženi putni nalog se ne može mijenjati ili brisati.");
      if(old) await lockReturnYears(tx,c,(old.podaci as unknown as TravelData).povratak);
      if(deleting) {
        if(!old) throw new TravelError("Nalog nije pronađen.");
        const deleted = await tx.putniNalog.update({where:{id},data:{is_deleted:true,deleted_at:new Date(),deleted_by:c.user.id,updated_by:c.user.id}});
        await auditLogInTransaction(tx,{korisnikId:c.user.id,agencijaId:c.agencyId,firmaId:c.firma.id,modul:"putni_nalozi",akcija:"delete",tipEntiteta:"PutniNalog",entitetId:id,staraVrijednost:old,novaVrijednost:deleted});
        return;
      }
      const broj = t("broj",80), datum = travelDate(t("datum")), status = t("status"), radnikId = t("radnikId");
      if(!broj || !["DRAFT","COMPLETED"].includes(status) || !uuid(radnikId) || datum < c.godina.datum_od || datum > c.godina.datum_do) throw new TravelError("Provjerite broj, datum, status i zaposlenog.");
      const worker = await tx.plateRadnik.findFirst({where:{id:radnikId,agencija_id:c.agencyId,firma_id:c.firma.id,is_deleted:false},select:{ime:true,prezime:true,radno_mjesto:true,radno_mjesto_id:true}});
      if(!worker) throw new TravelError("Zaposleni ne pripada izabranoj firmi.");
      const settingsRow = await effectiveTravelSettings(tx,c.firma.id);
      const settings = settingsRow ? settingsRow.podaci as unknown as TravelSettings : travelDefaults;
      const polazak = t("polazak"), povratak = t("povratak");
      if(!polazak) throw new TravelError("Unesite polazak.");
      const departure = travelDate(polazak.slice(0,10));
      if(departure < c.godina.datum_od || departure > c.godina.datum_do) throw new TravelError("Polazak mora biti u izabranoj godini.");
      let minutes = 0;
      // Validate departure even for a pre-travel draft.
      travelDuration(polazak,polazak);
      if(povratak) {
        minutes = travelDuration(polazak,povratak);
        await lockReturnYears(tx,c,povratak);
      }
      if(status === "COMPLETED" && (!povratak || minutes <= 0)) throw new TravelError("Za završen obračun unesite vrijeme povratka poslije polaska.");
      if(form.get("zapamti") === "on") await tx.$queryRaw`SELECT id FROM agencije WHERE id=${c.agencyId}::uuid FOR UPDATE`;
      const drzava = travelCountry(t("drzava")).kod;
      const odlazakPrevoz=travelVehicle(t("odlazakPrevoz")), povratakPrevoz=travelVehicle(t("povratakPrevoz"));
      const gorivo=travelMoney(t("gorivo")||"0");
      fuelRate(gorivo,odlazakPrevoz);
      const relacije: TravelData["relacije"] = [];
      for(let i=0;i<12;i++) {
        const od = city(t(`od_${i}`,80)), dest = city(t(`do_${i}`,80));
        if(!od && !dest) continue;
        const odDrzava=travelCountry(t(`odDrzava_${i}`)).kod, doDrzava=travelCountry(t(`doDrzava_${i}`)).kod;
        if(!od || !dest || (od === dest && odDrzava === doDrzava) || /[|:]/.test(od+dest)) throw new TravelError("Relacija mora imati dva različita grada.");
        const km = travelNumber(t(`km_${i}`),100000), prevoz = travelVehicle(t(`prevoz_${i}`,80)), stopa10000 = fuelRate(gorivo,prevoz);
        if(!km || !prevoz) throw new TravelError("Unesite kilometražu i vrstu prevoza.");
        if(prevoz === "SOPSTVENO VOZILO" && !gorivo) throw new TravelError("Za sopstveno vozilo unesite cijenu litra goriva.");
        relacije.push({od,do:dest,odDrzava,doDrzava,km,cijena:0,stopa10000,prevoz,iznos:0});
        if(form.get("zapamti") === "on") {
          // New routes only. Editing a document never changes a known tariff/distance.
          const key = routeKey(od,dest,odDrzava,doDrzava);
          if(!initialRoutes.some(r=>r.kljuc === key)) {
            const exists = await tx.putnaRelacija.findUnique({where:{agencija_id_kljuc:{agencija_id:c.agencyId,kljuc:key}}});
            if(!exists) {
              const route = await tx.putnaRelacija.create({data:{agencija_id:c.agencyId,kljuc:key,polazak:od,odrediste:dest,polazak_drzava:odDrzava,odrediste_drzava:doDrzava,km}});
              await auditLogInTransaction(tx,{korisnikId:c.user.id,agencijaId:c.agencyId,modul:"putni_nalozi",akcija:"relacija_create",tipEntiteta:"PutnaRelacija",entitetId:route.id,novaVrijednost:route});
            }
          }
        }
      }
      const troskovi: TravelData["troskovi"] = [];
      for(let i=0;i<8;i++) { const opis=t(`trosak_${i}`), raw=t(`iznos_${i}`); if(!opis && !raw) continue; if(!opis) throw new TravelError("Unesite opis troška."); troskovi.push({opis,iznos:travelMoney(raw||"0")}); }
      const dnevnica = t("dnevnica") ? travelMoney(t("dnevnica")) : countryDaily(drzava,settings), akontacija = travelMoney(t("akontacija")||"0");
      const previous = old?.podaci as unknown as TravelData | undefined;
      const polaSati = previous?.polaSati ?? settings.polaSati, punaSati = previous?.punaSati ?? settings.punaSati;
      const brojDnevnica = t("brojDnevnica") === "" ? dailyCount(minutes,polaSati,punaSati) : travelNumber(t("brojDnevnica"),366);
      if(!Number.isInteger(brojDnevnica*2)) throw new TravelError("Broj dnevnica mora biti cijeli broj ili polovina.");
      // Preserve employee/company snapshots unless employee selection actually changes.
      const job = (await jobPositions(c.agencyId,tx)).find(j=>j.id===worker.radno_mjesto_id);
      const data: TravelData = {
        drzava,gorivo,obracunVerzija:2,
        firma:previous?.firma ?? c.firma.naziv,radnikId,radnik:previous?.radnikId===radnikId?previous.radnik:`${worker.prezime} ${worker.ime}`,pozicija:t("pozicija") || job?.naziv || worker.radno_mjesto || "",
        svrha:t("svrha",1000),odrediste:t("odrediste"),polazak,povratak,registracija:t("registracija",80),odlazakPrevoz,povratakPrevoz,mjesto:t("mjesto"),teret:t("teret"),izvjestaj:t("izvjestaj",4000),prilozi:travelNumber(t("prilozi")||"0",999,1),akontacija,dnevnica,brojDnevnica,rucneDnevnice:t("brojDnevnica")!=="",sati:minutes/60,relacije,troskovi,dnevniceUkupno:0,ukupno:0,razlika:0,polaSati,punaSati
      };
      if(!data.svrha || !data.odrediste || !Number.isInteger(data.prilozi)) throw new TravelError("Unesite svrhu, odredište i cijeli broj priloga.");
      Object.assign(data,calculateTravel(data));
      const values = {broj,datum,status,podaci:data as unknown as Prisma.InputJsonValue,updated_by:c.user.id};
      const saved = old ? await tx.putniNalog.update({where:{id},data:values}) : await tx.putniNalog.create({data:{...scope,...values,created_by:c.user.id}});
      savedId = saved.id;
      await auditLogInTransaction(tx,{korisnikId:c.user.id,agencijaId:c.agencyId,firmaId:c.firma.id,modul:"putni_nalozi",akcija:old?"update":"create",tipEntiteta:"PutniNalog",entitetId:saved.id,staraVrijednost:old,novaVrijednost:saved});
    });
  } catch(e) { failure(e); }
  revalidatePath(travelPath);
  redirect(deleting ? `${travelPath}?poruka=Obrisano` : `${travelPath}?id=${savedId}&poruka=${encodeURIComponent("Sačuvano")}`);
}

export async function saveTravelConfiguration(form: FormData) {
  const route = form.get("vrsta") === "relacija";
  const c = await travelContext("manage");
  if(c.user.rola !== "admin_agencije") redirect("/agencija?greska=prava");
  try {
    const t=reader(form);
    await prisma.$transaction(async tx=>{
      await lockedContext(tx,c,form);
      if(route) {
        if(t("relacija_id") && !uuid(t("relacija_id"))) throw new TravelError("Neispravna relacija.");
        const polazak=city(t("polazak",80)),odrediste=city(t("odrediste",80)),km=travelNumber(t("km"),100000);
        const polazak_drzava=travelCountry(t("polazak_drzava")).kod,odrediste_drzava=travelCountry(t("odrediste_drzava")).kod,kljuc=routeKey(polazak,odrediste,polazak_drzava,odrediste_drzava);
        if(!polazak||!odrediste||(polazak===odrediste&&polazak_drzava===odrediste_drzava)||/[|:]/.test(polazak+odrediste)||!km) throw new TravelError("Unesite različite gradove i kilometražu veću od nule.");
        // Serialise all shared route edits in this agency.
        await tx.$queryRaw`SELECT id FROM agencije WHERE id=${c.agencyId}::uuid FOR UPDATE`;
        const old=t("relacija_id") ? await tx.putnaRelacija.findFirst({where:{id:t("relacija_id"),agencija_id:c.agencyId}}) : await tx.putnaRelacija.findUnique({where:{agencija_id_kljuc:{agencija_id:c.agencyId,kljuc}}});
        if(t("relacija_id") && !old) throw new TravelError("Relacija nije pronađena.");
        if((old?.updated_at.toISOString()??"")!==t("verzija")) throw new TravelError("Relacija je promijenjena. Osvježite stranicu.");
        const values={kljuc,polazak,odrediste,polazak_drzava,odrediste_drzava,km};
        const saved=old ? await tx.putnaRelacija.update({where:{id:old.id},data:values}) : await tx.putnaRelacija.create({data:{agencija_id:c.agencyId,...values}});
        await auditLogInTransaction(tx,{korisnikId:c.user.id,agencijaId:c.agencyId,modul:"putni_nalozi",akcija:"relacija_save",tipEntiteta:"PutnaRelacija",entitetId:saved.id,staraVrijednost:old,novaVrijednost:saved});
      } else {
        const old=await tx.putniPodesavanje.findUnique({where:{firma_id:c.firma.id}});
        if((old?.updated_at.toISOString()??"")!==t("verzija")) throw new TravelError("Podešavanja su promijenjena. Osvježite stranicu.");
        const knjizenje = { dnevnice:t("konto_dnevnice",40), kilometraza:t("konto_kilometraza",40), ostalo:t("konto_ostalo",40), obaveza:t("konto_obaveza",40), vrstaNaloga:t("vrsta_naloga",36) };
        await validateTravelScheme(tx,knjizenje,c.agencyId,c.firma.id);
        const podaci:TravelSettings={knjizenje,dnevnica:travelMoney(t("dnevnica")),kilometar:0,gorivo:travelMoney(t("gorivo")||"0"),dnevniceDrzava:Object.fromEntries(travelCountries.filter(row=>t(`drzava_${row.kod}`)!=="").map(row=>[row.kod,travelMoney(t(`drzava_${row.kod}`))])),polaSati:travelNumber(t("polaSati"),23),punaSati:travelNumber(t("punaSati"),23),teret:t("teret"),mjesto:t("mjesto")};
        fuelRate(podaci.gorivo??0,"SOPSTVENO VOZILO");
        if(podaci.polaSati>=podaci.punaSati) throw new TravelError("Prag pune dnevnice mora biti veći od praga polovine.");
        const data=podaci as unknown as Prisma.InputJsonValue;
        const saved=await tx.putniPodesavanje.upsert({where:{firma_id:c.firma.id},create:{firma_id:c.firma.id,agencija_id:c.agencyId,podaci:data},update:{podaci:data}});
        await auditLogInTransaction(tx,{korisnikId:c.user.id,agencijaId:c.agencyId,firmaId:c.firma.id,modul:"putni_nalozi",akcija:"podesavanja_save",tipEntiteta:"PutniPodesavanje",entitetId:saved.id,staraVrijednost:old,novaVrijednost:saved});
      }
    });
  } catch(e) { failure(e); }
  revalidatePath(travelPath);
  redirect(`${travelPath}/${route?"relacije":"podesavanja"}?poruka=${encodeURIComponent("Sačuvano")}`);
}

export async function postTravel(form: FormData) {
  const c = await travelContext("post");
  if (!await hasPermission(c.user,{firmaId:c.firma.id,modul:"nalozi",akcija:"post"})) redirect("/agencija?greska=prava");
  const t=reader(form),id=t("id",36);
  try {
    if(!uuid(id)) throw new TravelError("Neispravan putni nalog.");
    await prisma.$transaction(async tx=>{
      await lockedContext(tx,c,form);
      await tx.$queryRaw`SELECT id FROM putni_nalozi WHERE id=${id}::uuid FOR UPDATE`;
      const row=await tx.putniNalog.findFirst({where:{id,agencija_id:c.agencyId,firma_id:c.firma.id,poslovna_godina_id:c.godina.id,is_deleted:false}});
      if(!row) throw new TravelError("Putni nalog nije pronađen.");
      if(row.nalog_id) throw new TravelError("Putni nalog je već proknjižen.");
      if(row.updated_at.toISOString()!==t("verzija")) throw new TravelError("Nalog je promijenjen. Osvježite stranicu.");
      if(row.status!=="COMPLETED") throw new TravelError("Prvo završite obračun putnog naloga.");
      const data=row.podaci as unknown as TravelData;
      await lockReturnYears(tx,c,data.povratak);
      const datum=travelDate(t("datum_knjizenja"));
      if(!data.povratak || datum<travelDate(data.povratak.slice(0,10))) throw new TravelError("Datum knjiženja mora biti na dan povratka ili poslije povratka.");
      const postingYear=await tx.poslovnaGodina.findFirst({where:{firma_id:c.firma.id,godina:datum.getUTCFullYear(),datum_od:{lte:datum},datum_do:{gte:datum}}});
      if(!postingYear) throw new TravelError("Prvo otvorite poslovnu godinu datuma knjiženja.");
      await tx.$queryRaw`SELECT id FROM poslovne_godine WHERE id=${postingYear.id}::uuid FOR UPDATE`;
      if((await tx.poslovnaGodina.findUniqueOrThrow({where:{id:postingYear.id}})).zakljucena) throw new TravelError("Godina knjiženja je zaključana.");
      const periods=await tx.$queryRaw<{status:string}[]>`SELECT status FROM pdv_periodi WHERE firma_id=${c.firma.id}::uuid AND datum_od<=${datum} AND datum_do>=${datum} FOR UPDATE`;
      if(periods.some(p=>p.status==="LOCKED")) throw new TravelError("PDV period je zaključan.");
      const settings=await effectiveTravelSettings(tx,c.firma.id);
      const scheme=(settings?.podaci as unknown as TravelSettings | undefined)?.knjizenje;
      if(!scheme) throw new TravelError("Prvo podesite šemu knjiženja putnih naloga.");
      const amounts=travelPostingAmounts(data), type=await travelJournalType(tx,scheme.vrstaNaloga,c.agencyId,c.firma.id);
      const partnerId=t("komitent_id",36), unitId=t("poslovna_jedinica_id",36);
      if(partnerId && (!uuid(partnerId)||!await tx.komitent.findFirst({where:{id:partnerId,OR:[{agencija_id:null},{agencija_id:c.agencyId,firma_id:null},{agencija_id:c.agencyId,firma_id:c.firma.id}]}}))) throw new TravelError("Partner nije dostupan u ovoj firmi.");
      if(unitId && (!uuid(unitId)||!await tx.poslovnaJedinica.findFirst({where:{id:unitId,agencija_id:c.agencyId,firma_id:c.firma.id,aktivna:true,is_deleted:false}}))) throw new TravelError("Poslovna jedinica nije dostupna.");
      const lines=[];
      for(const key of ["dnevnice","kilometraza","ostalo","obaveza"] as const) {
        if(!amounts[key]) continue;
        const account=await travelPostingAccount(tx,c.firma.id,scheme[key]);
        if(account.analitika_obavezna&&!partnerId) throw new TravelError(`Za konto ${account.sifra} izaberite zaposlenog kao partnera za knjiženje.`);
        if(account.koristi_radnu_jedinicu&&!unitId) throw new TravelError(`Za konto ${account.sifra} izaberite poslovnu jedinicu.`);
        lines.push({konto_id:account.id,komitent_id:partnerId||null,poslovna_jedinica_id:unitId||null,duguje:key==="obaveza"?"0":travelCentsDecimal(amounts[key]),potrazuje:key==="obaveza"?travelCentsDecimal(amounts[key]):"0",opis:`Putni nalog ${row.broj} · ${data.radnik} · ${key}`,broj_dokumenta:row.broj,datum_dokumenta:datum,redni_broj:lines.length+1,created_by:c.user.id,updated_by:c.user.id});
      }
      await tx.$queryRaw`SELECT id FROM vrste_naloga WHERE id=${type.id}::uuid FOR UPDATE`;
      const last=await tx.nalog.findFirst({where:{firma_id:c.firma.id,poslovna_godina_id:postingYear.id,vrsta_naloga_id:type.id},orderBy:{broj:"desc"},select:{broj:true}});
      const number=(last?.broj??0)+1;
      const journal=await tx.nalog.create({data:{agencija_id:c.agencyId,firma_id:c.firma.id,poslovna_godina_id:postingYear.id,vrsta_naloga_id:type.id,broj:number,sifra:formatJournalCode(type.prefiks,postingYear.godina,number),datum,datum_knjizenja:datum,poslovna_jedinica_id:unitId||null,opis:`Putni nalog ${row.broj} · ${data.radnik}`,status:"POSTED",source_type:"TRAVEL_ORDER",source_module:"PUTNI_NALOZI",izvorni_dokument_id:row.id,kreirao_korisnik_id:c.user.id,created_by:c.user.id,updated_by:c.user.id,proknjizen_by:c.user.id,proknjizen_at:new Date(),stavke:{create:lines}}});
      const posted=await tx.putniNalog.update({where:{id},data:{nalog_id:journal.id,updated_by:c.user.id}});
      await auditLogInTransaction(tx,{korisnikId:c.user.id,agencijaId:c.agencyId,firmaId:c.firma.id,modul:"putni_nalozi",akcija:"post",tipEntiteta:"PutniNalog",entitetId:id,staraVrijednost:row,novaVrijednost:posted});
      await auditLogInTransaction(tx,{korisnikId:c.user.id,agencijaId:c.agencyId,firmaId:c.firma.id,modul:"agencija.nalozi",akcija:"post",tipEntiteta:"Nalog",entitetId:journal.id,novaVrijednost:{...journal,stavke:lines}});
    });
  } catch(e) { failure(e); }
  revalidatePath(travelPath);revalidatePath("/agencija/nalozi");revalidatePath("/agencija/bruto-bilans");
  redirect(`${travelPath}?id=${id}&poruka=${encodeURIComponent("Putni nalog je proknjižen.")}`);
}
