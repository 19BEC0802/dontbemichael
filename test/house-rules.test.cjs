'use strict';

/**
 * House rules (owner, 2026-09-25): no agent, Michael included, makes up
 * information. They ride the system prompt every agent gets, identical for all.
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

const { HiveManager, HOUSE_RULES } = loadTs('src/main/hive.ts');

const promptOf = (inj) => inj.args[inj.args.indexOf('--append-system-prompt') + 1];

test('Michael and every team member get the same house rules', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-rules-'));
  const hive = new HiveManager(() => home);
  const god = promptOf(await hive.ensureAgent({ id: 'god', name: 'Michael', provider: 'claude', cwd: home, isGod: true }));
  const oscar = promptOf(await hive.ensureAgent({ id: 'oscar', name: 'Oscar', provider: 'claude', cwd: home, role: 'Finance' }));
  assert.ok(god.includes(HOUSE_RULES), 'Michael');
  assert.ok(oscar.includes(HOUSE_RULES), 'a team member');
});

test('the rules cover sources, not knowing, estimates, honest reports and real people', () => {
  assert.match(HOUSE_RULES, /State only facts you can trace to a source/);
  assert.match(HOUSE_RULES, /When you don't know or can't find something, say so/);
  assert.match(HOUSE_RULES, /Mark estimates and assumptions/);
  assert.match(HOUSE_RULES, /Call work finished only when it is/);
  assert.match(HOUSE_RULES, /Make up an example only when the owner asks for a sample/);
});

// 2026-10-02: Pam's work style said delete handled mail; her mail tools cannot,
// so she read a cold pitch, left it unread and said nothing about it.
test('every agent reports what its tools cannot do instead of skipping it, and the mail tools say their limits', () => {
  // Value: protects=an instruction the tools cannot carry out reaches Michael or the owner instead of vanishing; fails_when=rule 6 is dropped or the mail tools stop naming what they cannot do; why_new=no rule covered a missing tool; seam=none
  assert.match(HOUSE_RULES, /6\. When your instructions or a request ask for something your tools cannot do/);
  assert.match(HOUSE_RULES, /A team member tells Michael; Michael tells the owner on the Ask me board\./);
  assert.match(HOUSE_RULES, /Do not work around a missing or refused tool\./);
  const mail = fs.readFileSync(path.resolve(__dirname, '..', 'resources/md-mail-mcp.cjs'), 'utf8');
  assert.match(mail, /They never delete mail: if you are asked to delete, report it \(house rule 6\)\./);
});

// 2026-10-11: an IT report for the owner opened with a Sources list of tool
// names, mail folders, a settings file and UTC; the owner could not use it.
test('anything the owner reads, files included, is in plain business words', () => {
  // Value: protects=owner reports and files carry no tool, folder or method talk; fails_when=rule 7 is dropped or rule 1 asks for file names again; why_new=no rule covered files the owner opens; seam=none
  assert.match(HOUSE_RULES, /7\. Write anything the owner reads, reports and files included, in plain business words/);
  assert.match(HOUSE_RULES, /Leave out tool names, folder and file names, settings files, message ids, time zones and how you went about the work/);
  assert.match(HOUSE_RULES, /name the source in words the owner knows/);
  assert.doesNotMatch(HOUSE_RULES, /\(a file name, a link/);
});

test('written calmly: no dashes, no shouting, no dates that would break the prompt cache', () => {
  assert.doesNotMatch(HOUSE_RULES, /[–—]/);
  assert.doesNotMatch(HOUSE_RULES.replace(/^HOUSE RULES\./, ''), /\b(MUST|NEVER|ALWAYS|CRITICAL)\b/);
  assert.doesNotMatch(HOUSE_RULES, /\b20\d\d\b/);
});

// 2026-10-11: Michael parked a card in Waiting as "Waiting on Dwight, sends
// Mon 12 Oct 13:00 to 15:00 UTC": Dwight's own step at a set time.
test('a card never waits on its own person; its own step at a set time is todo', () => {
  // Value: protects=the board says who else holds a card, and parked own work sits in To do with the time; fails_when=rule 8 or the board wording drops it; why_new=waiting had no word for the card's own person; seam=none
  assert.match(HOUSE_RULES, /8\. On the task board, "waiting" names who else a card waits on, never the card's own person\./);
  assert.match(HOUSE_RULES, /the card is "todo", with that time in its notes in the owner's local time\./);
  const hive = fs.readFileSync(path.resolve(__dirname, '..', 'src/main/hive.ts'), 'utf8');
  assert.equal((hive.match(/never the card\\'s own person/g) || []).length, 4, 'rule 8, Michael\'s two board texts and the protocol');
});

// 2026-10-11: Nick resumed his conversation with rule 7 in his instructions,
// was asked to extend his earlier report, and copied its Sources list anyway.
test('a resumed agent is told the house rules that changed, once; a fresh one is not', async (t) => {
  // Value: protects=a new or reworded rule reaches agents that resume an old conversation; fails_when=the note never sends, repeats every start, or goes to a fresh conversation; why_new=rules only rode the start instructions; seam=none
  const N = loadTs('src/shared/houseRulesNotice.ts');
  assert.match(HOUSE_RULES, /When you extend or update an earlier file, rewrite its parts that break this rule\./);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'md-rules-notice-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const hive = new HiveManager(() => home);
  await hive.ensureAgent({ id: 'nick', name: 'Nick', provider: 'claude', cwd: home, role: 'IT' });
  await hive.ensureAgent({ id: 'oscar', name: 'Oscar', provider: 'claude', cwd: home, role: 'Finance' });
  const inbox = (id) => fs.readdirSync(path.join(hive.root(), 'agents', id, 'inbox')).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(hive.root(), 'agents', id, 'inbox', f), 'utf8')))
    .filter((m) => m.subject === N.HOUSE_RULES_CHANGED_SUBJECT);
  const all = N.houseRuleLines(HOUSE_RULES);
  assert.equal(all.length, 8);

  assert.deepEqual(hive.tellHouseRules('oscar', false), [], 'a fresh conversation reads them in its instructions');
  assert.equal(inbox('oscar').length, 0);
  assert.deepEqual(hive.tellHouseRules('nick', true), all, 'a resumed one with no record hears every rule once');
  assert.equal(inbox('nick').length, 1);
  assert.match(inbox('nick')[0].body, /including a file you extend or update/);
  assert.doesNotMatch(inbox('nick')[0].body, /[–—]/);
  assert.deepEqual(hive.tellHouseRules('nick', true), [], 'not again while nothing changed');
  assert.equal(inbox('nick').length, 1);

  // A rule reworded since Nick last started: only that one is told.
  const seenFile = path.join(home, 'private', 'house-rules-seen.json');
  const seen = JSON.parse(fs.readFileSync(seenFile, 'utf8'));
  seen.nick = seen.nick.filter((k) => k !== N.ruleKey(all[6]));
  fs.writeFileSync(seenFile, JSON.stringify(seen));
  assert.deepEqual(hive.tellHouseRules('nick', true), [all[6]]);
  assert.equal(inbox('nick').length, 2);
  assert.deepEqual(hive.tellHouseRules('oscar', true), [], 'oscar was recorded at his fresh start');
});
