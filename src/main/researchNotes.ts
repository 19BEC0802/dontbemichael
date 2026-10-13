/**
 * Research's notes, read for the team's shared memory (ship review D2.9).
 * Only plain files inside its own folder: the app reads with the owner's
 * rights, so a link Research made would reach what Research can't (Codex
 * review). Anything else is skipped.
 */
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, sep } from 'node:path';

export function readResearchNotes(agentDir: string): string {
  let root = '';
  try { root = realpathSync(agentDir); } catch { return ''; }
  const readOwn = (file: string): string | null => {
    try {
      if (!lstatSync(file).isFile()) return null;
      const real = realpathSync(file);
      return real.startsWith(root + sep) ? readFileSync(real, 'utf8') : null;
    } catch { return null; }
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
