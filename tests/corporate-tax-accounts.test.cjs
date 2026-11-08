/* eslint-disable @typescript-eslint/no-require-imports -- Pure account-mapping regression. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const t=sourceLoader()('src/lib/corporate-tax-accounts.ts');
const rules=(fields)=>t.defaultTaxAccountRules().map(r=>({...r,...fields[r.key]}));
test('representation and memberships include only the excess above class 6 net revenue thresholds',()=>{
 const r=rules({x19:{accounts:'551'},x20:{accounts:'554'},x13:{accounts:'5599'}});
 const v=t.calculateTaxAccountInputs(r,[{code:'6000',debit:100000,credit:10000000},{code:'6700',debit:0,credit:100000},
  {code:'5510',debit:150000,credit:10000},{code:'5540',debit:20000,credit:0},{code:'5599',debit:12345,credit:0}]);
 assert.equal(v.revenueCents,10000000);assert.equal(v.inputs.x19,40000);assert.equal(v.inputs.x20,10000);assert.equal(v.inputs.x13,12345);
 const below=t.calculateTaxAccountInputs(r,[{code:'6000',debit:0,credit:10000000},{code:'5510',debit:100000,credit:0}]);
 assert.equal(below.inputs.x19,0);assert.equal(below.inputs.x20,0);
});
test('prefixes match once, exclusions and signs work, unconfigured positions stay manual',()=>{
 const v=t.calculateTaxAccountInputs(rules({x03:{accounts:'67, 675',exclude:'6759'},x07:{accounts:'559'},x19:{accounts:'551'}}),[
  {code:'6750',debit:100,credit:1000},{code:'6759',debit:0,credit:5000},{code:'5590',debit:0,credit:200},{code:'5510',debit:1234,credit:0}]);
 assert.equal(v.inputs.x03,900);assert.equal(v.inputs.x07,0);assert.equal(v.inputs.x19,1175);assert(!Object.hasOwn(v.inputs,'x08'));
});
test('integer-cent limits round half up; refunds and nonpositive revenue never create negative limits',()=>{
 const r=rules({x19:{accounts:'551'},x20:{accounts:'554'}});
 const v=t.calculateTaxAccountInputs(r,[{code:'6000',debit:0,credit:1050},{code:'5510',debit:100,credit:0}]);
 assert.equal(v.details.find(d=>d.key==='x19').limit,11);assert.equal(v.inputs.x19,89);
 const z=t.calculateTaxAccountInputs(r,[{code:'6000',debit:100,credit:0},{code:'5510',debit:100,credit:0}]);assert.equal(z.revenueCents,0);assert.equal(z.inputs.x19,100);
});
test('settings reject computed positions, duplicates, malformed prefixes, side and excessive values',()=>{
 assert.throws(()=>t.parseTaxAccountRules([]));
 assert.throws(()=>t.parseTaxAccountRules(rules({x03:{key:'x59'}})));
 assert.throws(()=>t.parseTaxAccountRules(rules({x03:{key:'x04'}})));
 assert.throws(()=>t.parseTaxAccountRules(rules({x03:{accounts:'60 + 61'}})));
 assert.throws(()=>t.parseTaxAccountRules(rules({x03:{side:'SQL'}})));
 assert.throws(()=>t.calculateTaxAccountInputs(rules({}),[{code:'6000',debit:0,credit:Number.MAX_SAFE_INTEGER}]));
 assert.equal(t.parseTaxAccountRules(rules({x03:{accounts:'60; 61 60'}}))[0].accounts,'60, 61');
});
