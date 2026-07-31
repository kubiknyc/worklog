/**
 * Relational section explode: delete-and-insert child rows, per
 * `worklog_apply_section`. Extracted from sqliteRepo.native.ts (Task 4) so
 * Task 6's pull appliers can re-explode server-authored section content
 * through the exact same path the local write side uses — behavior-identical,
 * just callable from two directions now.
 *
 * Module-dependency note (deliberate, recorded): `src/sync/types.ts:5-9`
 * records the intended direction as data → sync ("the sync layer owns
 * [SectionKind] and the data layer re-exports"). This file lives in
 * `src/data/` (beside the repo that owns explosion today) and is imported by
 * `src/sync/pullTables.native.ts` — a package-level inversion with NO
 * file-level cycle (sync imports a concrete data/ file, not the other way
 * round). Accepted: the alternative (moving explosion into `src/sync/`)
 * would drag repo-owned write logic into the sync package for no behavioral
 * gain.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

import { uuidv4 } from '../lib/uuid';
import { SECTION_KINDS, type SectionKind } from '../sync/types';
import { rowsOf } from './sectionContent';
import type { Json } from './types';

/** The minimal query surface explodeSection needs — a `Pick` off expo-sqlite's
 * `SQLiteDatabase`, satisfied both by the real device database and by a
 * lightweight in-memory test fake. The full `SQLiteDatabase` (rows.native.ts's
 * `Db`) satisfies this structurally, so Task 6's applier can pass its handle
 * unchanged. */
export type Db = Pick<
  SQLiteDatabase,
  'getAllAsync' | 'getFirstAsync' | 'runAsync' | 'withTransactionAsync'
>;

// ── Opaque-row field accessors ───────────────────────────────────────────────
// Queue/pull payloads are opaque `unknown` by design, so relational rows
// reaching the explode path could be missing, null, or mistyped — coerce
// defensively rather than crash the write (mirrors rowsOf's tolerance in
// sectionContent.ts).

export function asRecord(j: unknown): Record<string, Json> {
  return j !== null && typeof j === 'object' && !Array.isArray(j)
    ? (j as Record<string, Json>)
    : {};
}
export function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}
export function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}
export function boolInt(v: unknown): number {
  return v === true ? 1 : 0;
}
/** Client uuid when present and non-empty, else a fresh one — mirrors the RPC's
 * `coalesce(nullif(r->>'id','')::uuid, gen_random_uuid())`. */
export function rowId(rec: Record<string, Json>): string {
  const id = rec.id;
  return typeof id === 'string' && id.length > 0 ? id : uuidv4();
}

/**
 * Narrows a server-provided section string against the SectionKind union
 * (source of truth: src/sync/types.ts) MINUS 'weather': weather lives in
 * report_weather locally, never report_sections — a server report_sections
 * row claiming section='weather' would write into the wrong table, so this
 * returns null (hard-skip) for 'weather' too, mirroring the server invariant
 * that `worklog_apply_section` routes weather away from report_sections.
 */
export function parseSectionKind(value: unknown): SectionKind | null {
  if (typeof value !== 'string' || value === 'weather') return null;
  return (SECTION_KINDS as readonly string[]).includes(value) ? (value as SectionKind) : null;
}

/**
 * Delete-and-insert child rows for the five relational sections
 * (crew/equipment/work_performed/delays/safety), incl. the has_delay/
 * has_incident recomputes; no-op for non-relational sections. Runs INSIDE
 * the caller's transaction — it must NOT open its own.
 */
export async function explodeSection(
  db: Db,
  reportId: string,
  section: SectionKind,
  content: Json,
): Promise<void> {
  const rows = rowsOf(content);
  if (section === 'crew') {
    await db.runAsync(`DELETE FROM report_crew WHERE report_id = ?`, [reportId]);
    for (const r of rows) {
      const rec = asRecord(r);
      await db.runAsync(
        `INSERT INTO report_crew (id, report_id, trade, headcount, hours, is_carried_forward)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          rowId(rec),
          reportId,
          str(rec.trade) ?? '',
          num(rec.headcount) ?? 0,
          num(rec.hours) ?? 0,
          boolInt(rec.is_carried_forward),
        ],
      );
    }
  } else if (section === 'equipment') {
    await db.runAsync(`DELETE FROM report_equipment WHERE report_id = ?`, [reportId]);
    for (const r of rows) {
      const rec = asRecord(r);
      // on_site defaults TRUE server-side (only an explicit false clears it).
      await db.runAsync(
        `INSERT INTO report_equipment (id, report_id, name, status, on_site)
         VALUES (?, ?, ?, ?, ?)`,
        [
          rowId(rec),
          reportId,
          str(rec.name) ?? '',
          str(rec.status) ?? 'active',
          rec.on_site === false ? 0 : 1,
        ],
      );
    }
  } else if (section === 'work_performed') {
    await db.runAsync(`DELETE FROM report_work_performed WHERE report_id = ?`, [reportId]);
    for (const r of rows) {
      const rec = asRecord(r);
      await db.runAsync(
        `INSERT INTO report_work_performed (id, report_id, trade, area, note)
         VALUES (?, ?, ?, ?, ?)`,
        [rowId(rec), reportId, str(rec.trade) ?? '', str(rec.area) ?? '', str(rec.note) ?? ''],
      );
    }
  } else if (section === 'delays') {
    await db.runAsync(`DELETE FROM report_delays WHERE report_id = ?`, [reportId]);
    for (const r of rows) {
      const rec = asRecord(r);
      await db.runAsync(
        `INSERT INTO report_delays (id, report_id, cause, responsible_party, duration_hours, is_ongoing, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          rowId(rec),
          reportId,
          str(rec.cause) ?? '',
          str(rec.responsible_party),
          num(rec.duration_hours),
          boolInt(rec.is_ongoing),
          str(rec.note),
        ],
      );
    }
    // Recompute the denormalized flag exactly like the RPC: any delay row → true.
    await db.runAsync(
      `UPDATE daily_reports
         SET has_delay = CASE WHEN EXISTS (SELECT 1 FROM report_delays WHERE report_id = ?) THEN 1 ELSE 0 END
       WHERE id = ?`,
      [reportId, reportId],
    );
  } else if (section === 'safety') {
    await db.runAsync(`DELETE FROM report_safety_observations WHERE report_id = ?`, [reportId]);
    for (const r of rows) {
      const rec = asRecord(r);
      await db.runAsync(
        `INSERT INTO report_safety_observations (id, report_id, obs_type, description, is_incident)
         VALUES (?, ?, ?, ?, ?)`,
        [
          rowId(rec),
          reportId,
          str(rec.obs_type) ?? '',
          str(rec.description),
          boolInt(rec.is_incident),
        ],
      );
    }
    // has_incident is true only when at least one observation is itself an incident.
    await db.runAsync(
      `UPDATE daily_reports
         SET has_incident = CASE WHEN EXISTS
           (SELECT 1 FROM report_safety_observations WHERE report_id = ? AND is_incident = 1) THEN 1 ELSE 0 END
       WHERE id = ?`,
      [reportId, reportId],
    );
  }
}
