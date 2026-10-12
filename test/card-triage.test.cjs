'use strict';

/**
 * Cards filed by team members wait in triage for Michael (owner, 2026-10-11,
 * docs/designs/card-lifecycle.md section 10): the owner never sees them, and
 * Michael is shown them each turn until he releases each to Blocked or Waiting.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const electron = require.resolve('electron');
require.cache[electron] = {
  id: electron, filename: electron, loaded: true,
  exports: { Notification: class { show() {} static isSupported() { return false; } } }
};
const { HiveManager } = loadTs('src/main/hive.ts');
const { ownerLedger } = loadTs('src/shared/taskLedger.ts');
const { asksToTidy, stuckCardsContext } = loadTs('src/shared/ownerRequests.ts');
const { answerMessages } = loadTs('src/shared/askMeRouting.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const card = (id, extra = {}) => ({ id, title: id, status: 'todo', dependsOn: [], priority: 3, createdAt: '2026-10-11T00:00:00Z', ...extra });

test('the owner never sees a card in triage: board, Ask me, floor and voice all read the owner ledger', () => {
  // Value: protects=a team member's raw card reaches the owner only after Michael releases it; fails_when=any owner read path returns triage cards; why_new=triage is new; seam=ownerLedger plus the three main read paths
  const raw = { tasks: [card('a', { status: 'triage', humanQA: [{ q: '1. What? 2. When?', raisedBy: 'nick' }] }), card('b', { status: 'blocked' })] };
  assert.deepEqual(ownerLedger(raw).tasks.map((t) => t.id), ['b']);
  assert.equal(ownerLedger(null), null);
  const main = read('src/main/index.ts');
  assert.match(main, /ipcMain\.handle\('hive:tasks', \(\) => ownerLedger\(hive\.tasks\(\)\)\);/);
  assert.match(main, /  hiveTasks: \(\) => ownerLedger\(hive\.tasks\(\)\),/, 'voice tools');
  assert.match(main, /  tasks: \(\) => ownerLedger\(hive\.tasks\(\)\),\n  ptys:/, 'voice floor updates');
});

test('Michael is shown every triage card first each turn, and the owner cannot move one', async (t) => {
  // Value: protects=a filed card never sits unseen, and only Michael releases it; fails_when=triage drops out of the tidy list or the owner can move it; why_new=triage is new; seam=asksToTidy and ownerMoveTask
  const stuck = asksToTidy([card('a', { status: 'triage' }), card('b', { status: 'triage', humanQA: [{ q: 'x?' }] }), card('c', { status: 'blocked', humanQA: [{ q: 'y?' }] })]);
  assert.deepEqual(stuck.map((s) => [s.id, s.issue]), [['a', 'triage'], ['b', 'triage']]);
  const text = stuckCardsContext([...stuck, { id: 'z', title: 'z' }]);
  assert.ok(text.startsWith('CARDS TO TRIAGE.'), 'triage leads the list');
  assert.match(text, /Then release it: "blocked" when it asks the owner, "waiting" with "waitingOn" when it waits on someone else\./);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-triage-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  hive.writeTasks([card('t1', { status: 'triage' })]);
  assert.equal(hive.ownerMoveTask('t1', 'doing'), false);
  assert.equal(hive.tasks().tasks[0].status, 'triage');
});

test('an answer that leaves part of a bundle open comes back as a new ask on the same card', () => {
  // Value: protects=no question of a numbered ask is lost when the owner answers only some; fails_when=the relay drops the check; why_new=owner, 2026-10-11; seam=answerMessages
  const [m] = answerMessages({ id: 'c1', title: 'T' }, { q: '1. A? 2. B?', a: 'A is yes', raisedBy: 'god' }, { god: 'Michael' });
  assert.match(m.body, /Check each question of the ask against the answer\. If any is left unanswered, first add one new ask on this card holding only those questions and keep the card Blocked, so none is lost\./);
});
