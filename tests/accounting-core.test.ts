import test from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { buildPdvReturnRows, calculatePdvPostingAmounts, periodDateRange } from '../src/lib/pdv';
import { buildOpeningBalanceLines, openingBalanceTotals } from '../src/lib/opening-balance';
const d = (value: number | string) => new Prisma.Decimal(value);
const sale = (rate: number, base: number, vat: number, type = 'DOMESTIC') => ({
  total_base: d(base), total_output_vat: d(vat), vat_transaction_type: type,
  tax_lines: [{ tax_base: d(base), output_vat_amount: d(vat), vat_rate_percent: d(rate), vat_rate_code: `R${rate}` }]
});
const purchase = (vat: number, deductible: number, type = 'DOMESTIC', customs = 0) => ({
  total_input_vat: d(vat), deductible_vat: d(deductible), non_deductible_vat: d(type === 'IMPORT' ? 0 : vat-deductible),
  customs_vat_amount: d(customs), vat_transaction_type: type,
  tax_lines: [{ input_vat_amount: d(vat), deductible_vat_amount: d(deductible), vat_rate_percent: d(21), vat_rate_code: 'R21', vat_rate_name: '21%' }]
});
test('PDV: 21/15/7/0, izvoz i oslobođenje ostaju odvojeni od van-PDV prometa', () => {
  const result = buildPdvReturnRows([{ entries: [sale(21,100,21),sale(15,200,30),sale(7,300,21),sale(0,40,0),sale(0,50,0,'EXPORT'),sale(0,60,0,'EXEMPT'),sale(0,900,0,'NON_TAXABLE')] }], []);
  const rows = Object.fromEntries(result.rows.map(r=>[r.sifra,r.value]));
  assert.deepEqual([rows['10'],rows['11'],rows['12'],rows['13'],rows['14']], [121,230,321,40,110]);
  assert.equal(result.totals.totalOutput,72); assert.equal(result.totals.payable,72);
});
test('PDV: samo odbitni domaći PDV i zaseban carinski PDV umanjuju obavezu', () => {
  const kif = [{ entries: [sale(21,1000,210)] }];
  const kuf = [{ entries: [purchase(42,21), purchase(0,0,'IMPORT',63)] }];
  assert.deepEqual(buildPdvReturnRows(kif,kuf).totals, {totalOutput:210,totalInput:105,deductible:84,nonDeductible:21,payable:126,credit:0});
  assert.deepEqual(Object.fromEntries(calculatePdvPostingAmounts(kif,kuf)), {OUTPUT_VAT_R21:210,INPUT_VAT_R21:21,IMPORT_VAT:63});
});
test('PDV: puni i djelimični negativni račun smanjuju osnovicu i izlazni PDV', () => {
  assert.equal(buildPdvReturnRows([{entries:[sale(21,100,21),sale(21,-100,-21)]}],[]).totals.payable,0);
  const result = buildPdvReturnRows([{entries:[sale(21,100,21),sale(21,-40,-8.4)]}],[{entries:[purchase(21,21)]}]);
  assert.equal(Math.round(result.totals.totalOutput*100),1260);
  assert.equal(Math.round(result.totals.credit*100),840); assert.equal(result.totals.payable,0);
});
test('PDV: negativni KUF koriguje ulazni PDV i odbitak, ne pravi drugi prihod', () => {
  const result = buildPdvReturnRows([],[{entries:[purchase(42,21),purchase(-21,-10.5)]}]);
  assert.deepEqual(result.totals,{totalOutput:0,totalInput:21,deductible:10.5,nonDeductible:10.5,payable:0,credit:10.5});
});
test('PDV: prazan period i period sa neto nultim prometom nijesu ista stvar', () => {
  assert.equal(buildPdvReturnRows([],[]).rows.find(r=>r.sifra==='9')!.value,1);
  assert.equal(buildPdvReturnRows([{entries:[sale(21,100,21),sale(21,-100,-21)]}],[]).rows.find(r=>r.sifra==='9')!.value,0);
  assert.equal(periodDateRange(2028,2).dateTo.toISOString().slice(0,10),'2028-02-29');
});
test('Početno stanje: zasebni partneri, djelimična uplata, preplata i zatvoren saldo', () => {
  const line = (id:string,partner:string,debit:string,credit:string) => ({duguje:d(debit),potrazuje:d(credit),komitent_id:partner,komitent:{naziv:partner},firma_konto:{id,sifra:id,naziv:id}});
  const balances=buildOpeningBalanceLines([line('201','A','121','0'),line('201','A','0','40'),line('201','B','50','0'),line('201','B','0','70'),line('201','C','0.30','0'),line('201','C','0','0.30'),line('430','D','0','61')]);
  assert.deepEqual(balances.map(b=>[b.partnerId,b.debitCents,b.creditCents]),[['A',8100,0],['B',0,2000],['D',0,6100]]);
  assert.deepEqual(openingBalanceTotals(balances),{debitCents:8100,creditCents:8100});
});
