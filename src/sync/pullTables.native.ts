/**
 * Tier-1 reference snapshot applier (doc 06 §B "snapshot, full replace"). Full
 * table replace for `projects` / `project_members` / `report_member_prefs` /
 * `profiles`: DELETE all rows, then INSERT the incoming snapshot rows, all
 * inside ONE transaction. Mechanical executor only — the non-empty-snapshot
 * floors that guard against wiping local data on a suspicious pull live in
 * the Task 9 orchestrator, which is the only caller.
 */
import { all, run, tx } from '../db/rows.native';
import type { Db, BindValue } from '../db/rows.native';
import { DOMAIN_COLUMNS } from '../db/schema';

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
