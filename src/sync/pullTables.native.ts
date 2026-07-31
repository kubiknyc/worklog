/**
 * Tier-1 reference snapshot applier (doc 06 §B "snapshot, full replace"). Full
 * table replace for `projects` / `project_members` / `report_member_prefs` /
 * `profiles`: DELETE all rows, then INSERT the incoming snapshot rows, all
 * inside ONE transaction. Mechanical executor only — the non-empty-snapshot
 * floors that guard against wiping local data on a suspicious pull live in
 * the Task 9 orchestrator, which is the only caller.
 *
 * Also: the reports + sections pull appliers (`applyReports`/`applySections`),
 * the DIRTY-SHIELD core of the pull path — see each function's doc comment.
 */
import { all, first, run, tx } from '../db/rows.native';
import type { Db, BindValue } from '../db/rows.native';
import { DOMAIN_COLUMNS } from '../db/schema';
import { resolveReport } from './conflict';
import type { ReportLike } from './conflict';
import { boolInt, num, parseSectionKind, str, explodeSection } from '../data/sectionExplode.native';
import type { Json } from '../data/types';

export interface ReferenceSnapshot {
  readonly projects: readonly Record<string, unknown>[];
  readonly members: readonly Record<string, unknown>[];
  readonly prefs: readonly Record<string, unknown>[];
  readonly profiles: readonly Record<string, unknown>[];
}

export interface MembershipDiff {
  readonly beforeProjectIds: readonly string[];
  readonly afterProjectIds: readonly string[];
  readonly changed: boolean;
}

interface TableSpec {
  readonly table: string;
  readonly columns: readonly string[];
  readonly rows: readonly Record<string, unknown>[];
}

function buildSpecs(snap: ReferenceSnapshot): readonly TableSpec[] {
  return [
    { table: 'projects', columns: DOMAIN_COLUMNS.projects, rows: snap.projects },
    { table: 'project_members', columns: DOMAIN_COLUMNS.project_members, rows: snap.members },
    {
      table: 'report_member_prefs',
      columns: DOMAIN_COLUMNS.report_member_prefs,
      rows: snap.prefs,
    },
    { table: 'profiles', columns: DOMAIN_COLUMNS.profiles, rows: snap.profiles },
  ];
}

/** Project a row onto `columns`: unknown keys dropped, missing keys become `null`. */
function projectRow(row: Record<string, unknown>, columns: readonly string[]): unknown[] {
  return columns.map((c) => (c in row ? (row[c] ?? null) : null));
}

/**
 * Order-insensitive equality of two row sets, compared on `columns`-filtered
 * values only (so an incoming row carrying an unknown extra key still
 * compares equal to a local row that never had it).
 */
function rowsEqual(
  before: readonly Record<string, unknown>[],
  incoming: readonly Record<string, unknown>[],
  columns: readonly string[],
): boolean {
  if (before.length !== incoming.length) return false;
  const key = (r: Record<string, unknown>) => JSON.stringify(projectRow(r, columns));
  const beforeKeys = before.map(key).sort();
  const incomingKeys = incoming.map(key).sort();
  return beforeKeys.every((k, i) => k === incomingKeys[i]);
}

/**
 * Full-replace one table: read its pre-replace rows (for the `changed` diff),
 * DELETE all rows, then INSERT the incoming snapshot rows. Caller runs this
 * for all four tables inside a single `tx`.
 */
async function replaceTable(db: Db, spec: TableSpec): Promise<boolean> {
  const priorRows = await all<Record<string, unknown>>(db, `SELECT * FROM ${spec.table}`);
  const tableChanged = !rowsEqual(priorRows, spec.rows, spec.columns);

  await run(db, `DELETE FROM ${spec.table}`);
  const placeholders = spec.columns.map(() => '?').join(', ');
  for (const row of spec.rows) {
    const values = projectRow(row, spec.columns) as BindValue[];
    await run(
      db,
      `INSERT INTO ${spec.table} (${spec.columns.join(', ')}) VALUES (${placeholders})`,
      values,
    );
  }
  return tableChanged;
}

export async function applyReferenceSnapshot(
  db: Db,
  sessionUserId: string,
  snap: ReferenceSnapshot,
): Promise<MembershipDiff> {
  let beforeProjectIds: string[] = [];
  let changed = false;

  await tx(db, async () => {
    const beforeRows = await all<{ project_id: string }>(
      db,
      `SELECT project_id FROM project_members WHERE user_id = ?`,
      [sessionUserId],
    );
    beforeProjectIds = beforeRows.map((r) => r.project_id);

    const specs = buildSpecs(snap);
    let anyChanged = false;
    for (const spec of specs) {
      const tableChanged = await replaceTable(db, spec);
      anyChanged = anyChanged || tableChanged;
    }
    changed = anyChanged;
  });

  const afterProjectIds = snap.members
    .filter((m) => m.user_id === sessionUserId)
    .map((m) => m.project_id as string);

  return { beforeProjectIds, afterProjectIds, changed };
}

// ---------------------------------------------------------------------------
// Reports + sections pull appliers (dirty shield + ride-alongs)
// ---------------------------------------------------------------------------

export interface ApplyResult {
  /** Rows committed by this applier call that CHANGED local state.
   *
   * No-op rule: an incoming row for a CLEAN local row with an IDENTICAL
   * cursor timestamp (`updated_at`; `created_at` for amendments) is skipped —
   * not written, NOT counted in `applied`, timestamp still credited to
   * `cursorKeys`. Without this, a heldBack-frozen cursor re-delivers the same
   * batch every pull, the re-upserts count as applied, `committed` stays
   * true, and `completedPulls` bumps every cycle — a perpetual UI refetch
   * loop for as long as the shield persists.
   */
  readonly applied: number;
  /** Cursor timestamps of THREE creditable categories: committed rows, plain
   * dirty-SHIELDED rows, and no-op-skipped identical re-deliveries. */
  readonly cursorKeys: readonly string[];
  /** Unparseable payload / unknown section / malformed row (no string id or
   * updated_at; report rows additionally require a string `status` —
   * `resolveReport`'s `ReportLike` demands it). */
  readonly hardSkipped: number;
  /** Shielded TOMBSTONES (photos) and floor-(d) refusals (amendments); 0
   * elsewhere (Task 7 owns that path — always 0 for these two appliers). */
  readonly heldBack: number;
}

export interface PulledReportBundle {
  /** REPORT_PULL_COLUMNS shape. */
  readonly report: Record<string, unknown>;
  /** Ride-along, fetched with the same feed. */
  readonly weather: Record<string, unknown> | null;
}

export interface PulledSection {
  readonly report_id: string;
  /** Narrowed via `parseSectionKind` — unknown ⇒ hardSkipped. */
  readonly section: string;
  /** Server jsonb — parsed to `Json`; unparseable ⇒ hardSkipped. */
  readonly payload: unknown;
  readonly is_complete: unknown;
  /** Non-string ⇒ hardSkipped (same malformed-row rule as reports/photos). */
  readonly updated_at: unknown;
  readonly updated_by?: unknown;
}

/** Coerces a raw `daily_reports` pull row onto `DOMAIN_COLUMNS.daily_reports`. */
function coerceReportRow(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    id: str(raw.id),
    project_id: str(raw.project_id),
    report_date: str(raw.report_date),
    status: str(raw.status),
    has_incident: boolInt(raw.has_incident),
    has_delay: boolInt(raw.has_delay),
    created_by: str(raw.created_by),
    created_at: str(raw.created_at),
    submitted_by: str(raw.submitted_by),
    submitted_at: str(raw.submitted_at),
    locked_by: str(raw.locked_by),
    locked_at: str(raw.locked_at),
    updated_at: str(raw.updated_at),
  };
}

/** jsonb columns arrive parsed (object) from PostgREST; stringify for local TEXT storage. */
function jsonText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === 'string' ? v : JSON.stringify(v);
}

/** Coerces a raw `report_weather` ride-along row onto `DOMAIN_COLUMNS.report_weather`. */
function coerceWeatherRow(raw: Record<string, unknown>, reportId: string): Record<string, unknown> {
  return {
    report_id: reportId,
    weather_source: str(raw.weather_source) ?? 'none',
    auto_condition: str(raw.auto_condition),
    auto_temp_f: num(raw.auto_temp_f),
    auto_fetched_at: str(raw.auto_fetched_at),
    auto_raw_response: jsonText(raw.auto_raw_response),
    override_condition: str(raw.override_condition),
    override_temp_f: num(raw.override_temp_f),
    override_at: str(raw.override_at),
    override_by: str(raw.override_by),
    updated_at: str(raw.updated_at),
  };
}

interface LocalReportRow {
  readonly status: string;
  readonly updated_at: string | null;
  readonly _dirty: number;
}

/**
 * Weather ride-along, run INSIDE the caller's report transaction — for EVERY
 * non-hardSkipped bundle carrying `weather !== null`, independent of whether
 * the parent report row itself was a no-op: a re-delivered report with an
 * unchanged `updated_at` can still carry freshly-changed weather (e.g. during
 * a frozen-cursor re-delivery), and it must still apply. Gated ONLY by the
 * WEATHER row's own `_dirty` (gate 1, independent of the parent report's
 * dirty state): clean (or no local row) → upsert server verbatim over
 * `DOMAIN_COLUMNS.report_weather`, `_dirty` untouched; dirty → untouched.
 * Caller only invokes this when `bundle.weather !== null` — no server row
 * fetched is NOT deletion authority (weather has no deletion path anywhere in
 * this plan). A clean row with an identical `updated_at` is its own no-op
 * (mirrors the reports/sections no-op rule) so an identical re-delivery
 * doesn't count as a write. Returns whether it actually wrote, so the caller
 * can fold it into `applied`.
 */
async function applyWeatherRideAlong(
  db: Db,
  reportId: string,
  rawWeather: Record<string, unknown>,
): Promise<boolean> {
  const localWeather = await first<{ updated_at: string | null; _dirty: number }>(
    db,
    `SELECT updated_at, _dirty FROM report_weather WHERE report_id = ?`,
    [reportId],
  );
  if (localWeather !== null && localWeather._dirty === 1) return false;

  const weather = coerceWeatherRow(rawWeather, reportId);
  const updatedAt = weather.updated_at as string | null;
  if (localWeather !== null && localWeather.updated_at === updatedAt) return false;

  const cols = DOMAIN_COLUMNS.report_weather;
  const values = cols.map((c) => weather[c] ?? null) as BindValue[];
  const placeholders = cols.map(() => '?').join(', ');
  const updateSet = cols
    .filter((c) => c !== 'report_id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  await run(
    db,
    `INSERT INTO report_weather (${cols.join(', ')})
     VALUES (${placeholders})
     ON CONFLICT (report_id) DO UPDATE SET ${updateSet}`,
    values,
  );
  return true;
}

/**
 * Reports pull applier (06-sync-mappings.md §B, invariant 8 — the DIRTY
 * SHIELD): per bundle, coerce the raw record via `DOMAIN_COLUMNS.daily_reports`
 * (a row missing a string `id`, `status`, `updated_at`, `project_id`, or
 * `report_date` ⇒ hardSkipped — the last two are NOT NULL locally
 * (schema.ts), so an unvalidated row would otherwise abort the whole batch on
 * INSERT instead of hard-skipping just itself); read the local row's
 * `status`/`updated_at`/`_dirty`; FIRST the no-op rule (see
 * `ApplyResult.applied`): a clean local row with an identical `updated_at`
 * makes the REPORT half of this bundle a no-op (cursorKeys credited,
 * `applied` unchanged for the report). Else `resolveReport(local, server,
 * dirty)`: clean → server verbatim (`_dirty = 0`), upsert; dirty → the ONLY
 * possible change is `status`, so write ONLY when `server.status !==
 * local.status` — same status means nothing changes, and a frozen-cursor
 * re-delivery of dirty rows must not keep bumping `applied` (the timestamp is
 * still credited to `cursorKeys` either way — shield-pass). Weather rides the
 * same tx (see `applyWeatherRideAlong`) for EVERY non-hardSkipped bundle
 * carrying `weather !== null`, independent of the report no-op verdict — a
 * frozen-cursor re-delivery can still carry freshly-changed weather. The
 * bundle counts once in `applied` iff the report wrote OR the weather wrote.
 *
 * One tx per CALL, not per row (matches `applyReferenceSnapshot`'s pattern).
 */
export async function applyReports(
  db: Db,
  rows: readonly PulledReportBundle[],
): Promise<ApplyResult> {
  let applied = 0;
  const cursorKeys: string[] = [];
  let hardSkipped = 0;

  await tx(db, async () => {
    for (const bundle of rows) {
      const server = coerceReportRow(bundle.report);
      const id = server.id as string | null;
      const status = server.status as string | null;
      const updatedAt = server.updated_at as string | null;
      const projectId = server.project_id as string | null;
      const reportDate = server.report_date as string | null;
      if (
        id === null ||
        status === null ||
        updatedAt === null ||
        projectId === null ||
        reportDate === null
      ) {
        hardSkipped++;
        continue;
      }

      const local = await first<LocalReportRow>(
        db,
        `SELECT status, updated_at, _dirty FROM daily_reports WHERE id = ?`,
        [id],
      );
      const localDirty = local !== null && local._dirty === 1;
      const reportNoOp = local !== null && !localDirty && local.updated_at === updatedAt;

      let reportApplied = false;

      if (!reportNoOp) {
        const resolved = resolveReport<ReportLike>(
          local === null ? null : { status: local.status },
          { status },
          localDirty,
        );

        if (resolved.dirty === 0) {
          const cols = DOMAIN_COLUMNS.daily_reports;
          const values = cols.map((c) => server[c] ?? null) as BindValue[];
          const placeholders = cols.map(() => '?').join(', ');
          const updateSet = cols
            .filter((c) => c !== 'id')
            .map((c) => `${c} = excluded.${c}`)
            .join(', ');
          await run(
            db,
            `INSERT INTO daily_reports (${cols.join(', ')}, _dirty)
             VALUES (${placeholders}, 0)
             ON CONFLICT (id) DO UPDATE SET ${updateSet}, _dirty = 0`,
            values,
          );
          reportApplied = true;
        } else if (local !== null && local.status !== status) {
          await run(db, `UPDATE daily_reports SET status = ? WHERE id = ?`, [status, id]);
          reportApplied = true;
        }
      }

      cursorKeys.push(updatedAt);

      // Weather rides along for EVERY non-hardSkipped bundle with weather,
      // independent of whether the report itself was a no-op (Finding 3).
      let weatherApplied = false;
      if (bundle.weather !== null) {
        weatherApplied = await applyWeatherRideAlong(db, id, bundle.weather);
      }

      if (reportApplied || weatherApplied) applied++;
    }
  });

  return { applied, cursorKeys, hardSkipped, heldBack: 0 };
}

/** JSON-parses a section payload; unparseable (bad JSON string, or a type that
 * isn't representable as `Json`) ⇒ `{ ok: false }`. */
function tryParsePayload(
  payload: unknown,
): { readonly ok: true; readonly value: Json } | { readonly ok: false } {
  if (typeof payload === 'string') {
    try {
      return { ok: true, value: JSON.parse(payload) as Json };
    } catch {
      return { ok: false };
    }
  }
  if (
    payload === null ||
    typeof payload === 'number' ||
    typeof payload === 'boolean' ||
    typeof payload === 'object'
  ) {
    return { ok: true, value: payload as Json };
  }
  return { ok: false };
}

/**
 * Sections pull applier: per row, `parseSectionKind(row.section)` — null ⇒
 * hardSkipped; non-string `report_id` ⇒ hardSkipped (it arrives as `unknown`
 * off server JSON despite the `PulledSection` type saying `string` — a
 * malformed value here must not reach the `(report_id, section)` composite
 * key); non-string `updated_at` ⇒ hardSkipped; unparseable payload ⇒
 * hardSkipped. Then the no-op rule FIRST (clean `(report_id, section)` row,
 * identical `updated_at` → skip, cursorKeys credited, `applied` unchanged);
 * else the section's OWN `_dirty` (gate 2 — children are shielded by the
 * parent's verdict): `_dirty = 1` → touch NOTHING, timestamp into
 * `cursorKeys` (shield-pass); `_dirty = 0` → upsert the section row (`_dirty
 * = 0`) AND `explodeSection` in the same tx (a no-op inside `explodeSection`
 * itself for non-relational kinds).
 *
 * One tx per CALL, not per row.
 */
export async function applySections(db: Db, rows: readonly PulledSection[]): Promise<ApplyResult> {
  let applied = 0;
  const cursorKeys: string[] = [];
  let hardSkipped = 0;

  await tx(db, async () => {
    for (const row of rows) {
      const kind = parseSectionKind(row.section);
      if (kind === null) {
        hardSkipped++;
        continue;
      }
      if (typeof row.report_id !== 'string') {
        hardSkipped++;
        continue;
      }
      if (typeof row.updated_at !== 'string') {
        hardSkipped++;
        continue;
      }
      const parsed = tryParsePayload(row.payload);
      if (!parsed.ok) {
        hardSkipped++;
        continue;
      }

      const updatedAt = row.updated_at;
      const reportId = row.report_id;

      const local = await first<{ updated_at: string | null; _dirty: number }>(
        db,
        `SELECT updated_at, _dirty FROM report_sections WHERE report_id = ? AND section = ?`,
        [reportId, kind],
      );
      const localDirty = local !== null && local._dirty === 1;

      if (local !== null && !localDirty && local.updated_at === updatedAt) {
        cursorKeys.push(updatedAt);
        continue;
      }
      if (localDirty) {
        cursorKeys.push(updatedAt);
        continue;
      }

      const updatedBy = str(row.updated_by);
      await run(
        db,
        `INSERT INTO report_sections (report_id, section, payload, is_complete, updated_at, updated_by, _dirty)
         VALUES (?, ?, ?, ?, ?, ?, 0)
         ON CONFLICT (report_id, section) DO UPDATE SET
           payload = excluded.payload,
           is_complete = excluded.is_complete,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by,
           _dirty = 0`,
        [
          reportId,
          kind,
          JSON.stringify(parsed.value),
          boolInt(row.is_complete),
          updatedAt,
          updatedBy,
        ],
      );
      await explodeSection(db, reportId, kind, parsed.value);
      applied++;
      cursorKeys.push(updatedAt);
    }
  });

  return { applied, cursorKeys, hardSkipped, heldBack: 0 };
}
