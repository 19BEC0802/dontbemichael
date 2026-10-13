/**
 * Research's notes, read for the team's shared memory (ship review D2.9).
 * Only plain files inside its own folder: the app reads with the owner's
 * rights, so a link Research made would reach what Research can't (Codex
 * review). Anything else is skipped.
 */
import { closeSync, constants, fstatSync, openSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

/** The most one note file may hold; a bigger one is skipped, not read whole
 *  into the app's memory. */
export const MAX_NOTE_BYTES = 256 * 1024;

export function readResearchNotes(agentDir: string): string {
  let root = '';
  try { root = realpathSync(agentDir); } catch { return ''; }
  const readOwn = (file: string): string | null => {
    // Its folder, as it really is, must be inside Research's own.
    try {
      const realDir = realpathSync(dirname(file));
      if (realDir !== root && !realDir.startsWith(root + sep)) return null;
    } catch { return null; }
    // Opened without following a link, and read from that same open file, so
    // nothing can be swapped in between; a file with a second name (a hard
    // link) may be one Research can't read, so it is skipped too.
    let fd = -1;
    try {
      // Without waiting: a pipe Research made would otherwise hold the open
      // forever and freeze the app (ship review). Then only a plain file, of
      // a size a note can have.
      fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
      const st = fstatSync(fd);
      if (!st.isFile() || st.nlink !== 1 || st.size > MAX_NOTE_BYTES) return null;
      // The open file must be the one its path names inside the folder now,
      // so a folder swapped for a link between the check and the open is
      // caught (verification of the Codex fix).
      const real = realpathSync(file);
      if (!real.startsWith(root + sep)) return null;
      const now = statSync(real);
      if (now.ino !== st.ino || now.dev !== st.dev) return null;
      return readFileSync(fd, 'utf8');
    } catch { return null; } finally {
      if (fd >= 0) try { closeSync(fd); } catch { /* closed */ }
    }
  };
  const parts: string[] = [];
  const top = readOwn(join(agentDir, 'memory.md'));
  if (top) parts.push(top);
  try {
    for (const f of readdirSync(join(agentDir, 'memory'))) {
      if (!f.endsWith('.md') || f === 'inbox.md') continue;
      const t = readOwn(join(agentDir, 'memory', f));
      if (t) parts.push(t);
    }
  } catch { /* none */ }
  return parts.join('\n\n').trim();
}
