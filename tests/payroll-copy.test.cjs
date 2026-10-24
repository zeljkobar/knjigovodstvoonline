/* eslint-disable @typescript-eslint/no-require-imports -- Regression tests load the application code. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const {sourceLoader}=require('./helpers/source-loader.cjs');
const {payrollCopyMonth:month,shiftPayrollCopyDate:shift}=sourceLoader()('src/lib/payroll-copy-period.ts');
const date=s=>new Date(s+'T00:00:00Z'),key=d=>d.toISOString().slice(0,10);
test('payroll copy maps all month ends, partial dates, payment offsets and December/January',()=>{
 const aug=month('2026-08'),sep=month('2026-09');
 assert.equal(key(sep.from),'2026-09-01');assert.equal(key(sep.to),'2026-09-30');
 assert.equal(key(shift(date('2026-08-01'),aug,sep)),'2026-09-01');
 assert.equal(key(shift(date('2026-08-31'),aug,sep)),'2026-09-30');
 assert.equal(key(shift(date('2026-08-15'),aug,sep)),'2026-09-15');
 assert.equal(key(shift(date('2026-09-10'),aug,sep)),'2026-10-10');
 assert.equal(key(shift(date('2026-12-31'),month('2026-12'),month('2027-01'))),'2027-01-31');
 assert.equal(key(shift(date('2026-01-31'),month('2026-01'),month('2028-02'))),'2028-02-29');
 assert.equal(key(shift(date('2026-02-28'),month('2026-02'),month('2026-03'))),'2026-03-31');
 for(const bad of ['2026-00','2026-13','2026-1','x','2026-09-01','9999-09'])assert.equal(month(bad),null);
});
test('copy screen uses explicit months and is independent of the company/year work context',async()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');let preview;
 const load=sourceLoader({'@/lib/auth':{requireAnyRole:async()=>({id:'user',agencija_id:'agency'})},'@/lib/work-context':{readWorkContext:()=>{throw Error('must not read selected company')}},'@/lib/payroll-copy':{payrollCopyPreview:async(...args)=>{preview=args;return[]},PayrollCopyError:class extends Error{}}});
 const page=load('src/app/agencija/plate/kopiranje/page.tsx').default;
 const html=renderToStaticMarkup(await page({searchParams:Promise.resolve({izvor:'2026-08',cilj:'2026-09'})}));
 assert.deepEqual(preview,[{userId:'user',agencyId:'agency'},'2026-08','2026-09']);
 assert.match(html,/Izvorni mjesec/);assert.match(html,/Ciljni mjesec/);assert.match(html,/nezavisno/);assert.ok(React);
});
