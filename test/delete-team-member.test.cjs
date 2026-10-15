'use strict';

/**
 * A hired team member can be deleted for good (owner, 2026-10-14): a Danger
 * zone in Edit agent, under the engine. Before it, the only remove control was
 * the close button hidden on 2026-09-24, so no hire could leave the team.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { canDeleteTeamMember, deleteTeamMember } = loadTs('src/renderer/src/shell/deleteTeamMember.ts');
const read = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

function recorder({ fail } = {}) {
  const calls = [];
  const step = (name) => (arg) => {
    calls.push(`${name}:${arg}`);
    return fail === name ? Promise.reject(new Error('boom')) : Promise.resolve();
  };
  return {
    calls,
    deps: {
      closeByOwner: step('close'),
      releaseBindings: step('release'),
      killPty: step('kill'),
      disposeTerminal: (id) => { calls.push(`dispose:${id}`); },
      archiveInRegistry: step('archive'),
      forget: (id) => { calls.push(`forget:${id}`); }
    }
  };
}

test('a hired member can be deleted; Michael, his assistant and Research cannot', () => {
  assert.equal(canDeleteTeamMember({ id: 'meredith' }), true);
  assert.equal(canDeleteTeamMember({ id: 'god', isGod: true }), false);
  assert.equal(canDeleteTeamMember({ id: 'assistant', isAssistant: true }), false);
  assert.equal(canDeleteTeamMember({ id: 'research' }), false);
});

test('a running member: schedules pause, bound work goes back, terminal stops, then off the team', async () => {
  const r = recorder();
  assert.equal(await deleteTeamMember({ id: 'meredith', ptyId: 'pty-meredith' }, r.deps), true);
  assert.deepEqual(r.calls, ['close:meredith', 'release:meredith', 'kill:pty-meredith', 'dispose:pty-meredith', 'forget:meredith']);
});

test('a member with no terminal is archived in the registry directly', async () => {
  const r = recorder();
  await deleteTeamMember({ id: 'meredith' }, r.deps);
  assert.deepEqual(r.calls, ['close:meredith', 'release:meredith', 'archive:meredith', 'forget:meredith']);
});

test('a failing step never leaves them half on the floor', async () => {
  for (const fail of ['close', 'release', 'kill']) {
    const r = recorder({ fail });
    await deleteTeamMember({ id: 'meredith', ptyId: 'pty-meredith' }, r.deps);
    assert.equal(r.calls.at(-1), 'forget:meredith', `forgotten even when ${fail} fails`);
  }
});

test('Michael is never deleted, even if the button were reached', async () => {
  const r = recorder();
  assert.equal(await deleteTeamMember({ id: 'god', isGod: true, ptyId: 'pty-god' }, r.deps), false);
  assert.deepEqual(r.calls, []);
});

test('Edit agent shows the Danger zone under the engine, behind canDeleteTeamMember', () => {
  const src = read('src/renderer/src/components/EditAgentModal.tsx');
  const engine = src.indexOf('<Fields id="engine">');
  const danger = src.indexOf('{canDeleteTeamMember(agent) && (');
  assert.ok(engine > 0 && danger > engine, 'Danger zone comes after the engine');
  const zone = src.slice(danger, src.indexOf('</div>', danger));
  assert.match(zone, /data-fields="danger"/);
  assert.match(zone, /var\(--cth-coral\)/, 'drawn in the danger red');
  assert.match(zone, /<PixelButton variant="destructive"/);
  assert.match(src, /if \(!confirm\(deleteConfirmText\(agent\.id, agent\.name, t\)\)\) return;/);
  // Off the floor, the archived list and the restore list: nothing brings them back.
  assert.match(src, /forget: \(id\) => \{ st\.archiveAgent\(id\); st\.removeArchivedAgent\(id\); st\.removeRestorableAgent\(id\); \}/);
});

test('the delete strings exist in every language, with no dashes', () => {
  const keys = ['danger', 'delete', 'deleting', 'deleteInfo', 'deleteConfirm', 'deleteConfirmSchedules', 'deleteConfirmSchedulesPlural'];
  for (const loc of ['en', 'ar', 'zh-CN']) {
    const d = JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).editAgent;
    for (const k of keys) {
      assert.equal(typeof d[k], 'string', `${loc} editAgent.${k}`);
      assert.doesNotMatch(d[k], /[–—]| - /, `${loc} editAgent.${k} has no dash`);
    }
    assert.ok(d.deleteConfirmSchedules.includes('{{count}}'), `${loc} names the schedule count`);
  }
});
