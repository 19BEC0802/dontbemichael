'use strict';

/**
 * ⌘-clicking a path an agent printed (the fs:revealPath handler): shown in
 * its folder, never opened (owner, D12). A path an agent controls can name
 * an app, a link to one, or a folder swapped for one between a check and an
 * open (ship review, red team and specialist pass 2); opening any of them
 * would launch it outside every sandbox.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('a path an agent printed is shown in its folder and never opened', () => {
  // Value: protects=one click on agent text never launches a program; fails_when=the handler calls shell.openPath again, for a folder or anything else; why_new=owner D12 after a check then open race (both pass 2 reviewers); seam=source pin, the handler needs Electron
  const main = read('src/main/index.ts');
  const handler = main.slice(main.indexOf("ipcMain.handle('fs:revealPath'"), main.indexOf('\n});', main.indexOf("ipcMain.handle('fs:revealPath'")));
  assert.match(handler, /const st = await statAbs\(p\);\s*if \(!st\.exists\) return \{ ok: false, error: 'not found' \};\s*shell\.showItemInFolder\(st\.path\);\s*return \{ ok: true \};/);
  assert.doesNotMatch(handler, /openPath/);
  assert.doesNotMatch(read('src/main/fs.ts'), /export (async )?function (opensAsFolder|revealTarget)/, 'no folder guessing left to get wrong');
});
