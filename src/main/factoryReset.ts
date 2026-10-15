/**
 * What Settings → "Reset & start over" erases (app:resetAll in index.ts), so
 * the next launch is a true first run: the setup a new owner sees, with
 * nothing from the office before it.
 *
 * Only what the app itself created goes. The office folder stays, and so does
 * anything else in it: the owner may have picked a folder that holds their own
 * files. roster-backups/ stays too, because a roster is archived on reset,
 * never deleted (roster.ts archive()). The business folder, the Claude Code
 * sign-in and ~/.claude belong to the owner and to Claude Code, not the app.
 *
 * In the app's data folder, config.json is put back to first-run defaults by
 * resetConfig(), and what describes this install rather than the office stays:
 * the updater's log and version stamp, the anonymous usage id, and the hero,
 * model and skill catalog caches.
 */
import { existsSync, readdirSync, rmdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import { officeRecordPath, readOfficeRecord } from './officeFile';
import { AGENT_TMP_DIR } from '../shared/folderAccess';
import { RESEARCH_DESK_DIR } from '../shared/research';
import { privateRoot } from '../shared/agentPrivatePaths';

/** Created by the app in the office folder. office.json and private/ have
 *  plain names an owner could use too, so they are handled on their own below. */
export const OFFICE_FOLDER_ENTRIES = [
  'hive',
  'palace',
  'agent-settings',
  AGENT_TMP_DIR,
  RESEARCH_DESK_DIR,
  'hallways.json',
  'tunnels.json'
] as const;

/** What the app keeps in `<office>/private/` (shared/agentPrivatePaths.ts and
 *  hive.ts). The folder itself goes only when nothing else is left in it. */
export const PRIVATE_ENTRIES = [
  'agent-mcp',
  'owner',
  'card-guard.json',
  'house-rules-seen.json',
  'research-stamp.key',
  'research-threads.json',
  'research-outbox',
  'research-pending.json',
  'research-pending-lost.json',
  'research-mined'
] as const;

/** The privacy and standing approval checks' own empty folders (index.ts). */
export const CHECK_FOLDERS = ['standing-check', 'trust-check'] as const;

/** Created by the app in its own data folder for the office it runs. */
export const APP_DATA_ENTRIES = [
  'harness.db',
  'harness.db-wal',
  'harness.db-shm',
  'knowledge',
  'integration-secrets.json',
  'mail-send-journal.json',
  'mail-proposals.json',
  'trigger-history.json',
  'owner-dock-keys.json',
  'slack-reply.json',
  'slack-done-notified.json',
  'slack-files',
  'pastes',
  ...CHECK_FOLDERS
] as const;

/** In the app's data folder and kept by a reset: they describe this install,
 *  not the office (test/factory-reset.test.cjs checks every name is in one list). */
export const APP_DATA_KEPT = ['config.json', 'hero.json', 'model-catalog.json', 'skill-catalog.json', 'last-run-version', 'updater.log'] as const;

/** Is this folder an office the app made, and not the owner's home folder or a
 *  disk's root? Only then are its app-made entries removed. */
function isOfficeFolder(home: string): boolean {
  const abs = resolve(home);
  if (abs === resolve(homedir()) || abs === parse(abs).root) return false;
  return existsSync(join(abs, 'hive', 'registry.json')) || readOfficeRecord(abs) !== null;
}

/** Erase the office's data. `extra` adds folders that live elsewhere (the
 *  hive and palace where they resolve, Research's and the checks' Claude Code
 *  conversations). Returns the paths it could not remove; a reset carries on
 *  past them rather than stopping half way. */
export function eraseOfficeData(p: { home: string | null; userData: string; extra?: string[] }): string[] {
  const home = p.home && isOfficeFolder(p.home) ? p.home : null;
  const targets = [
    ...(home ? OFFICE_FOLDER_ENTRIES.map((n) => join(home, n)) : []),
    ...(home ? PRIVATE_ENTRIES.map((n) => join(privateRoot(home), n)) : []),
    // Only the app's own office record, never an owner's file of that name.
    ...(home && readOfficeRecord(home) ? [officeRecordPath(home)] : []),
    ...APP_DATA_ENTRIES.map((n) => join(p.userData, n)),
    ...(p.extra ?? []).filter(Boolean)
  ];
  const failed: string[] = [];
  for (const t of targets) {
    // Retried for about a second: a file a stopping process still holds open
    // (Windows) or is closing gets the time to let go.
    try { rmSync(t, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { failed.push(t); }
  }
  if (home) {
    const priv = privateRoot(home);
    try { if (readdirSync(priv).length === 0) rmdirSync(priv); } catch { /* absent, or the owner's things stay */ }
  }
  return failed;
}
