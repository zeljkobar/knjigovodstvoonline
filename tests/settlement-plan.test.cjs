/* eslint-disable @typescript-eslint/no-require-imports -- Pure matching policy. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const {exactSettlementPlan,oldestSettlementPlan}=sourceLoader()('src/lib/settlement-plan.ts');
const item=(id,cents,accountId='2020',partnerId='p',date='2026-01-01')=>({id,accountId,partnerId,date,document:id,signedCents:cents,remainingCents:cents});
test('exact matching requires a mutual unique pair within partner and account',()=>{
 assert.deepEqual(exactSettlementPlan([item('a',100),item('b',-100)]),[{debitId:'a',creditId:'b',cents:100}]);
 for(const ambiguous of [[item('a',100),item('b',100),item('c',-100)],[item('a',100),item('b',-100),item('c',-100)]])assert.deepEqual(exactSettlementPlan(ambiguous),[]);
 assert.deepEqual(exactSettlementPlan([item('a',100),item('b',-100,'4330'),item('c',-100,'2020','other')]),[]);
});
test('oldest proposal splits payment and leaves the remainder on the next invoice',()=>{
 const items=[item('b',200,'2020','p','2026-02-01'),item('p',-250),item('a',100)];
 assert.deepEqual(oldestSettlementPlan(items),[{debitId:'a',creditId:'p',cents:100},{debitId:'b',creditId:'p',cents:150}]);
 assert.equal(items[0].remainingCents,200);
});
