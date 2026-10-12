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

test('a Done card an agent reopens goes back to Done and Michael is told; the owner reopens with a reason', async (t) => {
  // Value: protects=Done is final except the owner's correction; fails_when=an agent's direct write keeps a reopened card, or an app move out of Done is undone; why_new=owner, 2026-10-11 (Erin reopened a done card); seam=the fleet tick (refreshOwnerRequests)
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-done-guard-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  hive.writeTasks([card('d1', { status: 'done', result: 'ok' }), card('d2', { status: 'done', result: 'ok' })]);
  hive.refreshOwnerRequests(); // seeds what was Done
  // An agent edits the file directly, as agents do.
  const file = path.join(hive.root(), 'tasks.json');
  const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
  ledger.tasks[0].status = 'todo';
  fs.writeFileSync(file, JSON.stringify(ledger));
  hive.refreshOwnerRequests();
  assert.equal(hive.tasks().tasks[0].status, 'done', 'put back');
  const inbox = path.join(hive.root(), 'agents', 'god', 'inbox');
  const notes = fs.readdirSync(inbox).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(inbox, f), 'utf8')));
  const back = notes.find((m) => m.subject === 'DONE CARD PUT BACK: card d1');
  assert.ok(back, 'Michael is told');
  assert.match(back.body, /only the owner takes a card out of Done\. If the work needs more, file a new card for it/);
  // The owner's own reopen stands on the next tick.
  assert.equal(hive.ownerMoveTask('d2', 'todo', 'Marked done by mistake'), true);
  hive.refreshOwnerRequests();
  assert.equal(hive.tasks().tasks[1].status, 'todo');
  // Voice cannot reopen; it points to the board.
  assert.match(read('src/main/realtimeActions.ts'), /is done\. To reopen it, open the card on the board and give a short reason\./);
  const kanban = read('src/renderer/src/components/TasksKanban.tsx');
  assert.match(kanban, /if \(task\.status === 'done' && next !== 'done'\) \{ setReopening\(true\); return; \}/);
  assert.match(kanban, /disabled=\{!why\.trim\(\)\} onClick=\{\(\) => \{ onReopen\(why\.trim\(\)\);/);
  // Value (extension): protects=the owner's reason travels from the card to the main process; fails_when=the overlay, preload or IPC drops the reason, so every reopen is refused; why_new=only the two ends were checked; seam=source pins (no DOM or IPC harness)
  assert.match(read('src/renderer/src/components/TaskDetailOverlay.tsx'), /await window\.cth\.hiveMoveTask\(task\.id, 'todo', reason\);/);
  assert.match(read('src/renderer/src/components/TaskDetailOverlay.tsx'), /onReopen=\{\(reason\) => void reopen\(reason\)\}/);
  assert.match(read('src/preload/index.ts'), /hiveMoveTask: \(id: string, status: HiveTask\['status'\], reason\?: string\)[^\n]*\n\s*ipcRenderer\.invoke\('hive:moveTask', id, status, reason\)/);
  const main = read('src/main/index.ts');
  assert.match(main, /ipcMain\.handle\('hive:moveTask', \(_evt, id: unknown, status: unknown, reason: unknown\) => \{/);
  assert.match(main, /hive\.ownerMoveTask\(id, status as HiveTask\['status'\], typeof reason === 'string' \? reason : undefined\)/);
});

test('the Done guard covers cards that end after the first tick, and the app\'s own reopen stands', async (t) => {
  // Value: protects=a card done after launch stays done when an agent reopens it; fails_when=writeTasks or the tick stops recording newly done cards, or patchTask's own reopen is undone; why_new=only cards done at the first tick were checked; seam=the fleet tick (refreshOwnerRequests)
  // no_claim=agents editing tasks.json are simulated by direct file writes in a temp hive; Michael's handling of the note is not checked
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-done-later-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  hive.writeTasks([card('a'), card('b'), card('m', { status: 'done', result: 'connected again' })]);
  hive.refreshOwnerRequests(); // seeds: only m is Done
  const file = path.join(hive.root(), 'tasks.json');
  const agentSets = (id, status) => {
    const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
    ledger.tasks.find((c) => c.id === id).status = status;
    fs.writeFileSync(file, JSON.stringify(ledger));
  };
  const statusOf = (id) => hive.tasks().tasks.find((c) => c.id === id).status;

  // An agent finishes b by writing the file; the next tick sees it Done.
  agentSets('b', 'done');
  hive.refreshOwnerRequests();
  agentSets('b', 'todo');
  hive.refreshOwnerRequests();
  assert.equal(statusOf('b'), 'done', 'a card an agent marked done, then reopened, goes back');

  // The owner closes a; an agent reopens it before any tick runs.
  assert.equal(hive.ownerCloseTask('a', 'Not needed'), true);
  agentSets('a', 'doing');
  hive.refreshOwnerRequests();
  assert.equal(statusOf('a'), 'done', 'a card the app marked done is guarded at once');

  // The app moves a Done card on itself (a mailbox that broke again).
  assert.equal(hive.patchTask('m', { status: 'blocked' }), true);
  hive.refreshOwnerRequests();
  assert.equal(statusOf('m'), 'blocked', 'the app\'s own reopen stands');

  const inbox = path.join(hive.root(), 'agents', 'god', 'inbox');
  const subjects = fs.readdirSync(inbox).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(inbox, f), 'utf8')).subject);
  assert.deepEqual(subjects.filter((s) => s.startsWith('DONE CARD PUT BACK')).sort(), ['DONE CARD PUT BACK: card a', 'DONE CARD PUT BACK: card b']);
});

test('the owner cannot close a card still in triage, and the owner search and webhook never show triage', async (t) => {
  // Value: protects=a triage card stays Michael's until he releases it, on every owner path; fails_when=close lacks the triage guard, search reads raw tasks.json, or the webhook returns "triage"; why_new=review 2026-10-12 found those three paths; seam=none
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-triage-close-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true });
  hive.writeTasks([card('t1', { status: 'triage' })]);
  assert.equal(hive.ownerCloseTask('t1', 'Not needed'), false);
  assert.equal(hive.tasks().tasks[0].status, 'triage');
  const main = read('src/main/index.ts');
  assert.match(main, /const text = source === 'tasks\.json' \? JSON\.stringify\(ownerLedger\(hive\.tasks\(\)\), null, 2\) : readFileSync\(path, 'utf8'\);/);
  assert.match(main, /return \{ status: t\.status === 'triage' \? 'todo' : t\.status, title: t\.title, result: t\.result \};/);
});
