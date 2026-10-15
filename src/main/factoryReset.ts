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
import { rmSync } from 'node:fs';
import { join } from 'node:path';

/** Created by the app in the office folder. */
export const OFFICE_FOLDER_ENTRIES = [
  'hive',
  'palace',
  'office.json',
  'agent-settings',
  'agent-tmp',
  'private',
  'research-desk',
  'hallways.json',
  'tunnels.json'
] as const;

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
  'standing-check',
  'trust-check'
] as const;

/** Erase the office's data. `extra` adds folders that live elsewhere (the
 *  hive and palace where they resolve, Research's and the checks' Claude Code
 *  conversations). Returns the paths it could not remove; a reset carries on
 *  past them rather than stopping half way. */
export function eraseOfficeData(p: { home: string | null; userData: string; extra?: string[] }): string[] {
  const targets = [
    ...(p.home ? OFFICE_FOLDER_ENTRIES.map((n) => join(p.home as string, n)) : []),
    ...APP_DATA_ENTRIES.map((n) => join(p.userData, n)),
    ...(p.extra ?? []).filter(Boolean)
  ];
  const failed: string[] = [];
  for (const t of targets) {
    try { rmSync(t, { recursive: true, force: true }); } catch { failed.push(t); }
  }
  return failed;
}
