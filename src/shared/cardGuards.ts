/**
 * What the app keeps true about the task board on every fleet tick
 * (docs/designs/card-lifecycle.md section 10). Michael alone writes the board;
 * the app only records and guards it:
 *
 *   - A Done card stays Done. One an agent moves out of Done goes back, status
 *     only, so its questions and history are untouched (ship review, D3).
 *   - A Done card is never lost. One that vanishes from the board is put back
 *     from the copy the app kept when it last saw it Done (D5).
 *   - Triage is a way in, never a way back. A card seen in another status that
 *     turns up in Triage goes back to where it was (D4).
 *   - A parked step wakes on time. At a To do card's nextAt its person gets one
 *     "Next step due" message, and Michael one backstop note when the card is
 *     still in To do hours later (D7).
 *
 * The state is kept in the app's private folder, so a restart neither forgets
 * a Done card nor sends a reminder twice. No electron / node imports: tests
 * load it directly.
 */
import { openAskIndexes } from './askMeRouting';

export interface GuardCard {
  id: string;
  title?: string;
  status?: string;
  assignee?: string;
  nextAt?: string;
  humanQA?: unknown[];
  [field: string]: unknown;
}

export interface Reminder {
  /** The nextAt this reminder is for: a new time is a new reminder. */
  nextAt: string;
  /** Who was reminded, when it was not Michael. */
  to?: string;
  dueSentAt?: string;
  backstopSentAt?: string;
}

export interface GuardState {
  /** Which office this state belongs to, so a new office starts clean. */
  hive: string;
  /** Every card last seen Done, as it was then. */
  done: Record<string, GuardCard>;
  /** The last status other than Triage each open card was seen in. */
  placed: Record<string, string>;
  reminders: Record<string, Reminder>;
}

/** The state as it is saved, so a tick that changed nothing writes nothing.
 *  It includes each Done card's copy: a restore must bring back its latest
 *  result, not one from before a restart. */
export function guardSignature(st: GuardState): string {
  return JSON.stringify(st);
}

export const emptyGuardState = (hive: string): GuardState => ({ hive, done: {}, placed: {}, reminders: {} });

export interface GuardResult {
  /** True when the board needs fixing: apply `fixes` to it with applyGuardFixes. */
  changed: boolean;
  /** The status each fixed card goes back to, by id. */
  fixes: Record<string, string>;
  /** Done cards an agent moved out of Done, put back. */
  reopened: Array<{ card: GuardCard; to: string; openAsk: boolean }>;
  /** Done cards that had vanished, put back. */
  restored: GuardCard[];
  /** Cards moved back into Triage, returned to their last status. */
  untriaged: Array<{ card: GuardCard; to: string }>;
  state: GuardState;
}

const isCard = (t: unknown): t is GuardCard => !!t && typeof t === 'object' && typeof (t as GuardCard).id === 'string';

/** A To do card's next step time, as the board shows it: an ISO date and time
 *  with its offset. Anything else is not shown and wakes nobody. */
const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
export function isNextAt(v: unknown): v is string {
  return typeof v === 'string' && ISO_WITH_OFFSET.test(v) && !Number.isNaN(Date.parse(v));
}

/** Check the board against what the app saw before, and record what it sees now. */
export function guardCards(raw: unknown[], before: GuardState): GuardResult {
  const tasks = raw.filter(isCard);
  const reopened: GuardResult['reopened'] = [];
  const untriaged: GuardResult['untriaged'] = [];
  const fixes: Record<string, string> = {};
  const now: GuardCard[] = tasks.map((t) => {
    if (before.done[t.id] && t.status !== 'done') {
      reopened.push({ card: t, to: String(t.status ?? ''), openAsk: openAskIndexes(t.humanQA as never).length > 0 });
      fixes[t.id] = 'done';
      return { ...t, status: 'done' };
    }
    const was = before.placed[t.id];
    if (t.status === 'triage' && was) {
      untriaged.push({ card: t, to: was });
      fixes[t.id] = was;
      return { ...t, status: was };
    }
    return t;
  });
  const present = new Set(now.map((t) => t.id));
  const restored = Object.values(before.done).filter((t) => !present.has(t.id));
  now.push(...restored);

  const state: GuardState = { hive: before.hive, done: {}, placed: {}, reminders: {} };
  for (const t of now) {
    if (t.status === 'done') state.done[t.id] = t;
    else if (t.status && t.status !== 'triage') state.placed[t.id] = t.status;
    if (before.reminders[t.id]) state.reminders[t.id] = before.reminders[t.id];
  }
  return { changed: Object.keys(fixes).length > 0 || restored.length > 0, fixes, reopened, restored, untriaged, state };
}

/** The board as read just now with the fixes applied: only the fixed cards'
 *  status changes, restored cards are added when still missing, and every
 *  other entry, a card without an id included, stays as it is. */
export function applyGuardFixes(raw: unknown[], fixes: Record<string, string>, restored: GuardCard[]): unknown[] {
  const out = raw.map((t) => (isCard(t) && fixes[t.id] && t.status !== fixes[t.id] ? { ...t, status: fixes[t.id] } : t));
  const present = new Set(raw.filter(isCard).map((t) => t.id));
  for (const t of restored) if (!present.has(t.id)) out.push(t);
  return out;
}

/** How long after a step's reminder Michael hears that its card is still in To do. */
export const NEXT_BACKSTOP_MS = 4 * 60 * 60 * 1000;

/** The To do cards whose next step is due now (`due`), and those still in To do
 *  long after their reminder (`backstop`), with the reminders updated. */
export function dueReminders(
  tasks: GuardCard[],
  reminders: Record<string, Reminder>,
  now: number,
  backstopMs = NEXT_BACKSTOP_MS
): { due: GuardCard[]; backstop: GuardCard[]; reminders: Record<string, Reminder> } {
  const due: GuardCard[] = [];
  const backstop: GuardCard[] = [];
  const out = { ...reminders };
  const at = new Date(now).toISOString();
  for (const t of tasks) {
    if (!isCard(t) || t.status !== 'todo' || !isNextAt(t.nextAt)) continue;
    const when = Date.parse(t.nextAt);
    if (when > now) continue;
    const r = out[t.id];
    if (!r || r.nextAt !== t.nextAt) {
      due.push(t);
      out[t.id] = { nextAt: t.nextAt, dueSentAt: at };
    } else if (r.dueSentAt && !r.backstopSentAt && now - Date.parse(r.dueSentAt) >= backstopMs) {
      backstop.push(t);
      out[t.id] = { ...r, backstopSentAt: at };
    }
  }
  return { due, backstop, reminders: out };
}
