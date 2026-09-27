import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { readFileSync } from "node:fs";
import { imapOptions, probeImap, safeImapError } from "../src/lib/imap-connection";
import { canAccessAgencyImap } from "../src/lib/imap-access-policy";

const env = { IMAP_HOST: "imap.example.com", IMAP_PORT: "993", IMAP_SECURE: "true", IMAP_USER: "test", IMAP_PASS: " secret stays unchanged ", IMAP_FOLDER: "INBOX" };
type Factory = NonNullable<Parameters<typeof probeImap>[1]>;
class FakeClient extends EventEmitter {
  calls: string[] = [];
  readOnly = true;
  count = 17;
  async connect() { this.calls.push("connect"); }
  async mailboxOpen(folder: string, options: { readOnly?: boolean }) {
    assert.equal(folder, "INBOX");
    assert.equal(options.readOnly, true);
    this.calls.push("EXAMINE");
    return { readOnly: this.readOnly, exists: this.count };
  }
  async logout() { this.calls.push("logout"); }
  close() { this.calls.push("close"); }
}
function factory(client: FakeClient): Factory {
  return () => client;
}

test("strict TLS and disabled credential logging; password is not trimmed", () => {
  const options = imapOptions(env)!;
  assert.equal(options.secure, true);
  assert.equal(options.tls?.rejectUnauthorized, true);
  assert.equal(options.tls?.minVersion, "TLSv1.2");
  assert.equal(options.servername, env.IMAP_HOST);
  assert.equal(options.auth?.pass, env.IMAP_PASS);
  assert.equal(options.logger, false);
  assert.equal(options.logRaw, false);
  assert.equal(options.emitLogs, false);
  assert.equal(options.disableAutoIdle, true);
});
test("invalid configuration never opens a connection", async () => {
  for (const changes of [{ IMAP_PASS: "" }, { IMAP_SECURE: "false" }, { IMAP_PORT: "143" }, { IMAP_FOLDER: "Other" }]) {
    const result = await probeImap({ ...env, ...changes }, () => { throw new Error("must not connect"); });
    assert.equal(!result.ok && result.code, "CONFIG");
  }
});
test("returns only message count, including empty INBOX, and closes connection", async () => {
  for (const count of [0, 17]) {
    const client = new FakeClient(); client.count = count;
    assert.deepEqual(await probeImap(env, factory(client)), { ok: true, messageCount: count, folder: "INBOX", readOnly: true });
    assert.deepEqual(client.calls, ["connect", "EXAMINE", "logout", "close"]);
  }
});
test("rejects mailbox that is not read-only", async () => {
  const client = new FakeClient(); client.readOnly = false;
  const result = await probeImap(env, factory(client));
  assert.equal(!result.ok && result.code, "MAILBOX");
  assert.equal(client.calls.at(-1), "close");
});
test("errors are classified without exposing password or server response", () => {
  for (const [error, expected] of [
    [{ authenticationFailed: true }, "AUTH"],
    [{ code: "ECONNREFUSED" }, "NETWORK"],
    [{ code: "CERT_HAS_EXPIRED" }, "TLS"],
    [{ code: "ERR_TLS_CERT_ALTNAME_INVALID" }, "TLS"],
    [{ code: "DEPTH_ZERO_SELF_SIGNED_CERT" }, "TLS"],
    [{ tlsFailed: true }, "TLS"],
    [{}, "PROTOCOL"]
  ] as const) {
    const result = safeImapError({ ...error, message: env.IMAP_PASS, response: env.IMAP_PASS, executedCommand: env.IMAP_PASS });
    assert.equal(!result.ok && result.code, expected);
    assert.equal(JSON.stringify(result).includes(env.IMAP_PASS), false);
  }
});
test("authentication failure closes socket", async () => {
  const client = new FakeClient();
  client.connect = async () => { throw { authenticationFailed: true, response: env.IMAP_PASS }; };
  const result = await probeImap(env, factory(client));
  assert.equal(!result.ok && result.code, "AUTH");
  assert.deepEqual(client.calls, ["close"]);
});
test("whole-operation timeout closes stalled connection", async () => {
  const client = new FakeClient();
  client.connect = () => new Promise(() => {});
  const result = await probeImap(env, factory(client), 15);
  assert.equal(!result.ok && result.code, "NETWORK");
  assert.ok(client.calls.includes("close"));
});
test("asynchronous socket errors are caught without leaking server text", async () => {
  const client = new FakeClient();
  client.connect = () => new Promise(() => { setImmediate(() => client.emit("error", { code: "ECONNRESET", message: env.IMAP_PASS })); });
  const result = await probeImap(env, factory(client));
  assert.equal(!result.ok && result.code, "NETWORK");
  assert.equal(client.calls.at(-1), "close");
});
test("mailbox is restricted to the configured agency administrator", () => {
  assert.equal(canAccessAgencyImap({ rola: "admin_agencije", agencija_id: "a" }, "a"), true);
  for (const rola of ["admin", "korisnik_agencije", "klijent"]) {
    assert.equal(canAccessAgencyImap({ rola, agencija_id: "a" }, "a"), false);
  }
  for (const agencija_id of ["b", null]) {
    assert.equal(canAccessAgencyImap({ rola: "admin_agencije", agencija_id }, "a"), false);
  }
  for (const configured of [undefined, "", " "]) {
    assert.equal(canAccessAgencyImap({ rola: "admin_agencije", agencija_id: "a" }, configured), false);
  }
});
test("page and server action enforce agency access before opening mailbox", () => {
  const action = readFileSync("src/app/agencija/izvodi/imap/actions.ts", "utf8");
  const page = readFileSync("src/app/agencija/izvodi/imap/page.tsx", "utf8");
  const guardPosition = action.indexOf("await requireImapAgency()");
  assert.ok(guardPosition >= 0 && guardPosition < action.indexOf("await testImapConnection()"));
  assert.ok(page.includes("await requireImapCompany("));
  assert.ok(action.includes("agencijaId: user.agencija_id"));
});
