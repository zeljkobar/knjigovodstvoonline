import assert from "node:assert/strict";
import test from "node:test";
import { bankStatementGaps, statementSequenceNumber } from "../src/lib/bank-statement-gaps";

test("gaps include the start of the year, sort numerically and deduplicate formats",()=>{
  const result=bankStatementGaps(["010","2","002/2026","5","4"],2026);
  assert.deepEqual(result.ranges,[{from:1,to:1},{from:3,to:3},{from:6,to:9}]);
  assert.equal(result.missingCount,6);assert.equal(result.highest,10);
});
test("empty and partial evidence is distinct from a complete numeric sequence",()=>{
  assert.equal(bankStatementGaps([],2026).highest,null);
  const result=bankStatementGaps(["1","002/2026","3","X-4","004/2025"],2026);
  assert.equal(result.missingCount,0);assert.deepEqual(result.unrecognized,["X-4","004/2025"]);
  for(const invalid of ["0","-1","1.5","2026/002","9007199254740992","abc"])assert.equal(statementSequenceNumber(invalid,2026),null);
});
test("large gaps remain compact and filling a gap removes it",()=>{
  assert.deepEqual(bankStatementGaps(["2147483647"],2026).ranges,[{from:1,to:2147483646}]);
  assert.equal(bankStatementGaps(["1","3"],2026).missingCount,1);
  assert.equal(bankStatementGaps(["1","2","3"],2026).missingCount,0);
});
