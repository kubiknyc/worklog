/**
 * Reconcile sweeps against an in-memory Db fake (no real SQLite — jest-expo
 * can't open a device database). The fake supports both this module's own
 * statements AND everything `deleteLocalReport` (store.native.ts) issues,
 * since both `evictProjects` and `sweepProject` call the real
 * `deleteLocalReport` rather than a stub — the whole point of this suite is
 * to prove the deletion cascade actually happens end to end, and that
 * `deleteLocalReport`'s own transaction is the ONLY transaction boundary
 * opened (Global Constraint: no outer tx here, or the serialized tx queue in
 * db/rows.native.ts deadlocks).
 */
import { evictProjects, sweepProject } from './pullSweep.native';
import { SCOPES } from './cursors';
import type { Db } from '../db/rows.native';

type Row = Record<string, unknown>;

interface Seed {
  readonly daily_reports?: readonly Row[];
  readonly report_photos?: readonly Row[];
  readonly report_amendments?: readonly Row[];
  readonly report_amendment_changes?: readonly Row[];
  readonly sync_mutations?: readonly Row[];
  readonly sync_cursors?: readonly Row[];
  readonly sync_meta?: readonly Row[];
}

/**
 * Minimal SQLite stand-in covering: pullSweep's own SELECT/DELETE shapes,
 * PLUS deleteLocalReport's child-table sweep (store.native.ts) so the real
 * function can run against it unmodified. Every table not explicitly seeded
 * (the report_id-keyed child tables) defaults empty and is safe to no-op
 * delete against.
 */
function fakeDb(seed: Seed = {}) {
  const tables: Record<string, Row[]> = {
    daily_reports: seed.daily_reports ? [...seed.daily_reports] : [],
    report_photos: seed.report_photos ? [...seed.report_photos] : [],
    report_amendments: seed.report_amendments ? [...seed.report_amendments] : [],
    report_amendment_changes: seed.report_amendment_changes
      ? [...seed.report_amendment_changes]
      : [],
    report_sections: [],
    report_weather: [],
    report_crew: [],
    report_equipment: [],
    report_work_performed: [],
    report_delays: [],
    report_safety_observations: [],
    sync_mutations: seed.sync_mutations ? [...seed.sync_mutations] : [],
    sync_cursors: seed.sync_cursors ? [...seed.sync_cursors] : [],
    sync_meta: seed.sync_meta ? [...seed.sync_meta] : [],
  };
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  let txCount = 0;

  async function getAllAsync<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    calls.push({ sql, params });
    const trimmed = sql.trim();

    if (/^SELECT \* FROM sync_mutations$/i.test(trimmed)) {
      return [...tables.sync_mutations] as unknown as T[];
    }

    const selectMatch = trimmed.match(
      /^SELECT id FROM (\w+) WHERE project_id = \?( AND _dirty = 0)?( AND _pending = 0)?$/i,
    );
    if (selectMatch) {
      const [, table, dirtyClause, pendingClause] = selectMatch;
      const [projectId] = params as string[];
      let rows = tables[table!]!.filter((r) => r.project_id === projectId);
      if (dirtyClause) rows = rows.filter((r) => r._dirty === 0);
      if (pendingClause) rows = rows.filter((r) => r._pending === 0);
      return rows.map((r) => ({ id: r.id })) as unknown as T[];
    }

    return [] as T[];
  }

  async function runAsync(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<{ changes: number }> {
    calls.push({ sql, params });
    const trimmed = sql.trim().replace(/\s+/g, ' ');

    if (
      /^DELETE FROM report_amendment_changes WHERE amendment_id IN \(SELECT id FROM report_amendments WHERE report_id = \?\)$/i.test(
        trimmed,
      )
    ) {
      const [reportId] = params as string[];
      const amendmentIds = new Set(
        tables.report_amendments!.filter((a) => a.report_id === reportId).map((a) => a.id),
      );
      const before = tables.report_amendment_changes!.length;
      tables.report_amendment_changes = tables.report_amendment_changes!.filter(
        (r) => !amendmentIds.has(r.amendment_id),
      );
      return { changes: before - tables.report_amendment_changes!.length };
    }

    const deleteMatch = trimmed.match(/^DELETE FROM (\w+) WHERE (\w+) = \?$/i);
    if (deleteMatch) {
      const [, table, col] = deleteMatch;
      const rows = tables[table!] ?? [];
      const before = rows.length;
      tables[table!] = rows.filter((r) => r[col!] !== params[0]);
      return { changes: before - tables[table!]!.length };
    }

    return { changes: 0 };
  }

  return {
    tables,
    calls,
    get txCount(): number {
      return txCount;
    },
    getAllAsync,
    runAsync,
    async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
      txCount++;
      // A marker recorded in the SAME `calls` log used for real statements, so
      // ordering assertions can locate a `deleteLocalReport` tx boundary
      // relative to the plain `run`/`all` statements pullSweep itself issues.
      calls.push({ sql: '__TX_BOUNDARY__', params: [] });
      await fn();
    },
  };
}

function mutationRow(clientId: string, reportId: string, kind = 'update_section'): Row {
  return {
    client_id: clientId,
    kind,
    payload: JSON.stringify({ kind, data: { reportId } }),
  };
}

describe('evictProjects', () => {
  it('removes the whole subtree (report + child rows), queue rows, cursors (incl. the _v1 photo scope), and sweep meta', async () => {
    const db = fakeDb({
      daily_reports: [{ id: 'r1', project_id: 'p1', _dirty: 0 }],
      report_photos: [{ id: 'ph1', report_id: 'r1', project_id: 'p1', _dirty: 0, _pending: 0 }],
      sync_mutations: [mutationRow('r1:crew', 'r1')],
      sync_cursors: [
        { scope: SCOPES.reports('p1'), value: 't1' },
        { scope: SCOPES.sections('p1'), value: 't1' },
        { scope: SCOPES.photos('p1'), value: 't1' },
        { scope: SCOPES.amendments('p1'), value: 't1' },
      ],
      sync_meta: [
        { key: 'pull_sweep_last:p1', value: 't1' },
        { key: 'pull_sweep_due:p1', value: 't1' },
      ],
    });
    expect(SCOPES.photos('p1')).toBe('report_photos_v1:p1'); // sanity: the _v1 scope is what we assert got dropped

    const onEvicted = jest.fn();
    await evictProjects(db as unknown as Db, ['p1'], onEvicted);

    expect(db.tables.daily_reports).toHaveLength(0);
    expect(db.tables.report_photos).toHaveLength(0);
    expect(db.tables.sync_mutations).toHaveLength(0);
    expect(db.tables.sync_cursors).toHaveLength(0);
    expect(db.tables.sync_meta).toHaveLength(0);
    expect(onEvicted).toHaveBeenCalledTimes(1);
    expect(onEvicted).toHaveBeenCalledWith('p1');
  });

  it('fires exactly ONE incident for a multi-report project', async () => {
    const db = fakeDb({
      daily_reports: [
        { id: 'r1', project_id: 'p1', _dirty: 0 },
        { id: 'r2', project_id: 'p1', _dirty: 0 },
        { id: 'r3', project_id: 'p1', _dirty: 1 },
      ],
    });
    const onEvicted = jest.fn();
    await evictProjects(db as unknown as Db, ['p1'], onEvicted);

    expect(db.tables.daily_reports).toHaveLength(0);
    expect(onEvicted).toHaveBeenCalledTimes(1);
    expect(onEvicted).toHaveBeenCalledWith('p1');
  });

  it('leaves other projects entirely untouched', async () => {
    const db = fakeDb({
      daily_reports: [
        { id: 'r1', project_id: 'p1', _dirty: 0 },
        { id: 'r-other', project_id: 'p2', _dirty: 0 },
      ],
      sync_cursors: [
        { scope: SCOPES.reports('p1'), value: 't1' },
        { scope: SCOPES.reports('p2'), value: 't1' },
      ],
    });
    const onEvicted = jest.fn();
    await evictProjects(db as unknown as Db, ['p1'], onEvicted);

    expect(db.tables.daily_reports).toEqual([{ id: 'r-other', project_id: 'p2', _dirty: 0 }]);
    expect(db.tables.sync_cursors).toEqual([{ scope: SCOPES.reports('p2'), value: 't1' }]);
    expect(onEvicted).toHaveBeenCalledTimes(1);
    expect(onEvicted).not.toHaveBeenCalledWith('p2');
  });

  it('evicts a parked create_report queue row for the report, and still fires the project incident', async () => {
    const db = fakeDb({
      daily_reports: [{ id: 'r1', project_id: 'p1', _dirty: 1 }],
      sync_mutations: [mutationRow('r1', 'r1', 'create_report')],
    });
    const onEvicted = jest.fn();
    await evictProjects(db as unknown as Db, ['p1'], onEvicted);

    expect(db.tables.sync_mutations).toHaveLength(0);
    expect(onEvicted).toHaveBeenCalledWith('p1');
  });

  it('deletes a corrupt-payload queue row instead of throwing, and still evicts the valid one', async () => {
    const corrupt: Row = { client_id: 'busted', kind: 'update_section', payload: '{not json' };
    const survivorRow = mutationRow('r2:crew', 'r2');
    const db = fakeDb({
      daily_reports: [
        { id: 'r1', project_id: 'p1', _dirty: 0 },
        { id: 'r2', project_id: 'p2', _dirty: 0 },
      ],
      sync_mutations: [corrupt, mutationRow('r1:crew', 'r1'), survivorRow],
    });
    const onEvicted = jest.fn();

    // An unguarded JSON.parse would throw here — and the orchestrator retries
    // the persisted evict intent every run, so it would throw forever.
    await expect(evictProjects(db as unknown as Db, ['p1'], onEvicted)).resolves.toBeUndefined();

    // Both the corrupt row and the evicted project's row are gone; the
    // surviving project's row is untouched and byte-identical.
    expect(db.tables.sync_mutations).toEqual([survivorRow]);
    expect(db.tables.daily_reports).toEqual([{ id: 'r2', project_id: 'p2', _dirty: 0 }]);
    expect(onEvicted).toHaveBeenCalledWith('p1');
  });

  it('does not open an outer transaction — deleteLocalReport is the only tx boundary', async () => {
    const db = fakeDb({
      daily_reports: [
        { id: 'r1', project_id: 'p1', _dirty: 0 },
        { id: 'r2', project_id: 'p1', _dirty: 0 },
      ],
    });
    await evictProjects(db as unknown as Db, ['p1'], jest.fn());
    // One deleteLocalReport call per report — no extra outer tx wrapping the loop.
    expect(db.txCount).toBe(2);
  });

  it("spares a surviving project's queue row: evicting p1 deletes only the evicted report's mutation, leaving p2's untouched and byte-identical", async () => {
    const survivorRow = mutationRow('r2:crew', 'r2');
    const db = fakeDb({
      daily_reports: [
        { id: 'r1', project_id: 'p1', _dirty: 0 },
        { id: 'r2', project_id: 'p2', _dirty: 0 },
      ],
      sync_mutations: [mutationRow('r1:crew', 'r1'), survivorRow],
    });
    await evictProjects(db as unknown as Db, ['p1'], jest.fn());

    expect(db.tables.sync_mutations).toEqual([survivorRow]); // byte-identical survivor, evicted row gone
  });

  it("deletes a report's queue rows before opening that report's deleteLocalReport tx", async () => {
    const db = fakeDb({
      daily_reports: [{ id: 'r1', project_id: 'p1', _dirty: 0 }],
      sync_mutations: [mutationRow('r1:crew', 'r1')],
    });
    await evictProjects(db as unknown as Db, ['p1'], jest.fn());

    const queueDeleteIndex = db.calls.findIndex(
      (c) =>
        /^DELETE FROM sync_mutations WHERE client_id = \?$/i.test(c.sql.trim()) &&
        c.params[0] === 'r1:crew',
    );
    const txBoundaryIndex = db.calls.findIndex((c) => c.sql === '__TX_BOUNDARY__');

    expect(queueDeleteIndex).toBeGreaterThanOrEqual(0);
    expect(txBoundaryIndex).toBeGreaterThanOrEqual(0);
    expect(queueDeleteIndex).toBeLessThan(txBoundaryIndex);
  });
});

describe('sweepProject', () => {
  it('deletes a clean, server-absent report via the full deleteLocalReport cascade', async () => {
    const db = fakeDb({
      daily_reports: [{ id: 'r1', project_id: 'p1', _dirty: 0 }],
      report_amendments: [{ id: 'am1', report_id: 'r1' }],
      report_amendment_changes: [{ id: 'ac1', amendment_id: 'am1' }],
    });
    const deleted = await sweepProject(db as unknown as Db, 'p1', [], []);

    expect(db.tables.daily_reports).toHaveLength(0);
    expect(db.tables.report_amendments).toHaveLength(0);
    expect(db.tables.report_amendment_changes).toHaveLength(0); // cascaded away with the parent
    expect(deleted).toBe(1);
  });

  it('returns the total rows deleted (reports + photos) so the caller can fold it into `committed`', async () => {
    const db = fakeDb({
      daily_reports: [
        { id: 'r1', project_id: 'p1', _dirty: 0 },
        { id: 'r2', project_id: 'p1', _dirty: 0 },
      ],
      // Parented off a report that is not in daily_reports, so it is NOT
      // cascaded away by deleteLocalReport and is deleted by the photo pass.
      report_photos: [{ id: 'ph1', project_id: 'p1', report_id: 'r-gone', _dirty: 0, _pending: 0 }],
    });
    expect(await sweepProject(db as unknown as Db, 'p1', [], [])).toBe(3);
  });

  it('returns 0 when nothing was deleted — a no-op sweep must not report a commit', async () => {
    const db = fakeDb({
      daily_reports: [{ id: 'r1', project_id: 'p1', _dirty: 0 }],
      report_photos: [{ id: 'ph1', project_id: 'p1', report_id: 'r1', _dirty: 0, _pending: 0 }],
    });
    expect(await sweepProject(db as unknown as Db, 'p1', ['r1'], ['ph1'])).toBe(0);
  });

  it('keeps a dirty report even when absent from the server id list', async () => {
    const db = fakeDb({
      daily_reports: [{ id: 'r1', project_id: 'p1', _dirty: 1 }],
    });
    await sweepProject(db as unknown as Db, 'p1', [], []);
    expect(db.tables.daily_reports).toEqual([{ id: 'r1', project_id: 'p1', _dirty: 1 }]);
  });

  it('keeps a report present in the server id list', async () => {
    const db = fakeDb({
      daily_reports: [{ id: 'r1', project_id: 'p1', _dirty: 0 }],
    });
    await sweepProject(db as unknown as Db, 'p1', ['r1'], []);
    expect(db.tables.daily_reports).toEqual([{ id: 'r1', project_id: 'p1', _dirty: 0 }]);
  });

  it('deletes a clean, settled, server-absent photo', async () => {
    const db = fakeDb({
      report_photos: [{ id: 'ph1', project_id: 'p1', report_id: 'r1', _dirty: 0, _pending: 0 }],
    });
    await sweepProject(db as unknown as Db, 'p1', [], []);
    expect(db.tables.report_photos).toHaveLength(0);
  });

  it('keeps a _pending = 1 photo absent from the server id list', async () => {
    const db = fakeDb({
      report_photos: [{ id: 'ph1', project_id: 'p1', report_id: 'r1', _dirty: 0, _pending: 1 }],
    });
    await sweepProject(db as unknown as Db, 'p1', [], []);
    expect(db.tables.report_photos).toEqual([
      { id: 'ph1', project_id: 'p1', report_id: 'r1', _dirty: 0, _pending: 1 },
    ]);
  });

  it('keeps a _dirty = 1 photo absent from the server id list', async () => {
    const db = fakeDb({
      report_photos: [{ id: 'ph1', project_id: 'p1', report_id: 'r1', _dirty: 1, _pending: 0 }],
    });
    await sweepProject(db as unknown as Db, 'p1', [], []);
    expect(db.tables.report_photos).toEqual([
      { id: 'ph1', project_id: 'p1', report_id: 'r1', _dirty: 1, _pending: 0 },
    ]);
  });

  it('sweeping an unknown project is a no-op', async () => {
    const db = fakeDb({
      daily_reports: [{ id: 'r1', project_id: 'p1', _dirty: 0 }],
      report_photos: [{ id: 'ph1', project_id: 'p1', report_id: 'r1', _dirty: 0, _pending: 0 }],
    });
    await sweepProject(db as unknown as Db, 'p-unknown', [], []);
    expect(db.tables.daily_reports).toHaveLength(1);
    expect(db.tables.report_photos).toHaveLength(1);
  });

  it('does not open an outer transaction — deleteLocalReport is the only tx boundary', async () => {
    const db = fakeDb({
      daily_reports: [
        { id: 'r1', project_id: 'p1', _dirty: 0 },
        { id: 'r2', project_id: 'p1', _dirty: 0 },
      ],
      report_photos: [{ id: 'ph1', project_id: 'p1', report_id: 'r1', _dirty: 0, _pending: 0 }],
    });
    await sweepProject(db as unknown as Db, 'p1', [], []);
    // Two server-absent clean reports each open exactly one deleteLocalReport
    // tx; the plain report_photos DELETE is not itself wrapped in a tx.
    expect(db.txCount).toBe(2);
  });
});
