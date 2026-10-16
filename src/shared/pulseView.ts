/**
 * What the Pulse view receives (docs/designs/team-performance.md): shared by
 * main (src/main/pulse.ts builds it), preload and the renderer.
 *
 * No electron or node imports.
 */
import type { PulseSnapshot } from './teamPerformance';
import type { Advice } from './teamAdvice';
import type { KeptSafe } from './pulseSafety';
import type { Learning } from './teamLearning';

export interface AppliedChange { id: number; adviceId: string; agentId: string; kind: string; before: unknown; after: unknown; at: number; undoneAt: number | null }

export interface PulseView {
  available: boolean;
  billing: 'account' | 'apiKey';
  collectingSince: string | null;
  /** The first day Pulse recorded as things happened (a backfill reads the
   *  weeks before it); recommendations count from here. */
  liveSince: string | null;
  snapshot: PulseSnapshot;
  advice: Advice[];
  /** When suggestions start (14 days after the first record), or null once they can show. */
  adviceFrom: string | null;
  saved: { state: 'none' } | { state: 'measuring'; firstAt: number } | { state: 'measured'; usd: number; since: number };
  headroom: { usedPct: number; resetsAt: number; runsOutAt: number | null } | null;
  applied: AppliedChange[];
  /** Each member's value per week for the last four weeks, oldest first. */
  trend: Record<string, number[]>;
  /** What the trust layer and the owner's settings stopped in the period. */
  keptSafe: KeptSafe;
  /** The last four weeks of what the team learned, and its questions to the owner. */
  learning: Learning;
  /** On a Claude plan with a known price: every dollar above is the member's
   *  part of the plan's real cost for the period, split by share of the work;
   *  `payPerUse` is what the same work would cost per use. Null on an API key
   *  (dollars are what was spent) or a plan with no known price. */
  plan: { label: string | null; monthly: number; source: 'owner' | 'detected'; periodCost: number; payPerUse: number } | null;
}

