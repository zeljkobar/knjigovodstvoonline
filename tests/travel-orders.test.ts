import { countryDaily, travelCountries } from "../src/lib/travel-countries";
import { travelDefaults } from "../src/lib/travel-orders";
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateTravel, fuelRate, dailyCount, routeKey, travelDate, travelDuration, travelMoney, travelNumber } from "../src/lib/travel-orders";
test("travel: exact cents, decimal input and invalid values",()=>{
 assert.equal(travelMoney("55,30"),5530); assert.equal(travelMoney("0.42"),42);
 for(const s of ["-1","NaN","1.234","1e2",""])assert.throws(()=>travelMoney(s));
 assert.throws(()=>travelNumber("Infinity",100));assert.throws(()=>travelDate("2026-02-30"));
});
test("travel: known relation works in either direction",()=>{
 assert.equal(routeKey(" Bar ","novi  sad"),routeKey("NOVI SAD","BAR"));
});
test("travel: per diems use strict configurable hour thresholds",()=>{
 for(const [hours,days] of [[8,0],[8.5,.5],[12,.5],[12.5,1],[24,1],[32,1],[36,1.5],[110,5]])assert.equal(dailyCount(hours*60,8,12),days);
 assert.equal(dailyCount(10*60,6,9),1);
});
test("travel: duration follows Montenegro clock including DST",()=>{
 assert.equal(travelDuration("2025-12-18T07:00","2025-12-22T21:00"),110*60);
 assert.equal(travelDuration("2026-03-29T01:00","2026-03-29T04:00"),2*60);
 assert.throws(()=>travelDuration("2026-03-29T02:30","2026-03-29T04:00"));
 assert.throws(()=>travelDuration("2026-10-02T10:00","2026-10-01T10:00"));
});
test("travel: Excel example and advance reimbursement",()=>{
 const relacije=[{od:"BAR",do:"NOVI SAD",km:565,cijena:42,prevoz:"SOPSTVENO VOZILO",iznos:0},{od:"NOVI SAD",do:"BAR",km:565,cijena:42,prevoz:"SOPSTVENO VOZILO",iznos:0}];
 const result=calculateTravel({brojDnevnica:5,dnevnica:5530,relacije,troskovi:[],akontacija:80000});
 assert.equal(result.ukupno,75110);assert.equal(result.razlika,-4890);assert.equal(result.relacije[0].iznos,23730);
 assert.equal(calculateTravel({brojDnevnica:.5,dnevnica:5501,relacije:[],troskovi:[{opis:"parking",iznos:100}],akontacija:0}).ukupno,2851);
});

test("travel: fuel calculation preserves quarter-cent rate and excludes company car",()=>{
 const fuel=travelMoney("1.67");
 const privateLeg={od:"BAR",do:"NOVI SAD",km:565,cijena:99999,prevoz:"SOPSTVENO VOZILO",stopa10000:fuelRate(fuel,"SOPSTVENO VOZILO"),iznos:0};
 const companyLeg={...privateLeg,prevoz:"SLUŽBENO VOZILO",stopa10000:fuelRate(fuel,"SLUŽBENO VOZILO")};
 const result=calculateTravel({brojDnevnica:0,dnevnica:0,relacije:[privateLeg,companyLeg],troskovi:[],akontacija:0});
 assert.equal(privateLeg.stopa10000,4175);assert.equal(result.relacije[0].iznos,23589);assert.equal(result.relacije[1].iznos,0);
 assert.throws(()=>fuelRate(fuel,"BILO ŠTA"));assert.throws(()=>fuelRate(10001,"SOPSTVENO VOZILO"));
 assert.notEqual(routeKey("BAR","NOVI SAD","ME","RS"),routeKey("BAR","NOVI SAD","RS","RS"));
});

test("travel: official country defaults, domestic configuration and firm overrides",()=>{
 assert.equal(travelCountries.length,135);assert.equal(new Set(travelCountries.map(c=>c.kod)).size,135);
 assert.equal(countryDaily("RS",travelDefaults),5530);assert.equal(countryDaily("AL",travelDefaults),6300);
 assert.equal(countryDaily("OTHER",travelDefaults),6500);
 assert.equal(countryDaily("ME",{...travelDefaults,dnevnica:1800}),1800);
 assert.equal(countryDaily("RS",{...travelDefaults,dnevniceDrzava:{RS:6000}}),6000);
 assert.equal(countryDaily("AL",{...travelDefaults,dnevniceDrzava:{AL:0}}),0);
 assert.throws(()=>countryDaily("XX",travelDefaults));
});
