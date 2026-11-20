import "server-only";
import { prisma } from "./prisma";
import { fiscalAdminApi, type FiscalActor } from "./fiscal-admin-api";
import { auditLogInTransaction } from "./audit";

export class PosSetupError extends Error {}
export async function readPlatformPosSetup(actor: FiscalActor, firmaId: string, loadRemote = true) {
  const firm = await prisma.firma.findFirst({where:{id:firmaId,aktivan:true,is_deleted:false,agencija:{aktivan:true,is_deleted:false}},include:{fiscalCompanyLink:true,posPodesavanje:true}});
  if(!firm) throw new PosSetupError("FIRMA");
  const registers=await prisma.posRegister.findMany({where:{firma_id:firm.id,agencija_id:firm.agencija_id,is_deleted:false},orderBy:{sifra:"asc"}});
  const link=firm.fiscalCompanyLink;
  if(!loadRemote || !link?.fiscal_api_company_id || link.is_suspended) return {firm,registers,remote:null};
  const id=link.fiscal_api_company_id;
  const [company,readiness,units,devices,operators]=await Promise.all([fiscalAdminApi.getCompany(id,actor),fiscalAdminApi.getReadiness(id,actor),fiscalAdminApi.listBusinessUnits(id,actor),fiscalAdminApi.listDevices(id,actor),fiscalAdminApi.listOperators(id,actor)]);
  if(company.data.id!==id || readiness.data.companyId!==id || company.data.environment!==link.fiscal_environment) throw new PosSetupError("OKRUZENJE");
  return {firm,registers,remote:{company:company.data,ready:company.data.isActive && readiness.data.isReady,
    units:units.data.filter(x=>x.companyId===id && x.isActive && (!x.environment || x.environment===company.data.environment)),
    devices:devices.data.filter(x=>x.companyId===id && x.isActive && Boolean(x.tcrCode?.trim())),
    operators:operators.data.filter(x=>x.companyId===id && x.isActive && (!x.environment || x.environment===company.data.environment))}};
}
export async function savePlatformPosSetup(input:{actor:FiscalActor & {rola:string};firmaId:string;version:string;registerId:string;registerVersion:string;unitId:string;deviceId:string;operatorId:string;enabled:boolean}) {
  if(input.actor.rola!=="admin") throw new PosSetupError("SAMO_ADMIN");
  const snapshot=await readPlatformPosSetup(input.actor,input.firmaId,input.enabled);
  const remote=snapshot.remote;
  const unit=remote?.units.find(x=>x.id===input.unitId),device=remote?.devices.find(x=>x.id===input.deviceId && x.businessUnitId===unit?.id),operator=remote?.operators.find(x=>x.id===input.operatorId);
  if(input.enabled && (!remote?.ready || !unit || !device || !operator)) throw new PosSetupError("NIJE_SPREMNO");
  return prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT id FROM firme WHERE id = ${input.firmaId}::uuid FOR UPDATE`;
    const firm=await tx.firma.findFirst({where:{id:input.firmaId,agencija_id:snapshot.firm.agencija_id,aktivan:true,is_deleted:false,agencija:{aktivan:true,is_deleted:false}},include:{fiscalCompanyLink:true,posPodesavanje:true}});
    if(!firm || firm.fiscalCompanyLink?.updated_at.toISOString()!==snapshot.firm.fiscalCompanyLink?.updated_at.toISOString() || (firm.posPodesavanje?.updated_at.toISOString()??"new")!==input.version) throw new PosSetupError("ZASTARJELO");
    const before=firm.posPodesavanje;
    if(!input.enabled){
      if(!before) throw new PosSetupError("NIJE_PODESENO");
      const settings=await tx.posPodesavanje.update({where:{id:before.id},data:{aktivan:false,updated_by:input.actor.id}});
      await auditLogInTransaction(tx,{korisnikId:input.actor.id,agencijaId:firm.agencija_id,firmaId:firm.id,modul:"admin.fiskalizacija",akcija:"pos_disabled",tipEntiteta:"PosPodesavanje",entitetId:settings.id,staraVrijednost:{aktivan:before.aktivan},novaVrijednost:{aktivan:false},upisiAktivnost:false});return;
    }
    if(!unit || !device || !operator) throw new PosSetupError("NIJE_SPREMNO");
    let register=input.registerId?await tx.posRegister.findFirst({where:{id:input.registerId,firma_id:firm.id,agencija_id:firm.agencija_id,is_deleted:false}}):null;
    if(input.registerId && !register) throw new PosSetupError("KASA");
    if(register && register.updated_at.toISOString()!==input.registerVersion) throw new PosSetupError("ZASTARJELO");
    if(!register && await tx.posRegister.findFirst({where:{firma_id:firm.id,sifra:"KASA-1"},select:{id:true}})) throw new PosSetupError("KASA");
    const beforeRegister=register;
    const mappingChanged=register && (register.fiscal_business_unit_id!==unit.id || register.fiscal_device_id!==device.id || register.fiscal_operator_id!==operator.id);
    if(register && mappingChanged && (register.cash_deposit_registered_at || await tx.fiskalniIzlazniRacun.findFirst({where:{pos_register_id:register.id},select:{id:true}}) || await tx.posSmjena.findFirst({where:{pos_register_id:register.id},select:{id:true}}))) throw new PosSetupError("KASA_KORISCENA");
    const data={fiscal_business_unit_id:unit.id,fiscal_business_unit_name:unit.name,fiscal_device_id:device.id,fiscal_device_code:device.internalCode,fiscal_operator_id:operator.id,aktivan:true,updated_by:input.actor.id};
    register=register?await tx.posRegister.update({where:{id:register.id},data}):await tx.posRegister.create({data:{...data,firma_id:firm.id,agencija_id:firm.agencija_id,sifra:"KASA-1",naziv:"Kasa 1",created_by:input.actor.id}});
    const settings=await tx.posPodesavanje.upsert({where:{firma_id:firm.id},create:{firma_id:firm.id,agencija_id:firm.agencija_id,aktivan:true,podrazumijevana_kasa_id:register.id,created_by:input.actor.id,updated_by:input.actor.id},update:{aktivan:true,podrazumijevana_kasa_id:register.id,updated_by:input.actor.id}});
    await auditLogInTransaction(tx,{korisnikId:input.actor.id,agencijaId:firm.agencija_id,firmaId:firm.id,modul:"admin.fiskalizacija",akcija:"pos_enabled",tipEntiteta:"PosPodesavanje",entitetId:settings.id,staraVrijednost:{aktivan:before?.aktivan??false,registerId:beforeRegister?.id??null,unitId:beforeRegister?.fiscal_business_unit_id??null,deviceId:beforeRegister?.fiscal_device_id??null,operatorId:beforeRegister?.fiscal_operator_id??null},novaVrijednost:{aktivan:true,registerId:register.id,unitId:unit.id,deviceId:device.id,operatorId:operator.id,environment:remote!.company.environment},upisiAktivnost:false});
  },{isolationLevel:"Serializable",timeout:15000});
}
