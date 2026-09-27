import assert from "node:assert/strict";
import test from "node:test";
import { matchesMailRules, matchesMailFolder, parseMailRules, type CompanyMailConfig } from "../src/lib/company-mail-rules";
import { attachmentNames } from "../src/lib/imap-mail";
const mail = { senders: ["BANK@example.com"], subject: "Dnevni IZVOD 3L COMPANY 025", filenames: ["logo.png", "Racun_565-8070-30_izvod.pdf"] };
const empty = { sender: "", subject: "", attachment: "" };

test("every populated condition must match, including combinations", () => {
  for (let mask = 0; mask < 8; mask++) {
    const rule = { sender: mask & 1 ? "bank@example.com" : "", subject: mask & 2 ? "3l company" : "", attachment: mask & 4 ? "565-8070-30" : "" };
    assert.equal(matchesMailRules([rule], mail), true);
    for (const key of ["sender", "subject", "attachment"] as const) {
      if (rule[key]) assert.equal(matchesMailRules([{ ...rule, [key]: "does-not-match" }], mail), false);
    }
  }
});
test("sender is exact; subject and filename are literal case-insensitive substrings", () => {
  assert.equal(matchesMailRules([{ ...empty, sender: "bank@example.com" }], { ...mail, senders: ["fakebank@example.com"] }), false);
  assert.equal(matchesMailRules([{ ...empty, subject: "company 02" }], mail), true);
  assert.equal(matchesMailRules([{ ...empty, attachment: ".PDF" }], mail), true);
  assert.equal(matchesMailRules([{ ...empty, subject: ".*" }], mail), false);
  assert.equal(matchesMailRules([{ ...empty, attachment: "pdf" }], { ...mail, filenames: [] }), false);
});
test("any configured rule may match; blank rows do not broaden other rules", () => {
  const rules = parseMailRules([{ ...empty }, { ...empty, sender: "other@example.com" }, { ...empty, subject: "3L" }]);
  assert.equal(rules.length, 2);
  assert.equal(matchesMailRules(rules, mail), true);
  assert.equal(matchesMailRules(parseMailRules([empty, { ...empty, subject: "missing" }]), mail), false);
  assert.equal(matchesMailRules(parseMailRules([empty]), mail), true);
});
test("whitespace, Unicode normalization and validation", () => {
  assert.equal(parseMailRules([{ ...empty, subject: "  izvod  " }])[0].subject, "izvod");
  assert.equal(matchesMailRules([{ ...empty, subject: "račun" }], { ...mail, subject: "RAČUN".normalize("NFD") }), true);
  for (const value of [null, {}, Array(21).fill(empty), [{ ...empty, sender: "bad" }], [{ ...empty, subject: "a".repeat(321) }]]) assert.throws(() => parseMailRules(value));
});
test("folder selection obeys delimiter boundaries, optional subfolders and inbox", () => {
  const config: CompanyMailConfig = { firmaId: "a", folder: "Izvodi/3L", includeInbox: true, includeSubfolders: true, rules: [{ ...empty, subject: "3L" }] };
  assert.equal(matchesMailFolder(config, "INBOX", "/"), true);
  assert.equal(matchesMailFolder(config, "Izvodi/3L", "/"), true);
  assert.equal(matchesMailFolder(config, "Izvodi/3L/Banka", "/"), true);
  assert.equal(matchesMailFolder(config, "Izvodi/3L OTHER", "/"), false);
  assert.equal(matchesMailFolder({ ...config, includeInbox: false }, "INBOX", "/"), false);
  assert.equal(matchesMailFolder({ ...config, includeSubfolders: false }, "Izvodi/3L/Banka", "/"), false);
});
test("attachment filename matching traverses MIME structure", () => {
  assert.deepEqual(attachmentNames({ type: "multipart/mixed", childNodes: [
    { type: "text/plain" }, { type: "application/pdf", dispositionParameters: { filename: "izvod.pdf" } },
    { type: "multipart/mixed", childNodes: [{ type: "application/xml", parameters: { name: "izvod.xml" } }] }
  ] }), ["izvod.pdf", "izvod.xml"]);
});

 test("INBOX requires a filled condition, including when chosen as company folder", () => {
  const config: CompanyMailConfig = { firmaId: "a", folder: "Izvodi/3L", includeInbox: true, includeSubfolders: true, rules: [] };
  for (const rules of [[], [empty], [{ ...empty, subject: "   " }]]) {
    assert.equal(matchesMailFolder({ ...config, rules }, "INBOX", "/"), false);
    assert.equal(matchesMailFolder({ ...config, rules, folder: "INBOX" }, "INBOX", "/"), false);
    assert.equal(matchesMailFolder({ ...config, rules }, "Izvodi/3L", "/"), true);
    assert.equal(matchesMailFolder({ ...config, rules, folder: null }, "INBOX", "/"), false);
  }
  for (const key of ["sender", "subject", "attachment"] as const) {
    assert.equal(matchesMailFolder({ ...config, rules: [{ ...empty, [key]: "condition" }] }, "INBOX", "/"), true);
  }
});
