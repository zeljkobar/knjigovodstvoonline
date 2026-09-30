import test from "node:test";
import assert from "node:assert/strict";
import { calculateTax, parseTaxInput, poolGroups, type TaxInput, type TaxAsset } from "../src/lib/fixed-assets-tax";
const input = ():TaxInput => ({schema:1,openingSource:"OA 2025",pools:poolGroups.map(group=>({group,opening:0,soldAll:false})),assets:[],events:[]});
const calc=(i:TaxInput,a:TaxAsset[]=[])=>calculateTax(i,a,"2026-01-01","2026-12-31");
const asset:TaxAsset={id:"a",name:"Zgrada",type:"MATERIAL",classification:"I",available:"2020-01-01",disposed:null};
test("poreska I grupa ne oduzima raniji otpis dvaput i ne amortizuje neto osnovicu",()=>{
 const i=input();i.assets=[{id:"a",classification:"I",basis:10000000,previous:2000000,accounting:0,source:"OA"}];
 const r=calc(i,[asset]);assert.deepEqual(r.errors,[]);assert.equal(r.rows[0].current,250000);assert.equal(r.rows[0].closing,7750000);
 i.assets[0].previous=9900000;assert.equal(calc(i,[asset]).rows[0].current,100000);
});
test("poreske grupe koriste poreski saldo, nabavke, prodaje i propisane stope",()=>{
 const i=input();i.pools[0].opening=1000000;i.events=[{id:"1",group:"II",assetId:"",kind:"PURCHASE",date:"2026-12-31",amount:400000,source:"KUF 1"},{id:"2",group:"II",assetId:"",kind:"SALE",date:"2026-02-01",amount:200000,source:"KIF 1"}];
 const r=calc(i).rows[0];assert.equal(r.basis,1200000);assert.equal(r.current,120000);assert.equal(r.closing,1080000);
});
test("poreski prag ispod 1000 EUR primjenjuje se poslije amortizacije; jednakost se ne otpisuje",()=>{
 const i=input();i.pools[2].opening=125000;let r=calc(i).rows[2];assert.equal(r.closing,100000);assert.equal(r.extraWriteOff,0);
 i.pools[2].opening=124999;r=calc(i).rows[2];assert.equal(r.closing,0);assert.equal(r.extraWriteOff,99999);
});
test("poreska prodaja svih sredstava otpisuje saldo, a višak prodaje je prihod",()=>{
 const i=input();i.pools[0]={group:"II",opening:500000,soldAll:true};i.events=[{id:"1",group:"II",assetId:"",kind:"SALE",date:"2026-01-01",amount:200000,source:"KIF"}];
 let r=calc(i).rows[0];assert.equal(r.extraWriteOff,300000);assert.equal(r.current,0);assert.equal(r.closing,0);
 i.events[0].amount=600000;r=calc(i).rows[0];assert.equal(r.taxableIncome,100000);assert.equal(r.extraWriteOff,0);
});
test("poreski posebni tretman ima osnovicu, raniji otpis i dokumentovan tekući iznos",()=>{
 const i=input();i.assets=[{id:"a",classification:"ACCOUNTING_AMOUNT",basis:100000,previous:20000,accounting:15000,source:"Knjiženi godišnji obračun"}];
 const r=calc(i,[{...asset,type:"INTANGIBLE",classification:"ACCOUNTING_AMOUNT"}]);assert.deepEqual(r.errors,[]);assert.equal(r.rows[0].closing,65000);assert.equal(r.specialTotal,15000);
});
test("poreski nepotpuni slučajevi ne mogu tiho dati konačan obračun",()=>{
 const i=input();assert.match(calc(i,[asset]).errors.join(),/klasifikaciju/);
 i.assets=[{id:"a",classification:"I",basis:100000,previous:0,accounting:0,source:"OA"}];assert.match(calc(i,[{...asset,available:"2026-02-01"}]).errors.join(),/nultu/);
 i.events=[{id:"1",group:"II",assetId:"",kind:"REPAIR",date:"2026-02-01",amount:20000,source:"KUF"}];assert.equal(calc(i,[asset]).rows.find(r=>r.group==="II")!.purchases,20000);
});
test("poreski parser traži eksplicitna početna stanja i odbija duple grupe i loše iznose",()=>{
 const raw={...input(),pools:poolGroups.map(group=>({group,opening:"0",soldAll:false}))};assert.equal(parseTaxInput(JSON.stringify(raw)).pools.length,4);
 raw.pools[0].opening="";assert.throws(()=>parseTaxInput(JSON.stringify(raw)));
 raw.pools[0].opening="0";raw.pools[0].group="III";assert.throws(()=>parseTaxInput(JSON.stringify(raw)));
});

test("poreske popravke: tačno 5% početnog salda je rashod, iznad praga kapitalizuje se cijeli iznos",()=>{
 const i=input();i.pools[0].opening=1000000;i.events=[{id:"1",group:"II",assetId:"",kind:"REPAIR",date:"2026-06-01",amount:50000,source:"KUF"}];
 assert.equal(calc(i).rows[0].purchases,0);i.events[0].amount=50001;assert.equal(calc(i).rows[0].purchases,50001);assert.equal(calc(i).rows[0].current,105000);
});
test("poreska I grupa dnevno raspoređuje nabavku i uklanja neto vrijednost kod prodaje",()=>{
 const i=input();i.assets=[{id:"a",classification:"I",basis:0,previous:0,accounting:0,source:"Nabavka"}];i.events=[{id:"1",group:"I",assetId:"a",kind:"PURCHASE",date:"2026-07-01",amount:3650000,source:"Kupovina"}];
 let r=calc(i,[{...asset,available:"2026-07-01"}]);assert.deepEqual(r.errors,[]);assert.equal(r.rows[0].current,46000);
 i.assets[0].basis=3650000;i.assets[0].previous=100000;i.events=[{id:"2",group:"I",assetId:"a",kind:"SALE",date:"2026-07-01",amount:5000000,source:"Prodaja"}];
 r=calc(i,[{...asset,disposed:"2026-07-01"}]);assert.deepEqual(r.errors,[]);assert.equal(r.rows[0].current,45250);assert.equal(r.rows[0].closing,0);assert.equal(r.rows[0].basis-r.rows[0].total,0);
});
