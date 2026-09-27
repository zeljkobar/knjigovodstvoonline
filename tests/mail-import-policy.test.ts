import assert from "node:assert/strict";
import test from "node:test";
import { attachmentHash, assertStatementAccount, normalizeStatementAccount, mailSourceKey, supportedStatementAttachment } from "../src/lib/mail-import-policy";

test("attachment identity survives message moves and distinguishes changed content", () => {
  const bytes = Buffer.from("statement bytes");
  assert.equal(attachmentHash(bytes), attachmentHash(Buffer.from(bytes)));
  assert.notEqual(attachmentHash(bytes), attachmentHash(Buffer.from("changed statement")));
  assert.notEqual(mailSourceKey("INBOX", "1", 2), mailSourceKey("Izvodi/firma", "1", 2));
  assert.notEqual(mailSourceKey("INBOX", "1", 2), mailSourceKey("INBOX", "2", 2));
});
test("only supported attachment formats are sent to statement parsers", () => {
  for (const name of ["IZVOD.PDF", "a.xml", "a.htm", "a.html"]) assert.equal(supportedStatementAttachment(name), true);
  for (const name of ["logo.png", "a.zip", "izvod.pdf.exe", ""]) assert.equal(supportedStatementAttachment(name), false);
});
test("account must come from the statement and match the company account", () => {
  assert.doesNotThrow(() => assertStatementAccount("535-24974-41", "5352497441"));
  for (const account of [undefined, null, "", "text", "535-24975-41"]) {
    assert.throws(() => assertStatementAccount(account, "535-24974-41"));
  }
});

test("compact and zero-padded domestic bank accounts identify the same company", () => {
  for (const [short, long] of [["565-8070-30", "565000000000807030"], ["510-121622-88", "510000000012162288"], ["535-24974-41", "535000000002497441"]]) {
    assert.equal(normalizeStatementAccount(short), long);
    assert.doesNotThrow(() => assertStatementAccount(long, short));
  }
  assert.notEqual(normalizeStatementAccount("510-121622-88"), normalizeStatementAccount("510-121623-88"));
  for (const value of ["", "text", "abc51012162288", "510-121622-8", "1234567890123456789"]) assert.equal(normalizeStatementAccount(value), "");
});
