/**
 * The office break (issue 124). On a smaller Claude plan the team reaches its
 * usage limit during the day. Claude Code says so with a StopFailure hook whose
 * `error` is `rate_limit`, and its status line carries when each limit window
 * resets (`rate_limits.<window>.resets_at`, epoch seconds). This class turns
 * those signals into one office state:
 *
 *  - waiting: the limit is reached. Schedules hold their jobs (one held run per
 *    job), and nothing types into a Claude terminal.
 *  - checking: the reset time has passed (a minute later, so Claude Code's own
 *    automatic continue goes first). Delivery opens again and Michael is told,
 *    so one turn can show whether work can start.
 *  - over: a Claude turn finished. Held jobs go out once, and team members who
 *    were cut off are told to carry on.
 *
 * A limit hit while checking goes back to waiting. With no reset time known,
 * the app checks again every RETRY_MS. The state is saved, so a restart during
 * a break still shows it. Pure apart from the injected clock and storage.
 */
import type { OfficeBreakView } from '../shared/officeBreak';

/** Wait after the reset before checking, so Claude Code's own continue (when
 *  the owner turned it on) runs first and is not doubled. */
export const RESET_GRACE_MS = 60_000;
/** A finished turn this soon after the break started does not end it: a
 *  reply already on its way when the limit was reached can still land. */
export const SETTLE_MS = 60_000;
/** How often to check again when the reset time is unknown. */
export const RETRY_MS = 15 * 60_000;
/** A check that hears nothing (no turn finished, no limit hit) ends the break:
 *  there is no sign the limit is still on. */
export const CHECK_TIMEOUT_MS = 10 * 60_000;

export interface OfficeBreakState {
  phase: 'waiting' | 'checking';
  since: number;
  /** When the limit resets, or null when unknown. */
  until: number | null;
  /** When the next step runs: the check, or the end of a check. */
  due: number;
  /** Claude team members whose turn the limit cut off. */
  cutOff: string[];
  /** Schedule ids held during the break, each once. */
  held: string[];
}

type Window = { used_percentage?: unknown; resets_at?: unknown };

/** When the reached limit resets, in ms, from a status line `rate_limits`
 *  object, or null. The status line is read after each reply, so the window
 *  that ran out can read a little under 100: the fullest window is the one
 *  that was reached, and on a tie the later reset. A wrong guess costs one
 *  check that finds the limit still on. */
export function resetFromRateLimits(rateLimits: unknown, now: number): number | null {
  if (!rateLimits || typeof rateLimits !== 'object') return null;
  let best: { pct: number; at: number } | null = null;
  for (const w of Object.values(rateLimits as Record<string, Window>)) {
    if (!w || typeof w !== 'object') continue;
    const pct = typeof w.used_percentage === 'number' ? w.used_percentage : NaN;
    const at = typeof w.resets_at === 'number' ? w.resets_at * 1000 : NaN;
    if (!(pct >= 0) || !(at > now)) continue;
    if (!best || pct > best.pct || (pct === best.pct && at > best.at)) best = { pct, at };
  }
  return best ? best.at : null;
}

export interface OfficeBreakStore {
  load(): OfficeBreakState | null;
  save(state: OfficeBreakState | null): void;
}

export class OfficeBreak {
  /** Undefined until first read: the saved state is loaded on first use, after
   *  the store has opened. */
  private saved: OfficeBreakState | null | undefined;
  /** The newest reset time read from any Claude status line. */
  private lastReset: number | null = null;

  constructor(private store: OfficeBreakStore, private now: () => number = Date.now) {}

  private get state(): OfficeBreakState | null {
    if (this.saved === undefined) {
      let s: OfficeBreakState | null = null;
      try { s = this.store.load(); } catch { /* unreadable: no break */ }
      this.saved = s && (s.phase === 'waiting' || s.phase === 'checking') && typeof s.since === 'number' && typeof s.due === 'number'
        ? { ...s, until: typeof s.until === 'number' ? s.until : null, cutOff: Array.isArray(s.cutOff) ? s.cutOff : [], held: Array.isArray(s.held) ? s.held : [] }
        : null;
    }
    return this.saved;
  }

  /** The view the owner sees, or null when the office is working. */
  view(): OfficeBreakView | null {
    return this.state ? { until: this.state.until, checking: this.state.phase === 'checking' } : null;
  }

  /** The full state, for the timer and for tests. */
  current(): OfficeBreakState | null {
    return this.state ? { ...this.state, cutOff: [...this.state.cutOff], held: [...this.state.held] } : null;
  }

  /** Whether Claude terminals and schedules are held right now. */
  holding(): boolean {
    return this.state?.phase === 'waiting';
  }

  /** A status line reading: remember when a full window resets. */
  noteRateLimits(rateLimits: unknown): void {
    const at = resetFromRateLimits(rateLimits, this.now());
    if (at !== null) this.lastReset = at;
  }

  /** A Claude turn ended on the usage limit. Returns 'started' for a new
   *  break, 'again' when a check found the limit still on, else 'held'. */
  limitReached(agentId: string): 'started' | 'again' | 'held' {
    const now = this.now();
    const until = this.lastReset !== null && this.lastReset > now ? this.lastReset : null;
    const due = until !== null ? until + RESET_GRACE_MS : now + RETRY_MS;
    const prev = this.state;
    const cutOff = prev ? (prev.cutOff.includes(agentId) ? prev.cutOff : [...prev.cutOff, agentId]) : [agentId];
    if (!prev) {
      this.set({ phase: 'waiting', since: now, until, due, cutOff, held: [] });
      return 'started';
    }
    const again = prev.phase === 'checking';
    // While waiting, a later reset time moves the check; an earlier one never
    // pulls it in (another window may still be full).
    const nextUntil = again ? until : (until !== null && (prev.until === null || until > prev.until) ? until : prev.until);
    const nextDue = again ? due : (nextUntil !== null ? Math.max(prev.due, nextUntil + RESET_GRACE_MS) : prev.due);
    this.set({ ...prev, phase: 'waiting', until: nextUntil, due: nextDue, cutOff });
    return again ? 'again' : 'held';
  }

  /** A Claude agent submitted a prompt: it is no longer cut off (Claude Code's
   *  own continue, or the owner typed). The break itself goes on. */
  promptSubmitted(agentId: string): void {
    if (!this.state || !this.state.cutOff.includes(agentId)) return;
    this.set({ ...this.state, cutOff: this.state.cutOff.filter((id) => id !== agentId) });
  }

  /** A Claude turn finished, so the plan answers again: the break is over.
   *  Returns the ended state, or null when there was no break. */
  turnFinished(agentId: string): OfficeBreakState | null {
    const s = this.state;
    if (!s || (s.phase === 'waiting' && this.now() - s.since < SETTLE_MS)) return null;
    const ended = { ...s, cutOff: s.cutOff.filter((id) => id !== agentId) };
    this.set(null);
    return ended;
  }

  /** Hold one schedule run. Returns false when that job already waits. */
  hold(missionId: string): boolean {
    if (!this.state || this.state.held.includes(missionId)) return false;
    this.set({ ...this.state, held: [...this.state.held, missionId] });
    return true;
  }

  /** The timer ran out. Waiting moves to checking ('check'); a check that
   *  heard nothing ends the break ('over', with the ended state). */
  tick(): { step: 'check' } | { step: 'over'; ended: OfficeBreakState } | null {
    const s = this.state;
    if (!s || this.now() < s.due) return null;
    if (s.phase === 'waiting') {
      this.set({ ...s, phase: 'checking', due: this.now() + CHECK_TIMEOUT_MS });
      return { step: 'check' };
    }
    this.set(null);
    return { step: 'over', ended: s };
  }

  private set(next: OfficeBreakState | null): void {
    this.saved = next;
    try { this.store.save(next); } catch { /* the break still runs this session */ }
  }
}
