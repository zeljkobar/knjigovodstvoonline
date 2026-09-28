import assert from "node:assert/strict";
import test from "node:test";
import { calculateAssetPeriods } from "../src/lib/fixed-assets-calculation";

function calculate(overrides: Partial<Parameters<typeof calculateAssetPeriods>[0]> = {}) {
  return calculateAssetPeriods({
    assetId: "asset-1",
    grossCents: 120_000,
    accumulatedCents: 0,
    availableDate: "2025-01-01",
    periodFrom: "2025-01-01",
    periodTo: "2025-12-31",
    parameters: [{
      id: "parameter-1",
      effectiveFrom: "2025-01-01",
      method: "LINEAR",
      usefulLifeMonths: 12,
      residualCents: 0
    }],
    ...overrides
  });
}

test("dnevni linearni obračun raspoređuje cijelu osnovicu kroz godinu", () => {
  const result = calculate();

  assert.deepEqual(result.errors, []);
  assert.equal(result.lines[0]?.amountCents, 10_192);
  assert.equal(result.lines[1]?.amountCents, 9_205);
  assert.equal(result.totalCents, 120_000);
  assert.equal(result.lines.at(-1)?.netAfterCents, 0);
});

test("ostatak vrijednosti se ne amortizuje", () => {
  const result = calculate({ grossCents: 150_000, parameters: [{
    id: "parameter-1",
    effectiveFrom: "2025-01-01",
    method: "LINEAR",
    usefulLifeMonths: 12,
    residualCents: 30_000
  }] });

  assert.equal(result.totalCents, 120_000);
  assert.equal(result.lines.at(-1)?.netAfterCents, 30_000);
});

test("preuzeto stanje raspoređuje samo preostalu neto vrijednost", () => {
  const result = calculate({
    grossCents: 1_200_000,
    accumulatedCents: 480_000,
    parameters: [{
      id: "parameter-1",
      effectiveFrom: "2025-01-01",
      method: "LINEAR",
      usefulLifeMonths: 12,
      residualCents: 0
    }]
  });

  assert.equal(result.totalCents, 720_000);
  assert.equal(result.lines.at(-1)?.netAfterCents, 0);
});

test("obračun dijeli mjesec kada novi parametar počne usred mjeseca", () => {
  const result = calculate({
    periodFrom: "2025-01-01",
    periodTo: "2025-01-31",
    parameters: [
      {
        id: "parameter-1",
        effectiveFrom: "2025-01-01",
        method: "LINEAR",
        usefulLifeMonths: 12,
        residualCents: 0
      },
      {
        id: "parameter-2",
        effectiveFrom: "2025-01-16",
        method: "LINEAR",
        usefulLifeMonths: 12,
        residualCents: 0
      }
    ]
  });

  assert.deepEqual(result.lines.map((line) => line.parameterId), ["parameter-1", "parameter-2"]);
  assert.deepEqual(result.lines.map((line) => line.elapsedDays), [15, 16]);
  assert.deepEqual(result.lines.map((line) => line.segment), [1, 2]);
  assert.equal(result.lines[1]?.accumulatedBeforeCents, result.lines[0]?.accumulatedAfterCents);
});

test("datum isknjiženja prekida obračun na početku tog datuma", () => {
  const result = calculate({
    disposalDate: "2025-02-01",
    periodTo: "2025-12-31"
  });

  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0]?.segmentEnd, "2025-02-01");
  assert.equal(result.totalCents, 10_192);
});

test("kraj mjeseca i prestupna godina koriste stabilne date-only datume", () => {
  const result = calculate({
    grossCents: 100_00,
    availableDate: "2024-02-29",
    periodFrom: "2024-02-29",
    periodTo: "2025-02-28",
    parameters: [{
      id: "parameter-1",
      effectiveFrom: "2024-02-29",
      method: "LINEAR",
      usefulLifeMonths: 12,
      residualCents: 0
    }]
  });

  assert.equal(result.totalCents, 10_000);
  assert.equal(result.lines.at(-1)?.segmentEnd, "2025-02-28");
});

test("zbir zasebnih mjesečnih obračuna jednak je godišnjem obračunu", () => {
  const annual = calculate();
  const monthlyTotal = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const from = `2025-${String(month).padStart(2, "0")}-01`;
    const to = new Date(Date.UTC(2025, month, 0)).toISOString().slice(0, 10);

    return calculate({ periodFrom: from, periodTo: to }).totalCents;
  }).reduce((sum, amount) => sum + amount, 0);

  assert.equal(monthlyTotal, annual.totalCents);
});

test("veliki dozvoljeni iznosi ne gube preciznost u međurezultatu", () => {
  const result = calculate({ grossCents: 8_000_000_000_000_000 });

  assert.equal(result.errors.length, 0);
  assert.equal(result.totalCents, 8_000_000_000_000_000);
});

test("nepodržana metoda i neispravni ulazi vraćaju strukturisane greške", () => {
  const unsupported = calculate({ parameters: [{
    id: "parameter-1",
    effectiveFrom: "2025-01-01",
    method: "DEGRESSIVE",
    usefulLifeMonths: 12,
    residualCents: 0
  }] });
  const invalidPeriod = calculate({ periodFrom: "2025-02-01", periodTo: "2025-01-31" });

  assert.equal(unsupported.errors[0]?.code, "UNSUPPORTED_METHOD");
  assert.equal(invalidPeriod.errors[0]?.code, "INVALID_PERIOD");
});

test("preuzimanje na početku 2026. ne gubi prvi dan amortizacije", () => {
  const result = calculate({
    availableDate: "2020-01-01",
    periodFrom: "2026-01-01", periodTo: "2026-12-31",
    parameters: [{ id: "opening", effectiveFrom: "2026-01-01", method: "LINEAR", usefulLifeMonths: 12, residualCents: 0 }]
  });
  assert.equal(result.lines[0].segmentStart, "2026-01-01");
  assert.equal(result.totalCents, 120000);
});

test("neograničen vijek i isknjiženje prije raspoloživosti su kontrolisane greške", () => {
  const invalid = calculate({ parameters: [{ id: "p", effectiveFrom: "2025-01-01", method: "LINEAR", usefulLifeMonths: 2147483647, residualCents: 0 }] });
  assert.equal(invalid.errors[0].code, "INVALID_PARAMETER");
  assert.equal(calculate({ disposalDate: "2024-12-31" }).errors[0].code, "INVALID_PERIOD");
});

const rateParameter = { id:"rate", effectiveFrom:"2025-01-01", method:"LINEAR", algorithm:"MONTHLY_RATE_V2", annualRate:"20", basisCents:1_000_000, residualCents:0, usefulLifeMonths:60 };
function rates(overrides: Partial<Parameters<typeof calculateAssetPeriods>[0]> = {}) {
  return calculateAssetPeriods({assetId:"r",grossCents:1_000_000,accumulatedCents:0,availableDate:"2020-01-01",periodFrom:"2025-01-01",periodTo:"2025-12-31",parameters:[rateParameter],...overrides});
}
test("nova linearna stopa 20% čuva originalnu osnovicu preuzetog sredstva",()=>{
  const result=rates({accumulatedCents:400_000});
  assert.deepEqual(result.errors,[]); assert.equal(result.totalCents,200_000);
  assert.equal(result.lines[0].amountCents,16667); assert.equal(result.lines[1].amountCents,16666);
  assert.equal(result.lines.at(-1)?.netAfterCents,400_000);
});
test("mjesečna periodizacija: nepotpun januar i prestupni februar",()=>{
  const january=rates({parameters:[{...rateParameter,effectiveFrom:"2025-01-16"}],periodTo:"2025-01-31"});
  assert.equal(january.totalCents,8602); // 200000 / 12 * 16/31
  const leap=rates({parameters:[{...rateParameter,effectiveFrom:"2024-02-15"}],periodFrom:"2024-02-15",periodTo:"2024-02-29"});
  assert.equal(leap.totalCents,8621); // 200000 / 12 * 15/29
});
test("degresivna 30%: nezavisni iznosi, prelaz na linearnu i završetak",()=>{
  const p={...rateParameter,method:"DEGRESSIVE",annualRate:"30",usefulLifeMonths:60};
  const expected=[300000,210000,163333,163334,163333];
  for(let i=0;i<5;i++) {
    const y=2025+i, r=rates({parameters:[p],periodFrom:`${y}-01-01`,periodTo:`${y}-12-31`});
    assert.deepEqual(r.errors,[]); assert.equal(r.totalCents,expected[i]);
  }
  assert.equal(rates({parameters:[p],periodTo:"2029-12-31"}).totalCents,1_000_000);
  // With a longer remaining life the third year remains purely declining-balance.
  assert.equal(rates({parameters:[{...p,usefulLifeMonths:120}],periodFrom:"2027-01-01",periodTo:"2027-12-31"}).totalCents,147000);
});
test("funkcionalna kumulativno zaokružuje 100/3 i razlikuje nulu od nedostajućeg unosa",()=>{
  const p={...rateParameter,method:"UNITS_OF_PRODUCTION",basisCents:10000,expectedUnits:"3",priorUnits:"0",rateSource:"DERIVED"};
  const usage=[{parameterId:"rate",from:"2025-01-01",to:"2025-01-31",quantity:"1"},{parameterId:"rate",from:"2025-02-01",to:"2025-02-28",quantity:"1"},{parameterId:"rate",from:"2025-03-01",to:"2025-03-31",quantity:"1"}];
  const r=rates({grossCents:10000,parameters:[p],usage,periodTo:"2025-03-31"});
  assert.deepEqual(r.errors,[]); assert.deepEqual(r.lines.map(l=>l.amountCents),[3333,3334,3333]);
  assert.equal(rates({grossCents:10000,parameters:[p],periodTo:"2025-01-31"}).errors[0].code,"MISSING_USAGE");
  const zero=rates({grossCents:10000,parameters:[p],periodTo:"2025-01-31",usage:[{...usage[0],quantity:"0"}]});
  assert.deepEqual(zero.errors,[]);assert.equal(zero.totalCents,0);
  assert.equal(rates({grossCents:10000,parameters:[p],periodTo:"2025-01-31",usage:[{...usage[0],quantity:"4"}]}).errors[0].code,"INVALID_USAGE");
  assert.equal(rates({grossCents:10000,parameters:[p],periodTo:"2025-01-15",usage}).errors[0].code,"INVALID_USAGE");
});
test("funkcionalno početno stanje ne ponavlja prethodnih 8000 sati otpisa",()=>{
  const p={...rateParameter,method:"UNITS_OF_PRODUCTION",expectedUnits:"20000",priorUnits:"8000",rateSource:"DERIVED"};
  const r=rates({accumulatedCents:400000,parameters:[p],periodTo:"2025-01-31",usage:[{parameterId:"rate",from:"2025-01-01",to:"2025-01-31",quantity:"100"}]});
  assert.deepEqual(r.errors,[]);assert.equal(r.totalCents,5000);assert.equal(r.lines[0].netAfterCents,595000);
});
test("ručna stopa po jedinici, precizne količine i limit ostatka",()=>{
  const p={...rateParameter,method:"UNITS_OF_PRODUCTION",basisCents:900000,residualCents:100000,expectedUnits:"10000",priorUnits:"0",rateSource:"MANUAL",unitRate:"1.234567"};
  const r=rates({parameters:[p],periodTo:"2025-01-31",usage:[{parameterId:"rate",from:"2025-01-01",to:"2025-01-31",quantity:"2.500001"}]});
  assert.deepEqual(r.errors,[]); assert.equal(r.totalCents,309);
  const cap=rates({parameters:[p],periodTo:"2025-01-31",usage:[{parameterId:"rate",from:"2025-01-01",to:"2025-01-31",quantity:"10000"}]});
  assert.equal(cap.totalCents,900000);assert.equal(cap.lines[0].netAfterCents,100000);
});
test("mjesečni zbirovi jednaki godišnjem, uključujući isknjiženje i promjenu usred mjeseca",()=>{
  const parameters=[rateParameter,{...rateParameter,id:"new",effectiveFrom:"2025-07-15",annualRate:"30",basisCents:892473}];
  const annual=rates({parameters,disposalDate:"2025-11-16"});
  let total=0;
  for(let m=1;m<=12;m++) {
    const month=String(m).padStart(2,"0"), last=new Date(Date.UTC(2025,m,0)).getUTCDate();
    const r=rates({parameters,disposalDate:"2025-11-16",periodFrom:`2025-${month}-01`,periodTo:`2025-${month}-${last}`});
    assert.deepEqual(r.errors,[]);total+=r.totalCents;
  }
  assert.equal(total,annual.totalCents);
});
test("legacy segment ostaje identičan kada kasnije počne nova metoda",()=>{
  const legacy={id:"old",effectiveFrom:"2025-01-01",method:"LINEAR",usefulLifeMonths:12,residualCents:0,algorithm:"ACTUAL_DAYS_LIFE_V1"};
  const r=rates({grossCents:120000,parameters:[legacy,{...rateParameter,id:"new",effectiveFrom:"2025-07-01",basisCents:60493}],periodTo:"2025-02-28"});
  assert.deepEqual(r.errors,[]);assert.deepEqual(r.lines.map(l=>l.amountCents),[10192,9205]);
});

test("degresivni preostali vijek završava tačno uz ostatak i nepotpune mjesece",()=>{
  for(const start of ["2025-01-16","2024-02-29","2025-10-31"]) {
    for(const life of [1,15,37,60]) {
      const result=rates({grossCents:1000001,accumulatedCents:200000,parameters:[{...rateParameter,effectiveFrom:start,method:"DEGRESSIVE",annualRate:"30",usefulLifeMonths:life,residualCents:100001,basisCents:900000}],periodFrom:start,periodTo:"2032-12-31"});
      assert.deepEqual(result.errors,[]);assert.equal(result.totalCents,700000,`${start}/${life}`);
    }
  }
});
test("početni funkcionalni otpis prenosi i kumulativni dio centa",()=>{
  const p={...rateParameter,method:"UNITS_OF_PRODUCTION",basisCents:10000,expectedUnits:"3",priorUnits:"1",rateSource:"DERIVED"};
  const result=rates({grossCents:10000,accumulatedCents:3333,parameters:[p],periodTo:"2025-01-31",usage:[{parameterId:"rate",from:"2025-01-01",to:"2025-01-31",quantity:"1"}]});
  assert.equal(result.totalCents,3334);
});
