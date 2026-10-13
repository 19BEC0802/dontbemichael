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
  assert.match(main, /network: businessFolder \? sandboxNetwork\(!!opts\.hive\.isGod\) : undefined/);
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

test('nobody else writes into Research\'s folders', () => {
  // Value: protects=no member drops a message into Research's inbox past the check; fails_when=the deny rule or the hook decision is missing; why_new=eng review R2; seam=none
  const folders = [P('/w/home/hive/agents/research'), P('/w/home/research-desk')];
  const base = { sandbox: { denyWrite: ['/x'], denyRead: [], allowRead: [] }, deny: [], sandboxOnly: true };
  const pol = F.withResearchWall(base, folders);
  assert.deepEqual(pol.sandbox.denyWrite, ['/x', ...folders]);
  assert.ok(pol.deny.some((r) => r.startsWith('Edit(') && r.includes('/hive/agents/research')));
  assert.equal(F.researchWallDecision(folders, 'Write', P('/w/home/hive/agents/research/inbox/x.json'), true).deny, true);
  assert.equal(F.researchWallDecision(folders, 'Read', P('/w/home/hive/agents/research/inbox/x.json'), true).deny, false);
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
