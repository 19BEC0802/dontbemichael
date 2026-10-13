/**
 * Who in the office may use the internet (issue #230,
 * docs/designs/research-agent-privacy.md): only Research. Two layers hold it:
 *
 *   - the app's own PreToolUse hook refuses WebFetch and WebSearch to everyone
 *     but Research, Michael included; this works on every platform and every
 *     engine whose bridge posts PreToolUse;
 *   - Claude Code's sandbox refuses every host to the shell (curl, python,
 *     node) of every team member but Research, through `sandbox.network` with
 *     an empty `allowedDomains` and `strictAllowlist` (verified live on
 *     2.1.296: an empty strict list refuses every host; it never covers
 *     WebFetch). Michael runs outside the sandbox, so his shell is not limited.
 *     Windows has no sandbox yet (#187).
 *
 * Pure: no fs, no electron, so the hook, the spawn and the tests share it.
 */

import { REFUSAL_WEB_TOOL, REFUSAL_WEB_TOOL_OFF } from './research';

/** The reason when the office settings cannot be read: the gate fails closed. */
export const WEB_SETTINGS_UNREADABLE = 'The app could not read the office settings, so web pages and searches are refused for now. Try again shortly.';

/** The web tools the hook gates. */
export const WEB_TOOLS: ReadonlySet<string> = new Set(['WebFetch', 'WebSearch']);

/**
 * The hook's decision for one tool call. Tools other than WebFetch and
 * WebSearch pass; Research passes; everyone else, Michael included, is
 * refused, with a reason that says how to ask Research or that it is off.
 */
export function webAccess(isResearch: boolean, researchOn: boolean, tool: string): { ok: true } | { ok: false; reason: string } {
  if (!WEB_TOOLS.has(tool) || isResearch) return { ok: true };
  return { ok: false, reason: researchOn ? REFUSAL_WEB_TOOL : REFUSAL_WEB_TOOL_OFF };
}

/** Claude Code's `sandbox.network`. */
export interface SandboxNetwork { allowedDomains: string[]; strictAllowlist: true }

/** The shell network settings for a spawn: none for Research (it uses the
 *  internet) and for Michael (he runs outside the sandbox); for every other
 *  team member an empty strict list, which refuses every host (verified live). */
export function sandboxNetwork(isResearch: boolean, isGod: boolean): SandboxNetwork | undefined {
  if (isResearch || isGod) return undefined;
  return { allowedDomains: [], strictAllowlist: true };
}
