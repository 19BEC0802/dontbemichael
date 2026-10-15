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
  assert.equal(db.pragma('user_version', { simple: true }), 2);
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
