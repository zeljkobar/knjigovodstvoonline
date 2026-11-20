/* eslint-disable @typescript-eslint/no-require-imports -- Fiscal access regression infrastructure. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const actor={id:'admin',rola:'admin'},version='2026-11-20T00:00:00.000Z';
function fixture({direct=false,missingFirm=false,missingUser=false,other=false,old=null,auditFails=false}={}) {
 const writes=[],audits=[],invitations=[];let lookups=0,locks=0;
 const tx={
 $executeRaw:async()=>{locks++;},
 firma:{findFirst:async()=>{lookups++;return missingFirm?null:{id:'firm',agencija_id:'agency',naziv:'Firm',agencija:{is_fiscal_direct_container:direct}};}},
 korisnik:{findFirst:async q=>{lookups++;assert.equal(q.where.agencija_id,'agency');assert.equal(q.where.is_deleted,false);return missingUser?null:{id:'user',email:'existing@example.test',korisnicko_ime:'existing'};},create:async q=>{writes.push(['user',q.data]);return{id:'new-user',...q.data};}},
 korisnikFirma:{findFirst:async()=>other?{id:'other'}:null,findUnique:async()=>old,upsert:async q=>{writes.push(['assignment',q]);return{id:'assignment',...q.create};}},
 pozivnica:{create:async q=>invitations.push(q)}
 };
 const service=sourceLoader({'./prisma':{prisma:{$transaction:async fn=>fn(tx)}},'./audit':{auditLogInTransaction:async(_tx,q)=>{assert.equal(_tx,tx);if(auditFails)throw Error('AUDIT_FAILED');audits.push(q);}}})('src/lib/platform-fiscal-access.ts');
 return{service,writes,audits,invitations,counts:()=>({lookups,locks})};
}
const input={actor,firmaId:'firm',operation:'grant',userId:'user',version:'new',groups:['fakture','slanje','izvjestaji','izvoz']};
test('only platform admin can grant fiscal access, before any database read',async()=>{
 const f=fixture();await assert.rejects(f.service.savePlatformFiscalAccess({...input,actor:{id:'agency-admin',rola:'admin_agencije'}}),/SAMO_PLATFORM_ADMIN/);assert.equal(f.counts().lookups,0);
});
test('existing agency client keeps identity/password/accounting rights; grant is independent',async()=>{
 const f=fixture({old:{id:'assignment',updated_at:new Date(version),fiscal_portal_enabled:false,fiscal_portal_permissions:[]}});
 await f.service.savePlatformFiscalAccess({...input,version});
 assert.equal(f.writes.length,1);const data=f.writes[0][1].update;
 assert.equal(data.fiscal_portal_enabled,true);assert.ok(data.fiscal_portal_permissions.includes('robno:create'));assert.ok(data.fiscal_portal_permissions.includes('fiskalizacija:post'));
 assert.equal(data.lozinka_hash,undefined);assert.equal(data.access_type,undefined);assert.equal(f.invitations.length,0);assert.equal(f.audits.length,1);
});
test('new agency client belongs to the same agency and company and gets invitation atomically',async()=>{
 for(const direct of [false,true]){const f=fixture({direct});await f.service.savePlatformFiscalAccess({...input,operation:'create',username:'client',email:'client@example.test',passwordHash:'hash',invitation:{tokenHash:'secret-hash'}});
 const user=f.writes[0][1],assignment=f.writes[1][1].create;
 assert.equal(user.rola,direct?'korisnik_agencije':'klijent');assert.equal(user.agencija_id,'agency');assert.equal(assignment.firma_id,'firm');assert.equal(assignment.access_type,direct?'FISCAL_CLIENT':'client');assert.equal(f.invitations.length,1);assert.equal(JSON.stringify(f.audits).includes('secret-hash'),false);}
});
test('scope, inactive/wrong role candidate, another company and stale preview reject grants',async()=>{
 for(const [options,message] of [[{missingFirm:true},'FIRMA_NIJE_FISKALNA'],[{missingUser:true},'KORISNIK_NIJE_KLIJENT_FIRME'],[{other:true},'KORISNIK_DRUGA_FIRMA'],[{old:{updated_at:new Date(version)}},'ZASTARIO_PREGLED']]){
 const f=fixture(options);await assert.rejects(f.service.savePlatformFiscalAccess(input),new RegExp(message));assert.equal(f.writes.length,0);}
});
test('revoke also repairs multiple-company legacy grant without deleting accounting assignment',async()=>{
 const f=fixture({other:true,old:{updated_at:new Date(version),fiscal_portal_enabled:true,fiscal_portal_permissions:['fiskalizacija:view']}});
 await f.service.savePlatformFiscalAccess({...input,operation:'revoke',version});const update=f.writes[0][1].update;
 assert.equal(update.fiscal_portal_enabled,false);assert.deepEqual(update.fiscal_portal_permissions,[]);assert.equal(update.is_deleted,undefined);assert.equal(f.audits[0].akcija,'fiscal_access_revoked');
});
test('agency identity mutations share platform lock and block unlink/deactivation or another firm',async()=>{
 const f=fixture({other:true});let writes=0;
 assert.equal(await f.service.withAgencyFiscalIdentity('user','agency',null,async()=>++writes),null);
 assert.equal(await f.service.withAgencyFiscalIdentity('user','agency','other',async()=>++writes),null);assert.equal(writes,0);assert.equal(f.counts().locks,2);
 const allowed=fixture();assert.equal(await allowed.service.withAgencyFiscalIdentity('user','agency','firm',async()=>++writes),1);
});
test('unrecognized permission names cannot grant arbitrary authority',()=>{
 const policy=sourceLoader()('src/lib/platform-fiscal-access-policy.ts');const keys=policy.platformFiscalPermissions(['admin','pos:manage']);assert.deepEqual(keys,['fiskalizacija:view','pos:view','robno:view']);
});
test('portal uses platform assignment permissions and never agency bookkeeping permissions',async()=>{
 let query;const user={id:'user',rola:'klijent',agencija_id:'agency'};
 const assignment={access_type:'client',fiscal_portal_permissions:['fiskalizacija:view','robno:create'],firma:{id:'firm',naziv:'Firm',poslovne_godine:[{id:'year',godina:2026,datum_od:new Date('2026-01-01'),datum_do:new Date('2026-12-31'),zakljucena:false}],fiscalCompanyLink:{onboarding_status:'PRODUCTION_ACTIVE',fiscal_environment:'Production',is_suspended:false}}};
 const service=sourceLoader({'./auth':{getCurrentUser:async()=>user,isFiscalPortalUser:()=>true},'./prisma':{prisma:{korisnikFirma:{findMany:async q=>{query=q;return[assignment];}},korisnikPravo:{findMany:async()=>{throw Error('BOOKKEEPING_RIGHTS_MUST_NOT_AUTHORIZE_PORTAL');}}}},'./work-context':{readWorkContext:async()=>({firmaId:'firm',poslovnaGodinaId:'year'})},'next/navigation':{redirect:()=>{throw Error('REDIRECT');}}})('src/lib/direct-portal.ts');
 const context=await service.getDirectPortalContext();assert.equal(context.state,'READY');assert.equal(query.where.fiscal_portal_enabled,true);assert.equal(query.where.firma.agencija_id,'agency');assert.ok(context.permissionKeys.has('robno:create'));assert.equal(context.permissionKeys.has('pos:create'),false);
 assignment.fiscal_portal_permissions=[];assert.equal((await service.getDirectPortalContext()).state,'NO_VIEW_PERMISSION');
});

test('admin actions authenticate first; existing grants do not send mail or replace credentials',async()=>{
 let saves=0,mails=0,allowed=false;const firmaId='11111111-1111-4111-8111-111111111111';
 const module=sourceLoader({'@/lib/auth':{requireRole:async role=>{assert.equal(role,'admin');if(!allowed)throw Error('DENIED');return actor;}},'@/lib/platform-fiscal-access':{FiscalAccessError:class extends Error{},savePlatformFiscalAccess:async input=>{saves++;assert.equal(input.passwordHash,undefined);assert.equal(input.invitation,undefined);return{user:{email:'client@example.test',korisnicko_ime:'client'}};}},'@/lib/email':{sendInvitationEmail:async()=>mails++},'@/lib/invitations':{},'next/cache':{revalidatePath:()=>{}},'next/navigation':{redirect:url=>{throw Error('REDIRECT:'+url);}}})('src/app/admin/fiskalizacija/[firmaId]/pristup/actions.ts');
 const form=new FormData();form.set('firma_id',firmaId);form.set('operation','grant');
 await assert.rejects(module.saveFiscalAccess(form),/DENIED/);assert.equal(saves,0);
 allowed=true;await assert.rejects(module.saveFiscalAccess(form),/PRISTUP_SACUVAN/);assert.equal(saves,1);assert.equal(mails,0);
});
test('access page scopes candidates to company agency and exposes both account paths with labels',async()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');let candidatesQuery;
 const module=sourceLoader({'@/lib/auth':{requireRole:async role=>assert.equal(role,'admin')},'@/lib/prisma':{prisma:{firma:{findFirst:async()=>({id:'firm',naziv:'Opticonnect',pib:'03411036',agencija_id:'agency',agencija:{naziv:'Summa',is_fiscal_direct_container:false},fiscalCompanyLink:{}})},korisnikFirma:{findMany:async()=>[]},korisnik:{findMany:async q=>{candidatesQuery=q;return[];}}}},'./actions':{saveFiscalAccess:async()=>{},resendFiscalAccessInvitation:async()=>{}},'next/navigation':{notFound:()=>{throw Error('NOT_FOUND');}},'next/link':{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)}})('src/app/admin/fiskalizacija/[firmaId]/pristup/page.tsx');
 const html=renderToStaticMarkup(await module.default({params:Promise.resolve({firmaId:'firm'}),searchParams:Promise.resolve({})}));
 assert.equal(candidatesQuery.where.agencija_id,'agency');assert.equal(candidatesQuery.where.rola,'klijent');assert.equal(candidatesQuery.take,20);
 assert.match(html,/Dodijeli pristup postojećem klijentu/);assert.match(html,/Kreiraj novi nalog/);assert.match(html,/Korisničko ime/);assert.match(html,/Fiskalizacija faktura/);assert.match(html,/Knjigovodstvena|knjigovodstvene/);
});
