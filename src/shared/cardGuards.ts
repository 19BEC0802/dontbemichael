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

export const emptyGuardState = (hive: string): GuardState => ({ hive, done: {}, placed: {}, reminders: {} });

export interface GuardResult {
  /** The board to write, or null when nothing needs fixing. */
  tasks: GuardCard[] | null;
  /** Done cards an agent moved out of Done, put back. */
  reopened: Array<{ card: GuardCard; to: string; openAsk: boolean }>;
  /** Done cards that had vanished, put back. */
  restored: GuardCard[];
  /** Cards moved back into Triage, returned to their last status. */
  untriaged: Array<{ card: GuardCard; to: string }>;
  state: GuardState;
}

const isCard = (t: unknown): t is GuardCard => !!t && typeof t === 'object' && typeof (t as GuardCard).id === 'string';

/** Fix the board against what the app saw before, and record what it sees now. */
export function guardCards(raw: unknown[], before: GuardState): GuardResult {
  const tasks = raw.filter(isCard);
  const reopened: GuardResult['reopened'] = [];
  const untriaged: GuardResult['untriaged'] = [];
  let changed = false;
  const next = tasks.map((t) => {
    if (before.done[t.id] && t.status !== 'done') {
      reopened.push({ card: t, to: String(t.status ?? ''), openAsk: openAskIndexes(t.humanQA as never).length > 0 });
      changed = true;
      return { ...t, status: 'done' };
    }
    const was = before.placed[t.id];
    if (t.status === 'triage' && was) {
      untriaged.push({ card: t, to: was });
      changed = true;
      return { ...t, status: was };
    }
    return t;
  });
  const present = new Set(next.map((t) => t.id));
  const restored = Object.values(before.done).filter((t) => !present.has(t.id));
  if (restored.length) { next.push(...restored); changed = true; }

  const state: GuardState = { hive: before.hive, done: {}, placed: {}, reminders: {} };
  for (const t of next) {
    if (t.status === 'done') state.done[t.id] = t;
    else if (t.status && t.status !== 'triage') state.placed[t.id] = t.status;
    if (before.reminders[t.id]) state.reminders[t.id] = before.reminders[t.id];
  }
  return { tasks: changed ? next : null, reopened, restored, untriaged, state };
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
    if (t.status !== 'todo' || typeof t.nextAt !== 'string') continue;
    const when = Date.parse(t.nextAt);
    if (!Number.isFinite(when) || when > now) continue;
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
