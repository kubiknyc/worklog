/**
 * Remote error reporting — web no-op.
 *
 * The web build is online-only: there is no SQLite mirror, no mutation queue,
 * and therefore no silent-data-loss class for this module to report on. It
 * exists so `observability.native.ts` can keep `@sentry/react-native` out of
 * the web bundle graph (see `src/platformSplit.test.ts`) while callers import
 * `./lib/observability` without a platform branch.
 *
 * Keep these signatures identical to the native file.
 */
import type { SyncIncident, SyncIncidentDetail } from './observabilityTypes';

export function initObservability(): void {
  // Intentionally empty — see file header.
}

export function reportSyncIncident(_incident: SyncIncident, _detail: SyncIncidentDetail): void {
  // Intentionally empty — see file header.
}

export function reportQueueStalled(_depth: number, _oldestAgeMs: number): void {
  // Intentionally empty — see file header.
}
