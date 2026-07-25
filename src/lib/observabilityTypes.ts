/**
 * Shared types for the platform-split observability shell. Pure types only —
 * this file must stay free of imports so both `observability.native.ts` and
 * `observability.web.ts` can reference it without dragging anything into the
 * other platform's bundle graph.
 */

/** Mutation outcomes worth reporting. Success and offline are normal states. */
export type SyncIncident = 'parked' | 'evicted';

export type SyncIncidentDetail = {
  /** Mutation kind, e.g. `update_section`. Never user content. */
  readonly kind: string;
  readonly attempts: number;
  /** PostgREST/Postgres error code, when the failure carried one. */
  readonly errorCode?: string;
  /** HTTP status, when the failure carried one. */
  readonly errorStatus?: number;
};
