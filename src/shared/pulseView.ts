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
}

