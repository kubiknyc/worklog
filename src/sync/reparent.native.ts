/**
 * Re-parent transaction — collapses a "loser" report (this device's locally
 * minted id) onto a "winner" report (the id the `create_report` get-or-create
 * RPC returned instead, because another device already created that
 * project+date report — 02 §C). Called by Task 4's pusher when a
 * `create_report` push comes back with a different id than the client sent.
 *
 * Loser-wins collision policy throughout: the loser's content survives; any
 * winner-side row a rewrite would collide with is discarded first. The report
 * row itself is RENAMED, never deleted — M3a has no pull to re-materialize
 * the winner if a blind delete dropped it.
 *
 * ONE `tx` (zero-arg callback — nested `tx` calls deadlock the transaction
 * queue, `db/rows.native.ts`), so every step below is a plain `run`/`allRows`.
 * On throw: full rollback, the `create_report` mutation stays `pending` in
 * the queue — safe, the RPC is idempotent and returns the same winner id
 * again on the next attempt.
 */
import { all as allRows, run, tx } from '../db/rows.native';
import type { Db } from '../db/rows.native';
import type { MutationPayload } from './types';

/**
 * `report_sections` kinds that also explode into a relational child table
 * (docs 06 §A). Sections without an entry here (deliveries, inspections,
 * visitors, rfis, general_notes, weather) carry no child rows.
 */
const SECTION_CHILD_TABLES: Readonly<Record<string, string>> = {
  crew: 'report_crew',
  equipment: 'report_equipment',
  work_performed: 'report_work_performed',
  delays: 'report_delays',
  safety: 'report_safety_observations',
};

/**
 * Every `report_id`-keyed child table, re-homed onto the winner unconditionally
 * once winner-side collisions are cleared. `report_amendment_changes` is
 * deliberately absent — it keys off `amendment_id`, not `report_id` (Task 2's
 * review), so reparenting never touches it directly; it rides along with its
 * parent `report_amendments` row, which IS in this list.
 */
const CHILD_TABLES = [
  'report_sections',
  'report_weather',
  'report_photos',
  'report_amendments',
  'report_crew',
  'report_equipment',
  'report_work_performed',
  'report_delays',
  'report_safety_observations',
] as const;

interface MutationRow {
  readonly client_id: string;
  readonly kind: string;
  readonly payload: string;
  readonly revision: number;
}

/** `data.reportId` from any payload variant — every kind carries one (types.ts). */
function payloadReportId(payload: MutationPayload): string | undefined {
  const data = payload.data as unknown as Readonly<Record<string, unknown>>;
  return typeof data.reportId === 'string' ? data.reportId : undefined;
}

/**
 * Returns a copy of `payload` with `data.reportId` rewritten from `loserId` to
 * `winnerId` and, for `add_photo` only, `data.storagePath` rewritten too — the
 * storage path embeds the report id (`<projectId>/<reportId>/<photoId>.jpg`).
 * No other kind carries a report-scoped path (M5 obligation, see below).
 */
function rewritePayload(
  payload: MutationPayload,
  loserId: string,
  winnerId: string,
): MutationPayload {
  const data = payload.data as unknown as Readonly<Record<string, unknown>>;
  const nextData: Record<string, unknown> = { ...data, reportId: winnerId };
  if (payload.kind === 'add_photo' && typeof data.storagePath === 'string') {
    nextData.storagePath = data.storagePath.replace(loserId, winnerId);
  }
  return { ...payload, data: nextData } as unknown as MutationPayload;
}

/**
 * A coalesced `update_section` client_id is `${reportId}:${section}` [R2].
 * Returns the winner-keyed equivalent, or the input unchanged when it isn't
 * prefixed with the loser id (every other kind's client_id is its own entity
 * id — photoId/amendmentId/reportId — never reportId-prefixed).
 */
function rehomedClientId(clientId: string, loserId: string, winnerId: string): string {
  const prefix = `${loserId}:`;
  return clientId.startsWith(prefix) ? `${winnerId}:${clientId.slice(prefix.length)}` : clientId;
}

/**
 * Re-home every local row and queued mutation from `loserId` onto `winnerId`
 * in one transaction. Idempotent by construction: a second call finds nothing
 * left under `loserId` (the first call already renamed/rewrote it all), so
 * every step below is a no-op the second time — it never blanket-deletes
 * anything keyed by `winnerId`, only rows it first confirms belong to the
 * loser.
 */
export async function reparentReport(db: Db, loserId: string, winnerId: string): Promise<void> {
  await tx(db, async () => {
    // 1. report_sections collisions (composite PK report_id+section): for
    // every section the loser holds, drop the winner's colliding row, and —
    // when that section explodes into a relational child table — the
    // winner's existing rows there too, since the section rewrite about to
    // land is a full replacement of that content.
    const loserSections = await allRows<{ section: string }>(
      db,
      `SELECT section FROM report_sections WHERE report_id = ?`,
      [loserId],
    );
    for (const { section } of loserSections) {
      await run(db, `DELETE FROM report_sections WHERE report_id = ? AND section = ?`, [
        winnerId,
        section,
      ]);
      const childTable = SECTION_CHILD_TABLES[section];
      if (childTable) {
        await run(db, `DELETE FROM ${childTable} WHERE report_id = ?`, [winnerId]);
      }
    }

    // 2. report_weather collision (1:1 PK on report_id).
    const loserWeather = await allRows<{ report_id: string }>(
      db,
      `SELECT report_id FROM report_weather WHERE report_id = ?`,
      [loserId],
    );
    if (loserWeather.length > 0) {
      await run(db, `DELETE FROM report_weather WHERE report_id = ?`, [winnerId]);
    }

    // 3. Blanket re-home across every child table — safe now that any
    // winner-side row a rewrite would collide with is already gone. Tables
    // with surrogate `id` PKs (report_photos, report_amendments, and the five
    // relational child tables) never collide, so this is a plain UPDATE for
    // them too.
    for (const table of CHILD_TABLES) {
      await run(db, `UPDATE ${table} SET report_id = ? WHERE report_id = ?`, [winnerId, loserId]);
    }

    // 4. Queue rewrite: every queued mutation (other than `create_report`,
    // which stays pointed at the loser id on purpose — it's the idempotent
    // RPC call that produced this collision) whose payload embeds the loser
    // id gets `data.reportId` (and `add_photo`'s `data.storagePath`)
    // rewritten onto the winner. A coalesced client_id is re-keyed too,
    // deleting any pre-existing winner-keyed row first so the loser's payload
    // — the one actually being re-homed — wins.
    const mutations = await allRows<MutationRow>(db, `SELECT * FROM sync_mutations`);
    for (const row of mutations) {
      if (row.kind === 'create_report') continue;
      const payload = JSON.parse(row.payload) as MutationPayload;
      if (payloadReportId(payload) !== loserId) continue;

      const rewritten = rewritePayload(payload, loserId, winnerId);
      const newClientId = rehomedClientId(row.client_id, loserId, winnerId);

      if (newClientId !== row.client_id) {
        await run(db, `DELETE FROM sync_mutations WHERE client_id = ?`, [newClientId]);
      }
      await run(db, `UPDATE sync_mutations SET client_id = ?, payload = ? WHERE client_id = ?`, [
        newClientId,
        JSON.stringify(rewritten),
        row.client_id,
      ]);
    }

    // 5. Rename, never delete, the report row. `OR REPLACE` drops a
    // pre-existing winner row locally — no FKs/triggers exist in schema.ts,
    // so this has no side effects, and no child ever points at a missing
    // parent (every child table was already re-homed in step 3).
    await run(db, `UPDATE OR REPLACE daily_reports SET id = ? WHERE id = ?`, [winnerId, loserId]);
  });
}
