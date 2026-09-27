import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { mailPage, mailReference, parseMailSource, MAX_MAIL_BYTES } from "../src/lib/imap-mail";

test("UID and UIDVALIDITY reject missing, range and injected values", () => {
  assert.deepEqual(mailReference("42", "123"), { uid: 42, validity: "123" });
  for (const uid of [0, -1, 1.5, "1:*", "1,2", Infinity, 4294967296, undefined]) {
    assert.throws(() => mailReference(uid, "123"));
  }
  for (const validity of ["", "0", "1:*", "4294967296", undefined]) {
    assert.throws(() => mailReference(42, validity));
  }
});
test("invalid pagination falls back to first page", () => {
  for (const value of [undefined, -1, "x", "2.5", Infinity]) assert.equal(mailPage(value), 1);
  assert.equal(mailPage("2"), 2);
});
test("MIME decodes UTF-8 text and attachment bytes", async () => {
  const raw = [
    'Subject: =?UTF-8?B?SXp2b2QgxaE=?=',
    'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="parts"', '',
    '--parts', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '',
    Buffer.from('Poštovani, izvod je u prilogu.').toString('base64'),
    '--parts', 'Content-Type: application/pdf', 'Content-Disposition: attachment; filename="izvod.pdf"',
    'Content-Transfer-Encoding: base64', '', Buffer.from('%PDF-test').toString('base64'), '--parts--', ''
  ].join('\r\n');
  const parsed = await parseMailSource(Buffer.from(raw));
  assert.equal(parsed.subject, 'Izvod š');
  assert.match(parsed.text || '', /Poštovani/);
  assert.equal(parsed.attachments[0].filename, 'izvod.pdf');
  assert.equal(parsed.attachments[0].content.toString(), '%PDF-test');
});
test("HTML-only message supplies text without script content", async () => {
  const parsed = await parseMailSource(Buffer.from('Content-Type: text/html; charset=utf-8\r\n\r\n<p>Pozdrav</p><script>evil()</script><img src="https://example.invalid/tracker">'));
  assert.match(parsed.text || '', /Pozdrav/);
  assert.doesNotMatch(parsed.text || '', /evil\(\)|<script|<img/);
});
test("oversized message is rejected before parsing", async () => {
  await assert.rejects(parseMailSource(Buffer.alloc(MAX_MAIL_BYTES + 1)), /10 MB/);
});
test("detail and attachment routes enforce tenant guard and never render email HTML", () => {
  const page = readFileSync('src/app/agencija/izvodi/imap/page.tsx', 'utf8');
  const route = readFileSync('src/app/agencija/izvodi/imap/prilog/route.ts', 'utf8');
  assert.ok(page.indexOf('await requireImapCompany(') < page.indexOf('await getMailDetail('));
  assert.ok(route.indexOf('await requireImapCompany(') < route.indexOf('await getMailAttachment('));
  assert.ok(!page.includes('dangerouslySetInnerHTML'));
  assert.ok(route.includes('private, no-store'));
  assert.ok(route.includes('application/octet-stream'));
});
