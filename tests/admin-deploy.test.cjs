/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS regression infrastructure. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceLoader } = require('./helpers/source-loader.cjs');
const { parseDeployStatus, deploySite } = sourceLoader()('src/lib/deploy-status.ts');
const requestId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
function fixture() {
  return { version: 1, site: deploySite, ready: true, checkedAt: '2026-11-13T04:00:00Z', running: false,
    outcome: 'succeeded', requestId, phase: 'done', startedAt: null, finishedAt: null,
    currentCommit: 'a'.repeat(40), lastSuccess: { at: '2026-11-13T03:00:00Z', commit: 'a'.repeat(40) }, error: null };
}
test('deploy status projects public fields and rejects unsupported site, phase and revisions', () => {
  const value = fixture(); value.rawLog = 'SECRET'; value.lastSuccess.environment = 'SECRET';
  assert.ok(!JSON.stringify(parseDeployStatus(value)).includes('SECRET'));
  for (const mutate of [v => v.site = 'other', v => v.phase = '__proto__', v => v.currentCommit = '../path',
    v => v.error = 'SECRET', v => v.checkedAt = 'invalid', v => v.running = 'false']) {
    const invalid = fixture(); mutate(invalid); assert.throws(() => parseDeployStatus(invalid));
  }
});
function actions({ denied = false, auditFails = false, transportFails = false, response = 'accepted' } = {}) {
  const calls = [];
  const load = sourceLoader({
    '@/lib/auth': { requireRole: async role => { calls.push(['auth', role]); if (denied) throw new Error('redirect'); return { id: actorId }; } },
    '@/lib/audit': { auditLog: async value => { calls.push(['audit', value]); if (auditFails) throw new Error('audit unavailable'); } },
    '@/lib/deploy-control': { readDeployControl: async () => { calls.push(['read']); if (transportFails) throw new Error('SECRET'); return fixture(); },
      startDeployControl: async value => { calls.push(['start', value]); if (transportFails) throw new Error('SECRET'); return response; } }
  });
  return { api: load('src/app/admin/sajt/deploy/actions.ts'), calls };
}
function form() {
  const data = new FormData(); data.set('request_id', requestId); data.set('actorId', 'attacker');
  data.set('site', 'royal'); data.set('command', 'arbitrary command'); return data;
}
test('both actions require admin before reading state or recording a request', async () => {
  const { api, calls } = actions({ denied: true });
  await assert.rejects(api.getDeployStatus(), /redirect/);
  await assert.rejects(api.startDeploy({}, form()), /redirect/);
  assert.deepEqual(calls, [['auth', 'admin'], ['auth', 'admin']]);
});
test('audit failure prevents execution and browser cannot choose actor, command or site', async () => {
  const blocked = actions({ auditFails: true });
  assert.equal((await blocked.api.startDeploy({}, form())).error, true);
  assert.ok(!blocked.calls.some(([kind]) => kind === 'start'));
  const allowed = actions();
  assert.equal((await allowed.api.startDeploy({}, form())).status, 'accepted');
  assert.deepEqual(allowed.calls.map(([kind]) => kind), ['auth', 'audit', 'start', 'audit']);
  assert.deepEqual(allowed.calls[2][1], { site: deploySite, requestId, actorId });
});
test('malformed requests and unknown transport results fail without leaking logs', async () => {
  const { api, calls } = actions({ transportFails: true });
  assert.equal((await api.startDeploy({}, new FormData())).error, true);
  assert.ok(!calls.some(([kind]) => kind === 'start'));
  assert.ok(!JSON.stringify(await api.getDeployStatus()).includes('SECRET'));
  const result = await api.startDeploy({}, form());
  assert.equal(result.error, true); assert.equal(result.requestId, requestId);
  assert.ok(!JSON.stringify(result).includes('SECRET'));
});
test('duplicates, cooldown and setup-required do not report a new completed deploy', async () => {
  for (const response of ['already_running', 'already_requested', 'cooldown', 'setup_required']) {
    const { api } = actions({ response });
    assert.equal((await api.startDeploy({}, form())).status, response);
  }
});
test('local development cannot execute processes or connect to production', async () => {
  if (process.env.NODE_ENV === 'production' && process.platform === 'linux') return;
  let called = false;
  const bridge = sourceLoader({ 'node:child_process': { execFile: () => { called = true; throw new Error('must not execute'); } } })('src/lib/deploy-control.ts');
  await assert.rejects(bridge.readDeployControl(), /DEPLOY_SERVER_ONLY/);
  await assert.rejects(bridge.startDeployControl({ site: deploySite, requestId, actorId }), /DEPLOY_SERVER_ONLY/);
  assert.equal(called, false);
});
