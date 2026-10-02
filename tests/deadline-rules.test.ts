import assert from "node:assert/strict";
import test from "node:test";
import {deadlineDate,deadlinePeriod,deadlineState,localToday,validDeadline,deadlineSelection} from "../src/lib/deadline-rules";
test("deadlines map January to previous December and annual report to previous year",()=>{
 assert.equal(deadlineDate("PDV",2027,1).toISOString(),"2027-01-15T00:00:00.000Z");
 assert.equal(deadlinePeriod("PLATE",2027,1),"12/2026");
 assert.equal(deadlineDate("ZAVRSNI",2027,3).toISOString(),"2027-03-31T00:00:00.000Z");
 assert.equal(deadlinePeriod("ZAVRSNI",2027,3),"2026");
 assert.equal(validDeadline("ZAVRSNI",2027,2),false);assert.equal(validDeadline("PDV",2027,13),false);
});
test("day boundaries use Montenegro date and five day inclusive warning",()=>{
 const due=deadlineDate("PDV",2026,10);
 for(const [day,state] of [[9,"Predstoji"],[10,"Uskoro ističe"],[15,"Danas ističe"],[16,"Kasni"]] as const) assert.equal(deadlineState(due,false,new Date(Date.UTC(2026,9,day))),state);
 assert.equal(deadlineState(due,true,new Date('2026-12-01')),"Završeno");
 assert.equal(localToday(new Date('2026-10-14T22:30:00Z')).toISOString(),'2026-10-15T00:00:00.000Z');
});

test("selected period stays previous month throughout month and rolls across years",()=>{
 for(const day of [1,15,21,31])assert.equal(deadlineSelection("PDV",undefined,new Date(`2026-10-${day.toString().padStart(2,"0")}T12:00:00Z`)).period,"2026-09");
 const january=deadlineSelection("PLATE",undefined,new Date("2027-01-01T12:00:00Z"));
 assert.equal(january.period,"2026-12");assert.equal(january.year,2027);assert.equal(january.month,1);
 assert.equal(deadlineSelection("ZAVRSNI",undefined,new Date("2027-12-10T12:00:00Z")).period,"2026");
 assert.equal(deadlineSelection("PDV","2025-12").due.toISOString(),"2026-01-15T00:00:00.000Z");
 assert.equal(deadlineSelection("PDV","2026-13",new Date("2026-10-01T12:00:00Z")).period,"2026-09");
});
