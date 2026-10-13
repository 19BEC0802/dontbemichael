'use strict';

/**
 * Only Research uses the internet (issue #230, docs/designs/research-agent-privacy.md):
 * the hook refuses web pages and search to everyone else, Michael included;
 * every other team member's shell reaches no host; Research is walled off from
 * the office's folders and nobody else writes into its own.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const W = loadTs('src/shared/webAccess.ts');
const F = loadTs('src/shared/folderAccess.ts');
const R = loadTs('src/shared/research.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const P = (p) => path.resolve(p);

test('web pages and search are Research\'s alone', () => {
  // Value: protects=no member or Michael sends office data to a website; fails_when=anyone but Research passes the gate; why_new=owner direction 2026-10-13; seam=none
  for (const tool of ['WebFetch', 'WebSearch']) {
    assert.deepEqual(W.webAccess(true, true, tool), { ok: true });
    assert.deepEqual(W.webAccess(false, true, tool), { ok: false, reason: R.REFUSAL_WEB_TOOL });
    assert.deepEqual(W.webAccess(false, false, tool), { ok: false, reason: R.REFUSAL_WEB_TOOL_OFF });
  }
  assert.deepEqual(W.webAccess(false, true, 'Read'), { ok: true });
  assert.doesNotMatch(R.REFUSAL_WEB_TOOL + R.REFUSAL_WEB_TOOL_OFF, /[–—]/);
});

test('every team member of a business office gets an empty strict network list', () => {
  // Value: protects=curl and scripts reach no host from a member's shell on a Mac, while other offices keep the network; fails_when=the list is absent, not strict, or set outside a business office; why_new=new feature, ship review D3; seam=none
  assert.deepEqual(W.sandboxNetwork(false), { allowedDomains: [], strictAllowlist: true });
  assert.equal(W.sandboxNetwork(true), undefined, 'Michael runs outside the sandbox');
  const main = read('src/main/index.ts');
  assert.match(main, /network: isBusinessOffice\(\) \? sandboxNetwork\(!!opts\.hive\.isGod\) : undefined/);
  // Research's commands get no keys or tokens (red team pass 2).
  assert.match(main, /if \(isResearch\) opts\.env = \{ \.\.\.\(opts\.env \?\? \{\}\), CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1' \};/);
});

test('the hook gate covers Michael and decides Research by the app, not a file', () => {
  // Value: protects=Michael is gated too and no agent-written flag opens the web; fails_when=the gate skips Michael or reads isResearch from the registry; why_new=owner answer 2026-10-13, ship review D2.7; seam=none
  const hooks = read('src/main/hooks.ts');
  assert.match(hooks, /if \(event === 'PreToolUse' && agentId && WEB_TOOLS\.has\(p\.tool_name \?\? ''\)\) \{/);
  assert.match(hooks, /webAccess\(agentId === RESEARCH_ID && on, on, p\.tool_name \?\? ''\)/);
  assert.doesNotMatch(hooks, /\.isResearch\b/, 'no registry flag is trusted');
  assert.match(hooks, /d = \{ ok: false, reason: WEB_SETTINGS_UNREADABLE \}/, 'fails closed');
  assert.match(read('src/main/index.ts'), /if \(isResearch && !researchWalled\) \{/, 'Research never starts without its walls (D2.8)');
});

test('Research opens nothing of the office, and its own folders reopen', () => {
  // Value: protects=Research never reads the board, memory or business files; fails_when=a walled folder opens or its own folder is shut; why_new=eng review R1; seam=none
  const walled = [P('/w/home'), P('/w/Biz')];
  const own = [P('/w/home/hive/agents/research'), P('/w/home/research-desk')];
  const pol = F.researchFolderPolicy(walled, own);
  assert.deepEqual(pol.sandbox.denyRead, walled);
  assert.deepEqual(pol.sandbox.allowRead, own);
  assert.equal(pol.sandboxOnly, true);
  for (const target of ['/w/home/hive/tasks.json', '/w/home/hive/agents/pam/inbox/x.json', '/w/home/palace/x', '/w/Biz/Finance/ledger.xlsx']) {
    assert.equal(F.researchFolderDecision(walled, own, 'Read', P(target), true).deny, true, target);
  }
  assert.equal(F.researchFolderDecision(walled, own, 'Write', P('/w/home/hive/agents/research/outbox/a.json'), true).deny, false);
  assert.equal(F.researchFolderDecision(walled, own, 'Read', P('/w/home/research-desk/notes.md'), true).deny, false);
  assert.equal(F.researchFolderDecision(walled, own, 'Bash', P('/w/home/hive/tasks.json'), true).deny, false, 'not a file tool');
});

test('nobody else writes into or reads Research\'s folders', () => {
  // Value: protects=no member drops a message into Research's inbox past the check, or reads its raw web text; fails_when=the deny rule or the hook decision is missing; why_new=eng review R2, owner 2026-10-13 (its folders are its alone); seam=none
  const folders = [P('/w/home/hive/agents/research'), P('/w/home/research-desk')];
  const base = { sandbox: { denyWrite: ['/x'], denyRead: [], allowRead: [] }, deny: [], sandboxOnly: true };
  const pol = F.withResearchWall(base, folders);
  assert.deepEqual(pol.sandbox.denyWrite, ['/x', ...folders]);
  assert.ok(pol.deny.some((r) => r.startsWith('Edit(') && r.includes('/hive/agents/research')));
  assert.equal(F.researchWallDecision(folders, 'Write', P('/w/home/hive/agents/research/inbox/x.json'), true).deny, true);
  assert.deepEqual(pol.sandbox.denyRead, folders);
  assert.equal(F.researchWallDecision(folders, 'Read', P('/w/home/hive/agents/research/inbox/x.json'), true).deny, true);
  assert.equal(F.researchWallDecision(folders, 'Grep', P('/w/home/hive'), true).deny, false, 'a search over the hive stays open; Read rules filter it');
  assert.equal(F.researchWallDecision(folders, 'Write', P('/w/home/hive/agents/pam/outbox/x.json'), true).deny, false);
});

test('Research can hold no mailbox, connector or schedule', () => {
  // Value: protects=Research never gets office data through a grant; fails_when=a grant handler accepts its id; why_new=new feature (design review D19); seam=source
  const main = read('src/main/index.ts');
  assert.match(main, /\/\/ Research holds no office data \(issue #230\): no mailbox, ever\.\n  if \(agentId === RESEARCH_ID\) return \{ ok: false, restartNeeded: false \};/);
  assert.match(main, /agentId === RESEARCH_ID \|\| typeof key !== 'string'/, 'connectors');
  assert.match(main, /if \(agentId === RESEARCH_ID\) return \{ ok: false \};\n  const quickbooks/, 'QuickBooks');
  assert.match(main, /if \(mission\.to === RESEARCH_ID\) return \{ ok: false, error: 'Research has no schedules' \};/);
  assert.match(main, /if \(actor === RESEARCH_ID\) return 'Research has no schedules/);
});

test('Research\'s notes reach the shared memory only as a cleaned copy', () => {
  // Value: protects=web text never enters the team's memory search unchecked; fails_when=the palace mines Research's folder as is, or a note the layer can't check is mined; why_new=ship review D2.9; seam=source (MemoryManager needs mempalace)
  const main = read('src/main/index.ts');
  assert.match(main, /memory\.setNotesFilter\(researchNotesForPalace\);/);
  assert.match(main, /if \(id !== RESEARCH_ID\) return undefined;/);
  assert.match(main, /const v = await trustLayer\.outbound\(\{ subject: 'Research notes', body: text \}\);\n  if \(v\.decision === 'deny'\) return null;/);
  const mem = read('src/main/memory.ts');
  assert.match(mem, /if \(dir === null\) continue;\n        await this\.mineAgent\(dir, id\);/);
});

test('Research runs only on Claude, where its walls work', () => {
  // Value: protects=an engine change can't start Research without its walls; fails_when=the spawn skips the engine check or Edit agent offers other engines for Research; why_new=security review pass 2, ship review D6.2; seam=none
  const main = read('src/main/index.ts');
  assert.match(main, /if \(isResearch && !claudeProvider\) \{[\s\S]{0,300}turnResearchOff\(\);\s*return \{ ok: false, error: 'Research runs only on Claude\. Turn it on again in Settings\.' \};/);
  const modal = read('src/renderer/src/components/EditAgentModal.tsx');
  assert.match(modal, /const isResearch = agent\.id === RESEARCH_ID;/);
  assert.match(modal, /BUILD_ENGINES\.includes\(p\.id\) && \(!isResearch \|\| isClaudeProvider\(p\.id\)\)/);
  assert.match(modal, /\{researchLocked \? \(/, 'a locked engine shows as plain text');
  assert.match(modal, /isResearch && isClaudeProvider\(inferAgentProvider\(agent\.command, agent\.provider\)\)/, 'locked on the saved engine');
  for (const loc of ['en', 'ar', 'zh-CN']) assert.ok(JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).editAgent.researchEngine, loc);
});

test('Research\'s Work style and jobs reach it only as the trust layer passed them', async () => {
  // Value: protects=owner edited job text can't carry names to Research unchecked; fails_when=the first call returns the raw text, a refused text is used, or index.ts stops routing Research's goal through it; why_new=security review pass 2, ship review D6.4 (pass 3: tested directly, not by source pins); seam=fake layer
  const { makeResearchGoal } = loadTs('src/main/researchGoal.ts');
  let next = { decision: 'clean', subject: 's', body: 'Look up suppliers for a small cafe', removed: ['names'] };
  const seen = [];
  const goal = makeResearchGoal(() => ({ inbound: async (m) => { seen.push(m.body); return next; } }), 'BUILT IN');
  assert.equal(goal(null), 'BUILT IN');
  assert.equal(goal('BUILT IN'), 'BUILT IN', 'its own built in text needs no check');
  assert.equal(goal('Look up suppliers for Jane Smith\'s cafe'), 'BUILT IN', 'never the raw text while the check runs');
  await new Promise((r) => setImmediate(r));
  assert.equal(goal('Look up suppliers for Jane Smith\'s cafe'), 'Look up suppliers for a small cafe');
  assert.equal(seen.length, 1, 'checked once');
  next = { decision: 'deny', reason: 'x' };
  assert.equal(goal('Call Jane on 555 0100'), 'BUILT IN');
  await new Promise((r) => setImmediate(r));
  assert.equal(goal('Call Jane on 555 0100'), 'BUILT IN', 'a refused text is never used');
  // No answer is not a refusal: it is checked again after a minute.
  const realNow = Date.now;
  try {
    let now = realNow();
    Date.now = () => now;
    next = { decision: 'deny', reason: R.REFUSAL_UNSURE };
    assert.equal(goal('Pizza trends'), 'BUILT IN');
    await new Promise((r) => setImmediate(r));
    next = { decision: 'pass', subject: 's', body: 'Pizza trends' };
    assert.equal(goal('Pizza trends'), 'BUILT IN', 'not retried at once');
    now += 61_000;
    goal('Pizza trends');
    await new Promise((r) => setImmediate(r));
    assert.equal(goal('Pizza trends'), 'Pizza trends', 'retried after a minute');
  } finally { Date.now = realNow; }
  const main = read('src/main/index.ts');
  assert.match(main, /return agentId === RESEARCH_ID \? researchGoal\(text\) : text;/);
  assert.match(main, /const researchGoal = makeResearchGoal\(\(\) => trustLayer, RESEARCH_WORK_STYLE,/);
});

test('Research loads no settings or CLAUDE.md but the app\'s, and resumes only its own conversation', () => {
  // Value: protects=the owner's hooks, skills and CLAUDE.md never reach Research, and a registry edit can't resume it into another agent's conversation; fails_when=the flag is dropped or Research seeds a transcript from another project; why_new=red team pass 2 (verified live 2026-10-13: without the flag Research saw the owner's skills); seam=none
  const main = read('src/main/index.ts');
  assert.match(main, /if \(isResearch\) opts\.args = \[\.\.\.opts\.args, '--setting-sources', ''\];/);
  assert.match(main, /const resumable = isResearch\s*\? \/\^\[\\w-\]\{1,128\}\$\/\.test\(sid\) && existsSync\(join\(projectDir\(opts\.cwd\), `\$\{sid\}\.jsonl`\)\)\s*: seedSessionTranscript\(opts\.cwd, sid\);/);
});

test('Research leaves closing time alone, turning it off returns its asks, and agent temp files are pruned', () => {
  // Value: protects=closing time never steers Research around its trust layer, both safety stops return waiting asks, and moved temp files don't pile up; fails_when=closingTime waits on Research, a spawn guard writes the switch alone, or the prune is dropped; why_new=api review pass 3; seam=none
  assert.match(read('src/main/closingTime.ts'), /return id !== this\.godId && id !== RESEARCH_ID && !!a && !a\.isGod;/);
  const main = read('src/main/index.ts');
  assert.equal((main.match(/turnResearchOff\(\);/g) || []).length, 2, 'both spawn guards');
  assert.match(main, /function turnResearchOff\(\): number \{\s*writeConfig\(\{ research: [^\n]*on: false \} \}\);\s*try \{ return hive\.returnResearchInbox\(\);/);
  assert.match(main, /pruneOldFiles\(dir, 7 \* 24 \* 60 \* 60_000\);/);
});
