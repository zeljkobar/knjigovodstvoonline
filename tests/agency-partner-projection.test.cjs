/* eslint-disable @typescript-eslint/no-require-imports -- Source-loader regression. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const {agencyPartnerSelection,projectAgencyPartners,agencyPartnerWhere}=sourceLoader()('src/lib/agency-partner-projection.ts');

test('partner projection preserves canonical identity and financial snapshots',()=>{
 const args={select:{id:true,partner:{select:{id:true,naziv:true,pib:true,scope:true}},metadata:true}};
 const selection=agencyPartnerSelection('BankStatementLine',args,'agency-a');
 assert.equal(selection.select.partner.select.agencijske_izmjene.where.agencija_id,'agency-a');
 assert.equal(args.select.partner.select.agencijske_izmjene,undefined);
 const result=projectAgencyPartners('BankStatementLine',{id:'line',metadata:{naziv:'immutable snapshot'},partner:{id:'global',naziv:'Original',pib:'123',scope:'GLOBAL',agencijske_izmjene:[{naziv:'Agency A',pib:'456',verzija:1}]}},args);
 assert.equal(result.partner.id,'global');assert.equal(result.partner.naziv,'Agency A');assert.equal(result.partner.scope,'GLOBAL');
 assert.deepEqual(result.metadata,{naziv:'immutable snapshot'});assert.equal(result.partner.agencijske_izmjene,undefined);
});

test('effective search combines override match with unmodified fallback scoped to one agency',()=>{
 const result=agencyPartnerWhere('Komitent',{aktivan:true,OR:[{naziv:{contains:'Edited',mode:'insensitive'}},{pib:'123'}]},'agency-a');
 assert.equal(result.aktivan,true);
 for(const branch of result.OR){
  const alternatives=branch.AND[0].OR;
  assert.equal(alternatives[0].agencijske_izmjene.some.agencija_id,'agency-a');
  assert.equal(alternatives[1].AND[0].agencijske_izmjene.none.agencija_id,'agency-a');
 }
});

test('parallel background jobs cannot share partner agency context',async()=>{
 const {withPartnerAgency,partnerAgencyContext}=sourceLoader()('src/lib/agency-partner-context.ts');
 assert.equal(partnerAgencyContext(),null);
 await Promise.all(['agency-a','agency-b'].map(id=>withPartnerAgency(id,async()=>{
  await new Promise(resolve=>setImmediate(resolve));assert.equal(partnerAgencyContext(),id);
  await withPartnerAgency('inner',async()=>{assert.equal(partnerAgencyContext(),'inner');});
  assert.equal(partnerAgencyContext(),id);
 })));
 assert.equal(partnerAgencyContext(),null);
});
