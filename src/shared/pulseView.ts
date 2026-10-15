/**
 * What the Pulse view receives (docs/designs/team-performance.md): shared by
 * main (src/main/pulse.ts builds it), preload and the renderer.
 *
 * No electron or node imports.
 */
import type { PulseSnapshot } from './teamPerformance';
import type { Advice } from './teamAdvice';

export interface AppliedChange { id: number; adviceId: string; agentId: string; kind: string; before: unknown; after: unknown; at: number; undoneAt: number | null }

export interface PulseView {
  available: boolean;
  billing: 'account' | 'apiKey';
  collectingSince: string | null;
  snapshot: PulseSnapshot;
  advice: Advice[];
  /** When suggestions start (14 days after the first record), or null once they can show. */
  adviceFrom: string | null;
  saved: { state: 'none' } | { state: 'measuring'; firstAt: number } | { state: 'measured'; usd: number; since: number };
  headroom: { usedPct: number; resetsAt: number; runsOutAt: number | null } | null;
  applied: AppliedChange[];
  /** Each member's value per week for the last four weeks, oldest first. */
  trend: Record<string, number[]>;
}

