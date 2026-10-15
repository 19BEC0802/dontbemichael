'use strict';

/**
 * The Pulse view keeps the approved design (docs/designs/team-performance.md,
 * design review D5 to D16; mockup pulse-final.html): a Pulse tab between Tasks
 * and Who talks to whom, ways to save first in amber soft cards with Apply, Not
 * now and Undo, line icons, a cost for the work bar, Michael's own tile, the
 * office row last, a layout by stage width, words for every picture, and never
 * coral.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
const view = read('src/renderer/src/components/pulse/PulseView.tsx');
const en = JSON.parse(read('src/renderer/src/i18n/locales/en.json'));

test('Pulse is a fixed view tab between Tasks and Who talks to whom, and keeps the right column', () => {
  // Value: protects=D5 location and name, D14 column; fails_when=the tab moves, is renamed or Pulse hides Ask me; why_new=design D5; seam=none; no_claim=pixel layout (visual QA after build)
  const top = read('src/renderer/src/shell/TopBar.tsx');
  assert.match(top, /tab\('tasks', t\('floorView\.tasks'\)\)\}\s*\{tab\('pulse', t\('floorView\.pulse'\)\)\}\s*\{tab\('graph'/);
  assert.equal(en.floorView.pulse, 'Pulse');
  const app = read('src/renderer/src/App.tsx');
  assert.match(app, /const columnView = floorView === 'office' \|\| floorView === 'file' \|\| floorView === 'pulse';\s*const columnShown = columnOpen && columnView;/);
  assert.match(app, /display: columnView \? 'flex' : 'none'/, 'the column shows on Pulse, not only stays mounted');
  assert.match(read('src/renderer/src/store/store.ts'), /if \(view === 'office' \|\| view === 'file' \|\| view === 'pulse'\) return \{\};/);
});

test('sections run ways to save, what got done, team, then the office row', () => {
  // Value: protects=D2 and D3 order; fails_when=a section moves or a table returns; why_new=design D2, D3; seam=none; no_claim=none beyond protects
  const order = ['pulse.waysToSave', 'pulse.whatGotDone', 'pulse.team', 'pulse.whereMoneyWent'].map((k) => view.indexOf(`t('${k}')`));
  assert.ok(order.every((i) => i > 0), 'every section is there');
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.doesNotMatch(view, /<table/);
});

test('suggestions are amber soft cards, applied ones green with Undo; no coral and no left stripe anywhere', () => {
  // Value: protects=D10, D12 and calm by default; fails_when=a suggestion gets coral or a stripe, or Apply loses its Undo; why_new=design D12; seam=none; no_claim=none beyond protects
  assert.match(view, /background: 'var\(--cth-amber-soft\)'/);
  assert.match(view, /background: 'var\(--cth-green-soft\)'[\s\S]{0,400}t\('pulse\.undo'\)/);
  assert.doesNotMatch(view, /--cth-coral/, 'no coral color on Pulse');
  assert.doesNotMatch(view, /borderLeft|borderInlineStart/);
  assert.match(view, /window\.cth\.pulseApply\(a\.id, a\.change\)/, 'apply sends what the card showed');
  assert.match(view, /t\('pulse\.notNow'\)/);
});

test('line icons, never emoji; Michael has his own tile; tiles show cost for the work, too few says so', () => {
  // Value: protects=D7, D6, D11; fails_when=emoji return, Michael gets a cost bar or a member with few pieces is compared; why_new=design D6, D7, D11; seam=none; no_claim=none beyond protects
  assert.match(view, /KIND_ICON: Record<WorkKind, IconName> = \{ email: 'mail', sent: 'send', task: 'check', check: 'clock' \}/);
  assert.doesNotMatch(view, /\p{Extended_Pictographic}/u);
  assert.match(view, /t\('pulse\.runningOffice'\)/);
  assert.match(view, /c\.verdict === 'too-few' \? t\('pulse\.tooFew'\)/);
  assert.match(view, /const idle = !counts\.length && c\.verdict === 'too-few';/);
  assert.match(view, /\{!idle && <div/, 'a member with no work shows one line, no empty bar');
});

test('the layout follows the stage width, and every picture has words', () => {
  // Value: protects=D14 reflow and D15 accessibility; fails_when=thresholds drift or a chart loses its label; why_new=design D14, D15; seam=none; no_claim=screen reader behavior (manual check)
  assert.match(view, /return w >= 1100 \? 'wide' : w >= 760 \? 'mid' : 'narrow';/);
  assert.match(view, /role="region" aria-label=\{t\('floorView\.pulse'\)\}/);
  assert.match(view, /role="img" aria-label=\{aria\}/);
  assert.match(view, /aria-live="polite"/);
  assert.match(view, /aria-label=\{t\('pulse\.planAria'/);
  assert.ok((view.match(/<button type="button"/g) || []).length >= 6, 'tiles and actions are buttons');
});

test('every pulse string is in all three locales, and the plan ring shows only on a plan', () => {
  // Value: protects=locale parity and E6 on an API key; fails_when=a key is missing in ar or zh-CN, or the ring shows for an API key; why_new=new strings; seam=none; no_claim=translation quality
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  const want = keys(en.pulse).sort();
  for (const loc of ['ar', 'zh-CN']) assert.deepEqual(keys(JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).pulse).sort(), want, loc);
  assert.match(read('src/main/pulse.ts'), /headroom: billing === 'account' \? planHeadroom\(this\.reading\) : null/);
});
