/* eslint-disable @typescript-eslint/no-require-imports -- Node CommonJS test runner. */
// Fixed fixture rules, not a certification of current legislation.
const test=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
function fixture({rule=null,rate=.13}={}) {
 const prisma={plateDoprinosStopa:{findMany:async()=>[
  {sifra:'EMPLOYEE_PIO',stopa:.10},{sifra:'EMPLOYEE_UNEMPLOYMENT',stopa:.005},
  {sifra:'EMPLOYER_UNEMPLOYMENT',stopa:.005},{sifra:'LABOR_FUND',stopa:.002},
  {sifra:'UNION',stopa:.002},{sifra:'CHAMBER',stopa:.0027}]},
 platePorezRazred:{findMany:async()=>[{bruto_od:0,bruto_do:70000,stopa:0},{bruto_od:70000,bruto_do:100000,stopa:.09},{bruto_od:100000,bruto_do:null,stopa:.15}]},
 platePrirezStopa:{findMany:async()=>[{opstina:'Bar',stopa:rate}]},
 plateOsnovaObracuna:{findFirst:async()=>rule?{id:'basis'}:null},plateOsnovaPravilo:{findFirst:async()=>rule}};
 return sourceLoader({'@/lib/prisma':{prisma}})('src/lib/payroll.ts');
}
const input=(overrides={})=>({calculationDate:new Date('2026-06-30'),incomeType:{sifra:'001',koristi_porez:true,koristi_zaposleni_pio:true,koristi_zaposleni_nezaposleni:true,koristi_poslodavac_nezaposleni:true,koristi_fond_rada:true,koristi_sindikat:true,koristi_privredna_komora:true},calculationType:{input_type:'GROSS',koristi_koeficijent:false,koristi_minuli_rad:false,seniority_mode:'NONE',algoritam:'GROSS_TO_NET'},grossAmountCents:100000,netAmountCents:0,fixedPartCents:0,complexityCoefficient:0,usesSeniority:false,seniorityCoefficient:0,workingHours:176,workingHoursFund:176,municipality:'Bar',...overrides});
for(const [gross,tax,net] of [[60000,0,53700],[70000,0,62650],[70001,0,62651],[100000,2700,86449],[100001,2700,86450],[120000,5700,100959]]) {
 test(`gross ${gross}: independent expected tax and net`,async()=>{const r=await fixture().calculatePayrollLine(input({grossAmountCents:gross}));assert.equal(r.personalIncomeTaxCents,tax);assert.equal(r.netAmountCents,net);assert.equal(r.grossAmountCents,r.netAmountCents+r.personalIncomeTaxCents+r.surtaxCents+r.totalEmployeeContributionsCents);assert.equal(r.totalCostCents,r.grossAmountCents+r.totalEmployerContributionsCents);});
}
test('net to gross preserves target within one cent across bracket boundaries',async()=>{const p=fixture();for(const net of [1,10000,60000,62650,62651,86449,86450,120000,500000]){const r=await p.calculatePayrollLine(input({netAmountCents:net,calculationType:{input_type:'NET',algoritam:'NET_TO_GROSS',koristi_minuli_rad:false}}));assert.ok(Math.abs(r.netAmountCents-net)<=1,`${net}: ${r.netAmountCents}`);}});
for(const [hours,gross] of [[176,80000],[132,60000],[88,40000],[44,20000],[22,10000]])test(`schedule ${hours}/176`,async()=>assert.equal((await fixture().calculatePayrollLine(input({grossAmountCents:80000,workingHours:hours}))).grossAmountCents,gross));
test('seniority brackets and anniversary',()=>{const p=fixture();for(const [y,k]of [[0,0],[10,.05],[11,.0575],[20,.125],[21,.135]])assert.ok(Math.abs(p.calculateSeniorityCoefficient(y)-k)<1e-9);assert.equal(p.calculateCompletedYears('2016-07-17','2026-07-16'),9);assert.equal(p.calculateCompletedYears('2016-07-17','2026-07-17'),10);});
test('coefficient and seniority apply once',async()=>{const r=await fixture().calculatePayrollLine(input({fixedPartCents:50000,complexityCoefficient:2,usesSeniority:true,seniorityYears:10,calculationType:{input_type:'GROSS',koristi_koeficijent:true,koristi_minuli_rad:true,seniority_mode:'ADD_TO_GROSS'}}));assert.equal(r.grossAmountCents,105000);assert.equal(r.seniorityAmountCents,5000);});
const linearRule={id:'r',osnova_id:'basis',osnovica_porez_tip:'PROCENAT_BRUTO',osnovica_porez_proc:70,osnovica_pio_tip:null,osnovica_pio_proc:0,osnovica_rfzo_tip:null,osnovica_rfzo_proc:0,osnovica_zzz_tip:null,osnovica_zzz_proc:0,stope:[{tip:'POREZ',teret:'ZAPOSLENI',stopa:.15,osnovica_tip:'OSNOVICA_POREZ'}]};
for(const code of ['047','065'])test(`linear basis ${code}: 70% base and 15% fixture tax`,async()=>{const r=await fixture({rule:linearRule}).calculatePayrollLine(input({incomeType:{sifra:code}}));assert.equal(r.taxableGrossCents,70000);assert.equal(r.personalIncomeTaxCents,10500);assert.equal(r.surtaxCents,1365);assert.equal(r.netAmountCents,88135);});
test('unknown nonzero basis is rejected instead of silent zero',async()=>await assert.rejects(()=>fixture({rule:{...linearRule,osnovica_porez_tip:'UNSUPPORTED'}}).calculatePayrollLine(input({incomeType:{sifra:'047'}})),/PAYROLL_UNSUPPORTED_BASIS/));
test('zero taxable basis stays zero',async()=>{const r=await fixture({rule:{...linearRule,osnovica_porez_proc:0}}).calculatePayrollLine(input({incomeType:{sifra:'047'}}));assert.equal(r.taxableGrossCents,0);assert.equal(r.personalIncomeTaxCents,0);});
async function monthly(inputs, previous={baseCents:0,taxCents:0,surtaxCents:0}, calculator=fixture()) {
 const history={...previous},results=[];
 const {appendPayrollTax}=sourceLoader({'@/lib/prisma':{prisma:{}}})('src/lib/payroll-monthly-tax.ts');
 for(const entry of inputs){const result=await calculator.calculatePayrollLine({...entry,monthlyTaxHistory:history});appendPayrollTax(history,result);results.push(result);}
 return {results,history};
}
test('regular pay plus holiday and night pay share progressive brackets',async()=>{
 const {results,history}=await monthly([60000,30000,30000].map(grossAmountCents=>input({grossAmountCents})));
 assert.deepEqual(results.map(r=>r.personalIncomeTaxCents),[0,1800,3900]);
 assert.equal(history.taxCents,5700);assert.equal(history.surtaxCents,741);
 assert.equal(results.reduce((s,r)=>s+r.netAmountCents+r.personalIncomeTaxCents+r.surtaxCents+r.totalEmployeeContributionsCents,0),120000);
});
test('supplementary net pay uses earlier monthly gross and taxes',async()=>{
 const first=await monthly([input({grossAmountCents:100000})]);
 const next=await monthly([input({netAmountCents:20000,calculationType:{input_type:'NET',algoritam:'NET_TO_GROSS'}})],first.history);
 const r=next.results[0];assert.ok(Math.abs(r.netAmountCents-20000)<=1);
 assert.ok(r.personalIncomeTaxCents>0);
 const whole=await fixture().calculatePayrollLine(input({grossAmountCents:next.history.baseCents}));
 assert.equal(next.history.taxCents,whole.personalIncomeTaxCents);assert.equal(next.history.surtaxCents,whole.surtaxCents);
});
test('mixed net and gross lines preserve net targets and total monthly tax',async()=>{
 const {results,history}=await monthly([input({netAmountCents:60000,calculationType:{input_type:'NET',algoritam:'NET_TO_GROSS'}}),input({grossAmountCents:30000}),input({netAmountCents:25000,calculationType:{input_type:'NET',algoritam:'NET_TO_GROSS'}})]);
 assert.ok(Math.abs(results[0].netAmountCents-60000)<=1);assert.ok(Math.abs(results[2].netAmountCents-25000)<=1);
 const whole=await fixture().calculatePayrollLine(input({grossAmountCents:history.baseCents}));assert.equal(history.taxCents,whole.personalIncomeTaxCents);assert.equal(history.surtaxCents,whole.surtaxCents);
});
test('linear and exempt income do not consume salary brackets',async()=>{
 const previous={baseCents:100000,taxCents:2700,surtaxCents:351};
 const linear=await monthly([input({incomeType:{sifra:'047'}})],previous,fixture({rule:linearRule}));assert.deepEqual(linear.history,previous);assert.equal(linear.results[0].personalIncomeTaxCents,10500);
 const exempt=await monthly([input({incomeType:{sifra:'001',koristi_porez:false}})],previous);assert.deepEqual(exempt.history,previous);assert.equal(exempt.results[0].personalIncomeTaxCents,0);
});
test('cent rounding over many small supplements matches total tax and surtax',async()=>{
 const {history}=await monthly(Array.from({length:17},()=>input({grossAmountCents:7})),{baseCents:100000,taxCents:2700,surtaxCents:351});
 const whole=await fixture().calculatePayrollLine(input({grossAmountCents:100119}));assert.equal(history.taxCents,whole.personalIncomeTaxCents);assert.equal(history.surtaxCents,whole.surtaxCents);
});
test('IOPPD retains an explicitly zero taxable base',()=>{
 const i=sourceLoader({'@/lib/prisma':{prisma:{}}})('src/lib/payroll-ioppd.ts');
 const row={radnik_id:'w',sifra_primanja:'047',naziv_primanja:'Fixture',datum_od:new Date('2026-06-01'),datum_do:new Date('2026-06-30'),bruto_cent:100000,oporezivi_bruto_cent:0,osnovica_cent:100000,porez_cent:0,zaposleni_pio_cent:0,zaposleni_zdravstvo_cent:0,zaposleni_nezaposleni_cent:0,poslodavac_pio_cent:0,poslodavac_zdravstvo_cent:0,poslodavac_nezaposleni_cent:0,fond_rada_cent:0};
 const report=i.buildIoppdMonthData(2026,6,[{radnici:[{radnik_id:'w',snapshot:{ime:'A',prezime:'B',jmbg:'0000000000000'}}],stavke:[row]}]);
 assert.equal(report.lines[0].osnovicaCent,0);assert.equal(report.totals.osnovicaCent,0);
});
test('separate surtax fixture rates affect net, not income tax',async()=>{
 const a=await fixture({rate:.13}).calculatePayrollLine(input()),b=await fixture({rate:.15}).calculatePayrollLine(input());
 assert.equal(a.personalIncomeTaxCents,b.personalIncomeTaxCents);assert.equal(b.surtaxCents,405);assert.equal(a.netAmountCents-b.netAmountCents,54);
});
test('linear net to gross and explicit tax base override',async()=>{
 const p=fixture({rule:linearRule});const r=await p.calculatePayrollLine(input({netAmountCents:88135,incomeType:{sifra:'047'},calculationType:{input_type:'NET',algoritam:'NET_TO_GROSS'}}));assert.equal(r.grossAmountCents,100000);
 const override=await p.calculatePayrollLine(input({incomeType:{sifra:'047',osnovica_porez_proc_override:50}}));assert.equal(override.personalIncomeTaxCents,7500);assert.equal(override.taxableGrossCents,50000);
});
test('aggregate and detail payroll posting cannot both be active',()=>{
 const p=sourceLoader({'@/lib/prisma':{prisma:{}}})('src/lib/payroll-posting.ts');
 const codes=new Set(['BRUTO_ZARADA','NETO_ZA_ISPLATU']);
 assert.equal(p.hasPayrollPostingAggregateConflict(codes,new Map([['BRUTO_ZARADA',100000],['NETO_ZA_ISPLATU',86449]])),true);
 assert.equal(p.hasPayrollPostingAggregateConflict(new Set(['NETO_ZA_ISPLATU','POREZ']),new Map([['NETO_ZA_ISPLATU',86449],['POREZ',2700]])),false);
});

test('holiday and night subcodes retain salary tax even with an inherited basis rule',async()=>{
 const entries=[input({grossAmountCents:60000}),input({grossAmountCents:10000,incomeType:{...input().incomeType,sifra:'001.04',obracunski_koeficijent:.4,koeficijent_tip:'IZNOS'}}),input({grossAmountCents:20000,incomeType:{...input().incomeType,sifra:'001.05',obracunski_koeficijent:1.5,koeficijent_tip:'IZNOS'}})];
 const {history,results}=await monthly(entries,undefined,fixture({rule:linearRule}));assert.equal(history.baseCents,94000);assert.equal(history.taxCents,2160);assert.equal(results[2].details.monthlyProgressiveTax,true);
});

test('monthly history separates workers and linear income',()=>{
 const m=sourceLoader({})('src/lib/payroll-monthly-tax.ts');
 const row={id:'a',radnik_id:'one',bruto_cent:100000,oporezivi_bruto_cent:100000,porez_cent:2700,prirez_cent:351,detalji:{monthlyProgressiveTax:true}};
 const rows=[row,{...row,id:'b',radnik_id:'two'},{...row,id:'c',detalji:{monthlyProgressiveTax:false,basisRule:{}}}];
 assert.deepEqual(m.payrollTaxHistory(rows,'one'),{baseCents:100000,taxCents:2700,surtaxCents:351});
 assert.deepEqual(m.payrollTaxHistory(rows,'missing'),{baseCents:0,taxCents:0,surtaxCents:0});
 assert.equal(m.payrollHistoryKey(rows,'one'),m.payrollHistoryKey(rows.slice().reverse(),'one'));
});
