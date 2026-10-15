'use strict';

/**
 * Settings → "Reset & start over" leaves a true first run (owner, 2026-10-14:
 * demos from a separate Mac user should reset in the app, not with rm -rf).
 * It used to erase only the hive and the palace, so Research's desk and
 * threads, Company knowledge, saved keys, the history database and mail and
 * Slack files carried into the next office.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { eraseOfficeData, OFFICE_FOLDER_ENTRIES, APP_DATA_ENTRIES } = loadTs('src/main/factoryReset.ts');

function seed(dir, names) {
  for (const n of names) {
    const p = path.join(dir, n);
    if (/\.(json|db|db-wal|db-shm)$/.test(n)) fs.writeFileSync(p, '{}');
    else { fs.mkdirSync(p, { recursive: true }); fs.writeFileSync(path.join(p, 'inside.txt'), 'x'); }
  }
}

test('reset erases everything the app made for the office, and keeps the owner\'s files and the roster backups', (t) => {
  // Value: protects=a reset office starts as a new owner sees it; fails_when=an app-made entry is left behind or an owner file is removed; why_new=reset erased only the hive and palace; seam=fs; no_claim=the relaunch itself (index.ts)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'md reset-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'Harness Agents');
  const userData = path.join(root, 'app data');
  const elsewhere = path.join(root, 'claude', 'projects', 'trust-check');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(elsewhere, { recursive: true });
  seed(home, OFFICE_FOLDER_ENTRIES);
  seed(userData, APP_DATA_ENTRIES);
  // What must stay: the owner's own file in the office folder, the archived
  // rosters, and what describes this install rather than the office.
  fs.writeFileSync(path.join(home, 'my notes.txt'), 'mine');
  seed(home, ['roster-backups']);
  for (const keep of ['config.json', 'updater.log', 'last-run-version', 'model-catalog.json']) fs.writeFileSync(path.join(userData, keep), 'keep');

  const failed = eraseOfficeData({ home, userData, extra: [elsewhere, ''] });

  assert.deepEqual(failed, []);
  for (const n of OFFICE_FOLDER_ENTRIES) assert.equal(fs.existsSync(path.join(home, n)), false, `office folder: ${n}`);
  for (const n of APP_DATA_ENTRIES) assert.equal(fs.existsSync(path.join(userData, n)), false, `app data: ${n}`);
  assert.equal(fs.existsSync(elsewhere), false, 'a folder passed in extra');
  assert.equal(fs.readFileSync(path.join(home, 'my notes.txt'), 'utf8'), 'mine');
  assert.ok(fs.existsSync(path.join(home, 'roster-backups', 'inside.txt')));
  for (const keep of ['config.json', 'updater.log', 'last-run-version', 'model-catalog.json']) assert.ok(fs.existsSync(path.join(userData, keep)), keep);
});

test('the lists name the office\'s private and Research folders, Company knowledge and saved keys', () => {
  // Value: protects=the entries an owner would see carry over; fails_when=one is dropped from the list; why_new=new lists; seam=none; no_claim=entries the app adds later (grep app.getPath('userData'))
  for (const n of ['hive', 'palace', 'office.json', 'private', 'research-desk', 'agent-settings']) assert.ok(OFFICE_FOLDER_ENTRIES.includes(n), n);
  for (const n of ['harness.db', 'knowledge', 'integration-secrets.json', 'mail-proposals.json', 'pastes']) assert.ok(APP_DATA_ENTRIES.includes(n), n);
  assert.ok(!OFFICE_FOLDER_ENTRIES.includes('roster-backups'), 'archived rosters are kept');
  assert.ok(!APP_DATA_ENTRIES.includes('config.json'), 'config is reset to defaults, not deleted');
});

test('a reset with no office folder still clears the app data and never throws', (t) => {
  // Value: protects=a reset before setup finished; fails_when=a null home throws; why_new=new helper; seam=fs; no_claim=none beyond protects
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'md-reset-nohome-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  seed(userData, ['knowledge']);
  assert.deepEqual(eraseOfficeData({ home: null, userData }), []);
  assert.equal(fs.existsSync(path.join(userData, 'knowledge')), false);
});

test('app:resetAll erases the office data before it resets the config', () => {
  // Value: protects=the handler uses the helper while it still knows the office folder; fails_when=the call is dropped or moved after resetConfig(); why_new=new wiring; seam=none; no_claim=runtime order of the relaunch
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.ts'), 'utf8');
  const handler = src.slice(src.indexOf("ipcMain.handle('app:resetAll'"));
  const body = handler.slice(0, handler.indexOf('\n});'));
  const erase = body.indexOf('eraseOfficeData(');
  assert.ok(erase > 0, 'the reset calls eraseOfficeData');
  assert.ok(erase < body.indexOf('\n  resetConfig();'), 'before the config forgets the office folder');
  assert.match(body, /researchFolders\(\)/, 'Research\'s conversation too');
});
