/**
 * Pure resolution of the active project id (ported from PunchLog M8a).
 *
 *   1. A persisted choice still among the user's memberships wins.
 *   2. Otherwise the deterministic default: the lowest project_id by string
 *      sort — memberships carry no name or ordering column, so this is the
 *      only stable-across-sign-ins default that needs no extra query.
 *   3. No memberships → null (screens already render their empty states).
 */
import type { Membership } from '../auth/roles';

export function resolveActiveProject(
  persisted: string | null,
  memberships: readonly Membership[],
): string | null {
  if (persisted && memberships.some((m) => m.project_id === persisted)) return persisted;
  if (memberships.length === 0) return null;
  return memberships.map((m) => m.project_id).sort()[0];
}
