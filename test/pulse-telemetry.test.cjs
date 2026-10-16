'use strict';

/**
 * Pulse telemetry store and processor (docs/designs/team-performance.md, D15,
 * D16, eng review E1 and E4) against a real harness.db. better-sqlite3 is built
 * for Electron, so this file reruns itself under Electron's own Node
 * (ELECTRON_RUN_AS_NODE) and skips where no Electron binary is installed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

if (!process.env.PULSE_UNDER_ELECTRON) {
  let bin = null;
  try { bin = require('electron'); } catch { bin = null; }
  const ok = typeof bin === 'string' && fs.existsSync(bin);
  test('telemetry store and processor (run under Electron\'s Node)', { skip: ok ? false : 'no Electron binary' }, () => {
    const r = spawnSync(bin, ['--test', __filename], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PULSE_UNDER_ELECTRON: '1' },
      encoding: 'utf8', timeout: 300_000
    });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  });
  return;
}

const loadTs = require('./load-ts.cjs');
const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { app: { getPath: () => os.tmpdir() } } };
const { PersistStore } = loadTs('src/main/db.ts');
const { TelemetryStore } = loadTs('src/main/telemetryStore.ts');
const { TelemetryProcessor, RUN_IDLE_END_MS, RUN_CAP_MS } = loadTs('src/main/telemetryProcessor.ts');

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-pulse-'));
  const persist = new PersistStore(path.join(dir, 'harness.db'));
  persist.open();
  t.after(() => { persist.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  let now = new Date(2026, 9, 15, 9).getTime();
  const clock = { now: () => now, at: (ms) => { now = ms; }, add: (ms) => { now += ms; } };
  const store = new TelemetryStore(() => persist.database(), () => '/office', clock.now);
  const proc = new TelemetryProcessor(() => persist.database(), store, clock.now);
  return { persist, store, proc, clock };
}

test('the migration makes the tables once, and nothing but kind, time, value and small attributes is stored', (t) => {
  // Value: protects=the store shape and no text in telemetry; fails_when=a migration is edited or prompt text lands in a row; why_new=D16; seam=none; no_claim=a database made by an older build (user_version 1 upgrades here)
  const { persist, store } = setup(t);
  const db = persist.database();
  assert.equal(db.pragma('user_version', { simple: true }), 3);
  store.record({ agentId: 'pam', kind: 'tool', ts: 1, attrs: { tool: 'Write' } });
  store.flush();
  const row = db.prepare('SELECT * FROM telemetry_events').get();
  assert.deepEqual([row.office, row.agent_id, row.kind, row.attrs], ['/office', 'pam', 'tool', '{"tool":"Write"}']);
});

test('a run starts at the first turn after its mail lands and ends after 2 idle minutes; work makes it did-work', (t) => {
  // Value: protects=E1 run windows; fails_when=a run starts at dispatch or waits for a prompt equal to the run text, or ends at the first stop; why_new=eng E1; seam=none; no_claim=agent behavior inside a run (fixture points)
  const { store, proc, clock, persist } = setup(t);
  const t0 = clock.now();
  store.record({ agentId: 'toby', kind: 'prompt', ts: t0 - 60_000 }); // a turn before the run: ignored
  store.record({ agentId: 'toby', kind: 'run-dispatch', ts: t0, attrs: { mission: 'm1' } });
  store.record({ agentId: 'toby', kind: 'prompt', ts: t0 + 30_000 }); // the wake turn: the run starts
  store.record({ agentId: 'toby', kind: 'cost', ts: t0 + 40_000, value: 0.5, attrs: { s: 's1', tokens: 100 } });
  store.record({ agentId: 'toby', kind: 'tool', ts: t0 + 50_000, attrs: { tool: 'Write' } });
  store.record({ agentId: 'toby', kind: 'stop', ts: t0 + 60_000 });
  clock.at(t0 + 60_000 + RUN_IDLE_END_MS + 1);
  proc.tick('/office');
  const run = persist.database().prepare('SELECT * FROM telemetry_runs').get();
  assert.equal(run.start, t0 + 30_000);
  assert.equal(run.end, t0 + 60_000);
  assert.equal(run.outcome, 'did-work');
  assert.equal(run.work, 1);
  assert.ok(Math.abs(run.usd - 0.5) < 1e-9);
  const day = proc.days('/office', '2026-01-01').find((d) => d.agentId === 'toby');
  assert.equal(day.checks, 1);
  assert.ok(Math.abs(day.runUsd - 0.5) < 1e-9 && Math.abs(day.usd - 0.5) < 1e-9);
});

test('a run with nothing done is nothing to do; one that never stops ends at 60 minutes as unknown; back to back closes the first', (t) => {
  // Value: protects=E1 outcomes and caps; fails_when=an idle run counts as work, a stuck run stays open, or a second dispatch leaks the first; why_new=eng E1; seam=none; no_claim=none beyond protects
  const { store, proc, clock, persist } = setup(t);
  const t0 = clock.now();
  store.record({ agentId: 'toby', kind: 'run-dispatch', ts: t0, attrs: { mission: 'm1' } });
  store.record({ agentId: 'toby', kind: 'prompt', ts: t0 + 1000 });
  store.record({ agentId: 'toby', kind: 'stop', ts: t0 + 2000 });
  store.record({ agentId: 'pam', kind: 'run-dispatch', ts: t0, attrs: { mission: 'm2' } });
  store.record({ agentId: 'pam', kind: 'prompt', ts: t0 + 1000 });
  clock.at(t0 + 1000 + RUN_CAP_MS + 1); // the cap counts from the run's start
  proc.tick('/office');
  const runs = persist.database().prepare('SELECT agent_id, outcome FROM telemetry_runs ORDER BY agent_id').all();
  assert.deepEqual(runs.map((r) => [r.agent_id, r.outcome]), [['pam', 'unknown'], ['toby', 'nothing']]);
  store.record({ agentId: 'kelly', kind: 'run-dispatch', ts: clock.now(), attrs: { mission: 'm3' } });
  store.record({ agentId: 'kelly', kind: 'run-dispatch', ts: clock.now() + 1, attrs: { mission: 'm3' } });
  proc.tick('/office');
  assert.equal(persist.database().prepare("SELECT COUNT(*) AS n FROM telemetry_runs WHERE agent_id = 'kelly' AND end IS NULL").get().n, 1);
});

test('cost counts a restart whole, repeats are not stored, and a crash mid batch never counts twice', (t) => {
  // Value: protects=exact totals; fails_when=a restart is lost, a repeat is stored, or a replayed batch double counts; why_new=D16 processor; seam=none; no_claim=power loss during fsync
  const { store, proc, persist } = setup(t);
  store.cost('pam', 's1', 1.0, 10, 'claude-opus-5-5', 1000);
  store.cost('pam', 's1', 1.0, 10, 'claude-opus-5-5', 2000); // repeat: dropped
  store.cost('pam', 's1', 1.5, 15, 'claude-opus-5-5', 3000);
  store.cost('pam', 's1', 0.25, 3, 'claude-opus-5-5', 4000); // app restarted
  store.flush();
  assert.equal(persist.database().prepare("SELECT COUNT(*) AS n FROM telemetry_events WHERE kind = 'cost'").get().n, 3);
  const db = persist.database();
  const orig = db.transaction.bind(db);
  let boom = true;
  db.transaction = (fn) => orig((...a) => { const r = fn(...a); if (boom) { boom = false; throw new Error('crash'); } return r; });
  assert.throws(() => proc.tick('/office'));
  db.transaction = orig;
  proc.tick('/office');
  proc.tick('/office');
  const usd = proc.days('/office', '1900-01-01').reduce((s, d) => s + d.usd, 0);
  assert.ok(Math.abs(usd - 1.75) < 1e-9, `got ${usd}`);
});

test('a failed write is counted for its day and the day is reported; records keep the presence and card facts', (t) => {
  // Value: protects=D15 and E2, E3, E4 sources; fails_when=a failed write is silent, or reopen, held time or away share is lost; why_new=D15; seam=none; no_claim=disk full on a real disk (closed handle stands in)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-pulse-fail-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let open = false;
  const persist = new PersistStore(path.join(dir, 'harness.db'));
  persist.open();
  t.after(() => persist.close());
  const when = new Date(2026, 9, 14, 10).getTime();
  const store = new TelemetryStore(() => (open ? persist.database() : null), () => '/office', () => when);
  store.record({ agentId: 'pam', kind: 'email', ts: when, value: 3 });
  store.flush();
  assert.deepEqual(store.failureDays('/office'), ['2026-10-14'], 'pending failure is reported');
  open = true;
  store.flush();
  assert.deepEqual(store.failureDays('/office'), ['2026-10-14'], 'saved once the store works');

  const { store: s2, proc } = setup(t);
  const t0 = new Date(2026, 9, 15, 9).getTime();
  s2.presence(1900, false, t0);
  s2.tasks([{ id: 'c1', status: 'doing', assignee: 'nick', createdAt: new Date(t0).toISOString() }], t0);
  s2.tasks([{ id: 'c1', status: 'blocked', assignee: 'nick' }], t0 + 3600_000);
  s2.tasks([{ id: 'c1', status: 'done', assignee: 'nick' }], t0 + 3 * 3600_000);
  s2.record({ agentId: 'nick', kind: 'card-reopen', ts: t0 + 4 * 3600_000, attrs: { id: 'c1' } });
  s2.record({ agentId: 'nick', kind: 'email', ts: t0 + 4 * 3600_000, value: 2 });
  proc.tick('/office');
  const [card] = proc.cards('/office', 0);
  assert.equal(card.heldMs, 2 * 3600_000);
  assert.equal(card.reopened, true);
  assert.equal(card.doneAt, t0 + 3 * 3600_000);
  const day = proc.days('/office', '2026-01-01').find((d) => d.agentId === 'nick');
  assert.deepEqual([day.tasks, day.emails, day.awayPieces], [1, 2, 3], 'the owner was away for all of it');
});

const { PulseService } = loadTs('src/main/pulse.ts');

function service(t, opts = {}) {
  const env = setup(t);
  const t0 = new Date(2026, 9, 1, 9).getTime();
  env.clock.at(t0);
  // 14 runs over two weeks of Toby's check, 12 found nothing.
  for (let i = 0; i < 14; i++) {
    const at = t0 + i * 86_400_000;
    env.store.record({ agentId: 'toby', kind: 'run-dispatch', ts: at, attrs: { mission: 'm1' } });
    env.store.record({ agentId: 'toby', kind: 'prompt', ts: at + 1000 });
    if (i < 2) env.store.record({ agentId: 'toby', kind: 'message', ts: at + 1500 });
    env.store.record({ agentId: 'toby', kind: 'stop', ts: at + 2000 });
    env.clock.at(at + 2000 + 3 * 60_000);
    env.proc.tick('/office');
  }
  env.clock.at(t0 + 15 * 86_400_000);
  let missions = [{ id: 'm1', label: 'Benefits inbox check', to: 'toby', intervalMs: 2 * 3600_000, body: '', enabled: true, kind: 'dispatch' }];
  const models = opts.models ?? [{ agentId: 'toby', provider: 'claude', model: 'claude-opus-5-5' }];
  const svc = new PulseService({
    db: () => env.persist.database(), store: env.store, processor: env.proc, office: () => '/office',
    members: () => [{ id: 'toby', isGod: false }, { id: 'god', isGod: true }], godId: () => 'god', tasks: () => [],
    missions: () => missions, models: () => models, ladder: () => [], priceOf: () => undefined,
    applyMissions: (change) => { const next = change(missions); if (!next) return { ok: false, error: 'not found' }; missions = next; return { ok: true }; },
    billing: () => 'account', memory: () => ({ notes: [], procedures: {} }), now: env.clock.now
  });
  return { ...env, svc, missions: () => missions, setMissions: (m) => { missions = m; } };
}

test('Apply changes a schedule only if it still is what the advice saw; Undo restores it; Not now hides it', (t) => {
  // Value: protects=D10 apply and undo, compare and set, D13 dismiss; fails_when=a stale or double click overwrites a schedule, Undo restores the wrong value, or a dismissed card stays; why_new=new apply path; seam=none; no_claim=the Schedules UI refresh (missions:updated is sent by applyMissions)
  const { svc, missions, setMissions } = service(t);
  const view = svc.snapshot('last-week');
  assert.equal(view.available, true);
  const [advice] = view.advice;
  assert.equal(advice.kind, 'run-less');
  assert.deepEqual(svc.apply(advice.id, { kind: 'interval', fromMs: 1, toMs: 2 }), { ok: false, error: 'stale' }, 'not what the owner saw');
  const r = svc.apply(advice.id, advice.change);
  assert.equal(r.ok, true);
  assert.equal(missions()[0].intervalMs, 4 * 3600_000);
  assert.deepEqual(svc.apply(advice.id, advice.change), { ok: false, error: 'stale' }, 'a second click finds it changed');
  assert.equal(svc.snapshot('this-week').advice.length, 0, 'an applied suggestion waits for new evidence');
  assert.equal(svc.snapshot('this-week').saved.state, 'measuring');
  assert.equal(svc.undo(r.appliedId).ok, true);
  assert.equal(missions()[0].intervalMs, 2 * 3600_000);
  assert.deepEqual(svc.undo(r.appliedId), { ok: false, error: 'stale' }, 'undone once');
  setMissions([{ ...missions()[0], intervalMs: 3 * 3600_000 }]);
  assert.equal(svc.apply(advice.id, advice.change).ok, false, 'changed elsewhere: refused');
  setMissions([{ ...missions()[0], intervalMs: 2 * 3600_000 }]);
  assert.equal(svc.dismiss(advice.id), true);
  assert.equal(svc.snapshot('this-week').advice.length, 0);
});

test('a model suggestion is checked here and made by the roster; the owner\'s store is never written from main', (t) => {
  // Value: protects=model changes only through the owner's click and the renderer roster; fails_when=main writes a model or applies a stale one; why_new=eng correction 3; seam=none; no_claim=the renderer side (component test)
  const { svc } = service(t);
  const fake = { id: 'cheaper-model:toby', kind: 'cheaper-model', agentId: 'toby', change: { kind: 'model', from: 'claude-opus-5-5', to: 'claude-sonnet-5', toLabel: 'Sonnet 5' }, evidence: {}, savesPerWeek: null, band: 1 };
  svc.allAdvice = () => [fake];
  assert.deepEqual(svc.apply(fake.id, fake.change), { ok: true, kind: 'model', agentId: 'toby', to: 'claude-sonnet-5', from: 'claude-opus-5-5' });
  const id = svc.modelApplied(fake.id, 'toby', 'claude-opus-5-5', 'claude-sonnet-5');
  assert.ok(id > 0);
  assert.deepEqual(svc.undo(id), { ok: true, kind: 'model', agentId: 'toby', to: 'claude-opus-5-5' });
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/main/index.ts'), 'utf8');
  assert.equal((src.match(/pulse\.apply\(/g) || []).length, 1, 'only the pulse:apply handler applies advice');
});

// ─── proposal 3: Team at work, Kept safe, backfill ───────────────────────

const { runBackfill, backfilled } = loadTs('src/main/pulseBackfill.ts');

test('working time runs from each request to its stop, capped; a request with no stop ends at the next one', (t) => {
  // Value: protects=Team at work's hours and requests; fails_when=a turn is counted from dispatch, is not capped at an hour, or an unstopped turn is lost or counted twice; why_new=owner proposal 3; seam=none; no_claim=Claude Code's own Stop timing
  const { store, proc, clock, persist } = setup(t);
  const t0 = clock.now();
  store.record({ agentId: 'pam', kind: 'prompt', ts: t0 });
  store.record({ agentId: 'pam', kind: 'tool', ts: t0 + 60_000, attrs: { tool: 'Read' } });
  store.record({ agentId: 'pam', kind: 'stop', ts: t0 + 120_000 });                 // 2 minutes
  store.record({ agentId: 'pam', kind: 'prompt', ts: t0 + 200_000 });
  store.record({ agentId: 'pam', kind: 'tool', ts: t0 + 230_000, attrs: { tool: 'Read' } });
  store.record({ agentId: 'pam', kind: 'prompt', ts: t0 + 300_000 });              // no stop before: ends at its last activity (30 s)
  store.record({ agentId: 'pam', kind: 'stop', ts: t0 + 300_000 + 3 * 3600_000 }); // left open: capped at an hour
  proc.tick('/office');
  const d = persist.database().prepare('SELECT busy_ms, turns FROM telemetry_daily WHERE agent_id = ?').get('pam');
  assert.equal(d.turns, 3);
  assert.equal(d.busy_ms, 120_000 + 30_000 + 3600_000);
});

test('points from the past count for their day but never touch open runs or presence, and never start recommendations', (t) => {
  // Value: protects=backfill isolation; fails_when=a backfilled email lands in a live run, counts as work while the owner is away, or moves the live start date; why_new=owner proposal 3 backfill; seam=none; no_claim=none beyond protects
  const { store, proc, clock, persist } = setup(t);
  const t0 = clock.now();
  store.record({ agentId: null, kind: 'presence', ts: t0 - 10, value: 1 });  // the owner is away now
  store.record({ agentId: 'pam', kind: 'run-dispatch', ts: t0, attrs: { mission: 'm1' } });
  store.record({ agentId: 'pam', kind: 'prompt', ts: t0 + 1000 });
  store.record({ agentId: 'pam', kind: 'email', ts: t0 - 5 * 86_400_000, value: 4, attrs: { bf: 1 } });
  store.record({ agentId: 'pam', kind: 'busy', ts: t0 - 5 * 86_400_000, value: 600_000, attrs: { bf: 1 } });
  proc.tick('/office');
  const db = persist.database();
  const past = db.prepare('SELECT * FROM telemetry_daily WHERE agent_id = ? AND day < ?').get('pam', new Date(t0).toISOString().slice(0, 10));
  assert.equal(past.emails, 4);
  assert.equal(past.away_pieces, 0, 'a past email is not work while the owner is away');
  assert.equal(past.busy_ms, 600_000);
  assert.equal(db.prepare('SELECT work FROM telemetry_runs').get().work, 0, 'nor work in today\'s run');
  assert.notEqual(proc.firstDay('/office'), proc.firstDay('/office', true), 'live start ignores the past');
});

test('trust layer decisions and refusals become Kept safe counters', (t) => {
  // Value: protects=Kept safe tiles; fails_when=a failed check counts as stopped, a flag is lost, or an unknown gate is counted; why_new=owner proposal 3; seam=none; no_claim=the trust layer's own judgement
  const { store, proc, clock } = setup(t);
  const ts = clock.now();
  for (const a of [{ way: 'in', decision: 'pass' }, { way: 'in', decision: 'clean' }, { way: 'in', decision: 'deny', by: 'model' }, { way: 'in', decision: 'deny', by: 'no-answer' },
    { way: 'out', decision: 'clean', flagged: true }, { way: 'out', decision: 'pass', flagged: false }, { way: 'out', decision: 'deny', by: 'unreadable' }]) store.record({ agentId: null, kind: 'trust', ts, attrs: a });
  store.record({ agentId: 'pam', kind: 'refused', ts, attrs: { gate: 'quickbooks' } });
  store.record({ agentId: 'pam', kind: 'refused', ts, attrs: { gate: 'nonsense' } });
  proc.tick('/office');
  const { keptSafe } = loadTs('src/shared/pulseSafety.ts');
  const day = new Date(ts); const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  assert.deepEqual(keptSafe(proc.safetyRows('/office', key, key)), {
    toInternet: { pass: 1, clean: 1, stop: 1 }, webAnswers: { pass: 1, clean: 1, flagged: 1 }, held: 2, rules: { quickbooks: 1 }, any: true
  });
});

test('the backfill reads the office log, sessions and cost ledger once, before the first live point', async (t) => {
  // Value: protects=a fresh Pulse not starting at zero; fails_when=the backfill reads past the live start, counts twice on a second start, misses a session's working time or a refused step, or loses a member's cost across an app restart; why_new=owner proposal 3; seam=temp hive, projects root and db; no_claim=real transcripts' every line shape
  const { persist, store, proc, clock } = setup(t);
  const live = clock.now();
  store.record({ agentId: 'pam', kind: 'prompt', ts: live });
  store.flush();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md-bf-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const hive = path.join(root, 'hive'); const projects = path.join(root, 'projects', '-x');
  fs.mkdirSync(hive, { recursive: true }); fs.mkdirSync(projects, { recursive: true });
  const day = 86_400_000; const past = live - 2 * day;
  fs.writeFileSync(path.join(hive, 'log.jsonl'), [
    { ts: past - 50 * day, kind: 'session', agentId: 'pam', sessionId: 'S1' },
    { ts: past, kind: 'mail-organize', agentId: 'pam', ids: ['a', 'b', 'c'] },
    { ts: past, kind: 'mail-sent', agentId: 'dwight' },
    { ts: past, kind: 'trust-layer', way: 'out', decision: 'clean', flagged: false },
    { ts: live + 1000, kind: 'mail-sent', agentId: 'dwight' },          // after the live start: not read
    { ts: past - 90 * day, kind: 'mail-sent', agentId: 'dwight' }       // too old: not read
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const iso = (ms) => new Date(ms).toISOString();
  fs.writeFileSync(path.join(projects, 'S1.jsonl'), [
    { type: 'user', timestamp: iso(past), message: { content: 'sort the inbox' } },
    { type: 'assistant', timestamp: iso(past + 60_000), message: { content: [{ type: 'tool_use' }] } },
    { type: 'user', timestamp: iso(past + 90_000), message: { content: [{ type: 'tool_result', tool_use_id: 'u1', content: 'PreToolUse:mcp__claude_ai_Intuit_QuickBooks__report hook error: The owner has not given you QuickBooks.' }] } },
    { type: 'assistant', timestamp: iso(past + 300_000), message: { content: [{ type: 'text', text: 'done' }] } }
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(path.join(hive, 'cost-ledger.jsonl'), [
    { agent_id: 'pam', session_id: 'S1', ts: past - 60 * day, usd: 1 },  // before the window: only a starting point
    { agent_id: 'pam', session_id: 'S1', ts: past, usd: 3 },            // +2 in the window
    { agent_id: 'pam', session_id: 'S1', ts: past + 1000, usd: 0.5 },   // app restart: +0.5
    { agent_id: 'pam', session_id: 'S1', ts: live + 1000, usd: 9 }      // after the live start: not read
  ].map((e) => JSON.stringify(e)).join('\n') + '\n');
  const deps = { db: persist.database(), office: '/office', hiveRoot: hive, projectsRoot: path.join(root, 'projects'), members: new Set(['pam', 'dwight']), now: live + 5000 };
  const n = await runBackfill(deps);
  assert.ok(n > 0);
  assert.equal(backfilled(persist.database(), '/office'), true);
  assert.equal(await runBackfill(deps), 0, 'once per office');
  proc.tick('/office');
  const pastDay = proc.days('/office', '2000-01-01').filter((d) => d.day !== proc.firstDay('/office', true));
  const pam = pastDay.find((d) => d.agentId === 'pam');
  assert.equal(pam.emails, 3);
  assert.equal(pam.busyMs, 300_000);
  assert.equal(pam.turns, 1);
  assert.ok(Math.abs(pam.usd - 2.5) < 1e-9, `value ${pam.usd}`);
  assert.equal(pastDay.find((d) => d.agentId === 'dwight').sent, 1);
  const { keptSafe } = loadTs('src/shared/pulseSafety.ts');
  const ks = keptSafe(proc.safetyRows('/office', '2000-01-01', '2999-01-01'));
  assert.deepEqual([ks.webAnswers.clean, ks.rules.quickbooks], [1, 1]);
});
