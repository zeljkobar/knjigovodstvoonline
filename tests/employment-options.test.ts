import test from "node:test";
import assert from "node:assert/strict";
import {workSchedules,getWorkSchedule,strictEmploymentDate} from "../src/lib/employment-options";
import {employeeMonthlyScheduledHours} from "../src/lib/payroll-hours";
import {renderEmploymentContract,type EmploymentSnapshot} from "../src/lib/employment-contract";
test("work schedules map all five options to payroll percentages",()=>{
 for(const s of Object.values(workSchedules)){assert.equal(s.weekly,s.daily*5);assert.equal(s.percentage,s.daily/8*100);}
 assert.equal(getWorkSchedule("SKRACENO_1")?.percentage,12.5);assert.equal(getWorkSchedule("FAKE"),null);
 assert.equal(employeeMonthlyScheduledHours({calculationFundHours:176,employmentPercentage:12.5}),22);
 assert.equal(strictEmploymentDate("2026-02-30"),null);
});
test("contract substitution escapes text and does not retain sample identities",()=>{
 const text=renderEmploymentContract({firma:'<img src=x onerror=alert(1)>',opis:'Posao & opis',istekTekst:'',dnevno:'1',nedjeljno:'5'} as EmploymentSnapshot);
 assert.match(text,/&lt;img/);assert.doesNotMatch(text,/<img|MURIZ|NOVOVIĆ|SPIČANOVIĆ|\{\{/);
 assert.match(text,/Posao &amp; opis/);
});
