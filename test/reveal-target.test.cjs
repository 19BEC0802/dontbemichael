'use strict';

/**
 * ⌘-clicking a path an agent printed (src/main/fs.ts revealTarget, the
 * fs:revealPath handler): only a plain folder opens; anything else is shown
 * in its folder, judged on the real path behind any link (ship review, red
 * team: a link named report.md to an app an agent built launched it).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');
const { posixOnly } = require('./platform.cjs');

const { revealTarget } = loadTs('src/main/fs.ts');

test('a link to an app an agent built is shown, never opened; a plain folder opens', posixOnly('symlinks'), async (t) => {
  // Value: protects=one click on agent text never launches a program outside every sandbox; fails_when=the written path or its name decides instead of the real target; why_new=red team (reproduced launch); seam=none; no_claim=what Finder does with showItemInFolder
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'md-reveal-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const app = path.join(base, 'Probe.app');
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), '<plist/>');
  fs.symlinkSync(app, path.join(base, 'report.md'));
  const viaLink = await revealTarget(path.join(base, 'report.md'));
  assert.deepEqual(viaLink, { exists: true, path: app, open: false });
  const disguised = path.join(base, 'notes.data');
  fs.mkdirSync(path.join(disguised, 'Contents', 'MacOS'), { recursive: true });
  assert.equal((await revealTarget(disguised)).open, false, 'a bundle by its contents, whatever its name');
  const folder = path.join(base, 'Q3.2026');
  fs.mkdirSync(folder);
  assert.deepEqual(await revealTarget(folder), { exists: true, path: folder, open: true });
  fs.symlinkSync(folder, path.join(base, 'shortcut'));
  assert.deepEqual(await revealTarget(path.join(base, 'shortcut')), { exists: true, path: folder, open: true }, 'a link to a plain folder opens the real folder');
  fs.writeFileSync(path.join(base, 'a.md'), 'x');
  assert.equal((await revealTarget(path.join(base, 'a.md'))).open, false, 'a file is shown in its folder');
  assert.deepEqual(await revealTarget(path.join(base, 'gone')), { exists: false });
  const main = fs.readFileSync(path.join(__dirname, '..', 'src/main/index.ts'), 'utf8');
  assert.match(main, /const t = await revealTarget\(p\);\s*if \(!t\.exists\) return \{ ok: false, error: 'not found' \};\s*if \(!t\.open\) \{ shell\.showItemInFolder\(t\.path\); return \{ ok: true \}; \}/);
});
