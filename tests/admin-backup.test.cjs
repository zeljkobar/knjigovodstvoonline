/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS regression infrastructure. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceLoader } = require('./helpers/source-loader.cjs');
const { parseBackupStatus, backupRowState, backupDatabases, backupDate } = sourceLoader()('src/lib/backup-status.ts');
const requestId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
function fixture() {
  return { version: 1, checkedAt: '2026-11-13T04:00:00Z', running: false, retryPending: false, serviceFailed: false,
    startedAt: null, lastRestoreAt: null, scheduler: { enabled: true, active: true, nextRunAt: '2026-11-14T02:00:00Z' },
    databases: backupDatabases.map(({ id }) => ({ database: id, phase: null, lastAttempt: { ok: true, finishedAt: '2026-11-13T03:00:00Z' },
      lastSuccess: { verifiedAt: '2026-11-13T03:00:00Z', bytes: 1024, filename: `summa-${id}-20261113T030000Z-deadbeef.tar.age` } })) };
}
test('public projection exposes exactly four databases and excludes private state', () => {
  const value = fixture(); value.token = 'secret'; value.databases[0].lastSuccess.env = 'secret';
  const parsed = parseBackupStatus(value);
  assert.equal(parsed.databases.length, 4);
  assert.ok(!JSON.stringify(parsed).includes('secret'));
  for (const mutate of [v => v.databases[0].database = 'postgres', v => v.databases[0].lastSuccess.filename = '../key',
    v => v.databases[0].lastSuccess.bytes = -1, v => v.databases[0].phase = '__proto__', v => v.checkedAt = 'invalid']) {
    const invalid = fixture(); mutate(invalid); assert.throws(() => parseBackupStatus(invalid));
  }
});
test('failed, missing, stale and active copies cannot appear healthy by old metadata', () => {
  const status = parseBackupStatus(fixture()), row = status.databases[0];
  assert.equal(backupRowState(row, status).tone, 'success');
  row.lastAttempt.ok = false; assert.equal(backupRowState(row, status).tone, 'error');
  row.lastAttempt = null; row.lastSuccess.verifiedAt = '2026-11-11T00:00:00Z';
  assert.equal(backupRowState(row, status).tone, 'warning');
  row.lastSuccess = null; assert.equal(backupRowState(row, status).tone, 'warning');
  status.running = true; row.phase = 'uploading'; assert.equal(backupRowState(row, status).tone, 'info');
  row.phase = 'failed'; assert.equal(backupRowState(row, status).tone, 'error');
  assert.match(backupDate('2026-11-14T02:00:00Z'), /03:00:00/);
});
function actions({ denied = false, auditFails = false, transportFails = false, response = 'accepted' } = {}) {
  const calls = [];
  const load = sourceLoader({
    '@/lib/auth': { requireRole: async role => { calls.push(['auth', role]); if (denied) throw new Error('redirect'); return { id: actorId }; } },
    '@/lib/audit': { auditLog: async value => { calls.push(['audit', value]); if (auditFails) throw new Error('audit unavailable'); } },
    '@/lib/backup-control': { readBackupControl: async () => { calls.push(['read']); if (transportFails) throw new Error('secret raw output'); return fixture(); },
      startBackupControl: async value => { calls.push(['start', value]); if (transportFails) throw new Error('secret raw output'); return response; } },
    'next/cache': { revalidatePath: path => calls.push(['revalidate', path]) }
  });
  return { api: load('src/app/admin/sajt/backup/actions.ts'), calls };
}
function form() { const data = new FormData(); data.set('request_id', requestId); data.set('actorId', 'attacker'); return data; }
test('every read and start requires admin before accessing server or audit', async () => {
  const { api, calls } = actions({ denied: true });
  await assert.rejects(api.getBackupStatus(), /redirect/);
  await assert.rejects(api.startBackup({}, form()), /redirect/);
  assert.deepEqual(calls, [['auth', 'admin'], ['auth', 'admin']]);
});
test('audit must succeed before start, and actor comes from authenticated user', async () => {
  const blocked = actions({ auditFails: true });
  assert.equal((await blocked.api.startBackup({}, form())).error, true);
  assert.ok(!blocked.calls.some(([kind]) => kind === 'start'));
  const allowed = actions();
  assert.equal((await allowed.api.startBackup({}, form())).status, 'accepted');
  assert.deepEqual(allowed.calls.map(([kind]) => kind), ['auth', 'audit', 'start', 'audit', 'revalidate']);
  assert.deepEqual(allowed.calls[2][1], { requestId, actorId });
});
test('malformed requests never start and transport failures do not expose raw output', async () => {
  const { api, calls } = actions({ transportFails: true });
  assert.equal((await api.startBackup({}, new FormData())).error, true);
  assert.ok(!calls.some(([kind]) => kind === 'start'));
  assert.ok(!JSON.stringify(await api.getBackupStatus()).includes('secret'));
  const result = await api.startBackup({}, form());
  assert.equal(result.error, true); assert.ok(!JSON.stringify(result).includes('secret'));
});
test('duplicate and cooldown results do not claim a new backup was completed', async () => {
  for (const response of ['already_running', 'already_requested', 'cooldown']) {
    const { api } = actions({ response });
    assert.equal((await api.startBackup({}, form())).status, response);
  }
});
test('local development has no remote connection and cannot launch a process', async () => {
  if (process.env.NODE_ENV === 'production' && process.platform === 'linux') return;
  let called = false;
  const bridge = sourceLoader({ 'node:child_process': { execFile: () => { called = true; throw new Error('must not execute'); } } })('src/lib/backup-control.ts');
  await assert.rejects(bridge.readBackupControl(), /BACKUP_SERVER_ONLY/);
  await assert.rejects(bridge.startBackupControl({ requestId, actorId }), /BACKUP_SERVER_ONLY/);
  assert.equal(called, false);
});
