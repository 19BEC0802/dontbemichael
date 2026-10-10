'use strict';

/**
 * A damaged config.json is never lost (issue 98). A file that exists but does
 * not parse reads as the defaults, so the next save, even one setting, wrote
 * over the owner's business folder, mailboxes and send rules for good. Before a
 * save replaces it, the app keeps a copy beside it, and the app goes on working.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'md config damaged '));
const configFile = path.join(userData, 'config.json');
const electron = require.resolve('electron');
require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { app: { getPath: () => userData } } };
const { writeConfig, readConfig } = loadTs('src/main/config.ts');
test.after(() => fs.rmSync(userData, { recursive: true, force: true }));

const copies = () => fs.readdirSync(userData).filter((n) => n.startsWith('config.json.damaged-'));
const clean = () => { for (const n of fs.readdirSync(userData)) fs.rmSync(path.join(userData, n), { force: true }); };

test('a save keeps a copy of a config.json that cannot be read, then saves', () => {
  // Value: protects=the owner's settings survive a damaged config file; fails_when=a save writes over an unreadable config.json without keeping it; why_new=issue 98, one save erased the setup; seam=none
  clean();
  const damaged = '{"onboardingComplete": true, "businessFolder": "/Users/owner/Biz", "mailboxes": [';
  fs.writeFileSync(configFile, damaged);
  assert.equal(readConfig().onboardingComplete, false, 'an unreadable file reads as the defaults');

  writeConfig({ notifications: false });

  const kept = copies();
  assert.equal(kept.length, 1, 'one copy kept');
  assert.equal(fs.readFileSync(path.join(userData, kept[0]), 'utf8'), damaged, 'kept byte for byte');
  assert.equal(readConfig().notifications, false, 'the save went through, so the app keeps working');

  writeConfig({ notifications: true });
  assert.equal(copies().length, 1, 'a readable file is not copied again');
});

test('a missing or readable config.json is saved without a copy', () => {
  // Value: protects=no stray copies on normal saves; fails_when=the copy is made for a missing or valid file; why_new=issue 98; seam=none
  clean();
  writeConfig({ notifications: false });
  assert.equal(readConfig().notifications, false, 'the first save creates the file');
  writeConfig({ notifications: true });
  assert.equal(readConfig().notifications, true);
  assert.deepEqual(copies(), []);
});
