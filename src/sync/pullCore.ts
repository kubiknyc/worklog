/**
 * Pure sync pull planner: which projects to pull this run (active + rotation
 * + sweep), and the column manifests each PostgREST select uses. No IO here —
 * Task 5+ turn a `PullPlan` into actual `.select()` calls against Supabase.
 */
import { DOMAIN_COLUMNS } from '../db/schema';

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** Minimum gap between two rotation picks — doc 02 §C cadence seam. */
export const ROTATION_MIN_INTERVAL_MS = 300_000; // 5 min

/** Minimum gap between two id-sweeps of the active project (403-evict recovery staleness). */
export const ACTIVE_SWEEP_MIN_INTERVAL_MS = 21_600_000; // 6 h

/** Max ids per `.in()` request — URL-length safety. */
export const IN_CHUNK_SIZE = 200;

// ---------------------------------------------------------------------------
// Column manifests
// ---------------------------------------------------------------------------

/**
 * The ONLY hand-pinned manifest: NO `expo_push_token` — grant revoked
 * (20260707000001) — and NEVER `'*'`.
 */
export const PROFILE_PULL_COLUMNS =
  'id, full_name, email, phone, company, trade, avatar_url, created_at' as const;

// Derived manifests — DOMAIN_COLUMNS[table].join(', ') — so a new server
// column flows into pulls via the parity snapshot automatically. Only
// profiles has a documented grant reason to be hand-pinned instead.
export const MEMBER_PULL_COLUMNS = DOMAIN_COLUMNS.project_members.join(', ');
export const PREFS_PULL_COLUMNS = DOMAIN_COLUMNS.report_member_prefs.join(', ');
export const PROJECT_PULL_COLUMNS = DOMAIN_COLUMNS.projects.join(', ');
export const REPORT_PULL_COLUMNS = DOMAIN_COLUMNS.daily_reports.join(', ');
export const WEATHER_PULL_COLUMNS = DOMAIN_COLUMNS.report_weather.join(', ');
// Includes updated_by — full parity, no grant trap here.
export const SECTION_PULL_COLUMNS = DOMAIN_COLUMNS.report_sections.join(', ');
// Includes project_id — the feed scopes on it directly.
export const PHOTO_PULL_COLUMNS = DOMAIN_COLUMNS.report_photos.join(', ');
export const AMENDMENT_PULL_COLUMNS = DOMAIN_COLUMNS.report_amendments.join(', ');
export const AMENDMENT_CHANGES_PULL_COLUMNS = DOMAIN_COLUMNS.report_amendment_changes.join(', ');

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------

/** Split `items` into chunks of at most `size`, for `.in()` batching. */
export function chunk<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rotation + sweep planning
// ---------------------------------------------------------------------------

export interface RotationState {
  readonly lastProjectId: string | null;
  readonly lastAt: string | null; // ISO
}

export interface PullPlan {
  readonly activeProjectId: string | null; // pulled every run when member
  readonly rotationPick: string | null; // one non-active project, or null (interval not elapsed / none)
  readonly sweepProjects: readonly string[]; // id-sweep targets this run (deduped, subset of member projects)
  readonly nextRotationState: RotationState;
}

/** Parses an ISO string to epoch ms; null or unparseable both surface as `null`. */
function parseIsoOrNull(iso: string | null): number | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** True when `lastIso` is null/unparseable (never happened) or stale by `minIntervalMs`. */
function isDue(nowMs: number, lastIso: string | null, minIntervalMs: number): boolean {
  const lastMs = parseIsoOrNull(lastIso);
  return lastMs === null || nowMs - lastMs >= minIntervalMs;
}

/**
 * Plans one pull run: the active project (echoed through — callers decide
 * whether to pull it based on membership), the next rotation pick, and the
 * set of projects to id-sweep this run.
 *
 * Rules: rotationPick = next member project after `rotation.lastProjectId` in
 * sorted order, excluding the active project, only when the rotation interval
 * has elapsed (or `lastAt` is null/unparseable); wraps around; null when no
 * candidates. `nextRotationState` advances only when a pick was made.
 * sweepProjects = dedupe(sweepDueProjectIds ∩ members) ∪ (rotationPick, if
 * any) ∪ (the active project when it's a member and its sweep stamp is
 * null/unparseable or stale by `ACTIVE_SWEEP_MIN_INTERVAL_MS`).
 */
export function planPullRun(input: {
  readonly activeProjectId: string | null;
  readonly memberProjectIds: readonly string[]; // AFTER Tier-1 replace
  readonly rotation: RotationState;
  readonly sweepDueProjectIds: readonly string[]; // pull_sweep_due:* flags (403-evict recovery)
  readonly sweepLastByProject: Readonly<Record<string, string | null>>; // pull_sweep_last:* stamps
  readonly nowIso: string;
}): PullPlan {
  const {
    activeProjectId,
    memberProjectIds,
    rotation,
    sweepDueProjectIds,
    sweepLastByProject,
    nowIso,
  } = input;
  const nowMs = Date.parse(nowIso);
  const members = new Set(memberProjectIds);

  const candidates = memberProjectIds.filter((id) => id !== activeProjectId).sort();

  let rotationPick: string | null = null;
  if (candidates.length > 0 && isDue(nowMs, rotation.lastAt, ROTATION_MIN_INTERVAL_MS)) {
    const lastIdx =
      rotation.lastProjectId === null ? -1 : candidates.indexOf(rotation.lastProjectId);
    rotationPick = candidates[(lastIdx + 1) % candidates.length];
  }

  const nextRotationState: RotationState =
    rotationPick === null ? rotation : { lastProjectId: rotationPick, lastAt: nowIso };

  const sweepSet = new Set<string>();
  for (const id of sweepDueProjectIds) {
    if (members.has(id)) sweepSet.add(id);
  }
  if (rotationPick !== null) sweepSet.add(rotationPick);
  if (
    activeProjectId !== null &&
    members.has(activeProjectId) &&
    isDue(nowMs, sweepLastByProject[activeProjectId] ?? null, ACTIVE_SWEEP_MIN_INTERVAL_MS)
  ) {
    sweepSet.add(activeProjectId);
  }

  return {
    activeProjectId,
    rotationPick,
    sweepProjects: [...sweepSet],
    nextRotationState,
  };
}

// ---------------------------------------------------------------------------
// Membership diff
// ---------------------------------------------------------------------------

/**
 * Evicted = before − after. Empty before-set → empty (first-sync safety; the
 * empty-AFTER floor is the orchestrator's pre-check, not this function's).
 */
export function diffMembership(
  beforeProjectIds: readonly string[],
  afterProjectIds: readonly string[],
): readonly string[] {
  if (beforeProjectIds.length === 0) return [];
  const after = new Set(afterProjectIds);
  return beforeProjectIds.filter((id) => !after.has(id));
}

// ---------------------------------------------------------------------------
// Pull outcome
// ---------------------------------------------------------------------------

export interface PullOutcome {
  /**
   * Every attempted phase succeeded this run (Tier-1, feeds — including zero
   * hard-skipped/held-back rows — sweeps, rotation write-back). Drives error
   * folding (Task 10), NOT the `committedPulls` counter.
   */
  readonly ok: boolean;
  /**
   * At least one local row actually CHANGED this run: any applier reported
   * `applied > 0`, the Tier-1 replace reported changed (Task 5), an eviction
   * ran, or a sweep deleted rows. Appliers count only state-changing writes
   * (Task 6's no-op rule skips identical re-deliveries) and Tier-1 reports
   * changed only on a differing snapshot, so neither a heldBack-frozen cursor
   * re-delivering the same batch nor the every-pull Tier-1 rewrite bumps
   * `completedPulls` perpetually. `completedPulls` bumps IFF `committed`
   * (Task 10) — deliberately DECOUPLED from `ok`: several `ok:false` states
   * are INDEFINITELY PERSISTENT by design (a parked photo's shielded
   * tombstone, a hard-skipped unknown section kind, the floor-(c)
   * legitimate-zero residue), and gating the counter on `ok` would freeze UI
   * refetch app-wide while every other feed still lands fresh rows. Task 10
   * updates engineApi.ts's `completedPulls` doc comment to match ("bumped
   * after every pull that landed local changes").
   */
  readonly committed: boolean;
  /**
   * First failure classified offline (`isLikelyOffline`) — engine publishes
   * `online:false`, `lastError:null`.
   */
  readonly offline: boolean;
  /** First non-offline feed error message; null when ok or offline-only. */
  readonly error: string | null;
}
