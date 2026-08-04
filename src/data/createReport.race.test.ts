/**
 * Regression: get-or-create must not double-create a report for the same
 * (project, date) under concurrency (Codex PR#1 P2). Two createReport calls
 * — a double-tap before the UI disables — can both pass the existence SELECT
 * before either INSERTs, producing two rows with different ids for the same
 * day. The local schema deliberately has NO UNIQUE(project_id, report_date)
 * (the collision/reparent path needs loser+winner to coexist briefly), so the
 * guard is in-memory serialization of the check-then-insert, keyed by
 * (project, date).
 *
 * The SELECT here awaits a real tick, so without serialization both calls
 * observe an empty table and both insert. With it, the second call runs only
 * after the first completes, sees the row, and returns it.
 */
import { createSqliteRepo } from './sqliteRepo.native';
import type { MutationStore } from '../sync/types';
import type { Db } from '../db/rows.native';

type Row = Record<string, unknown>;
const tick = () => new Promise((r) => setTimeout(r, 0));

function raceFakeDb() {
  const daily: Row[] = [];
  /**
   * Ordered trace of what the racing calls did, e.g.
   * `['select:proj-1', 'select:proj-2', 'insert:proj-1', 'insert:proj-2']`.
   * Counting rows alone cannot tell per-key locking apart from one global
   * lock — both end with two rows. The interleaving is the only observable
   * difference, so the unrelated-keys test asserts on this.
   */
  const events: string[] = [];
  const db = {
    getAllAsync: async () => [] as Row[],
    getFirstAsync: async (sql: string, params: readonly unknown[] = []): Promise<Row | null> => {
      if (!/FROM daily_reports/i.test(sql)) return null;
      const [projectId, reportDate] = params as string[];
      events.push(`select:${projectId}`);
      // Snapshot the table synchronously at entry, THEN await a tick. Two
      // concurrent callers both snapshot the (empty) table before either
      // inserts — the exact race window. Serialization makes the second call
      // start only after the first has inserted, so it snapshots the row.
      const snapshot = [...daily];
      await tick();
      return (
        snapshot.find((r) => r.project_id === projectId && r.report_date === reportDate) ?? null
      );
    },
    runAsync: async (sql: string, params: readonly unknown[] = []): Promise<void> => {
      if (/INSERT INTO daily_reports/i.test(sql)) {
        const [id, project_id, report_date] = params as string[];
        events.push(`insert:${project_id}`);
        daily.push({ id, project_id, report_date, status: 'draft' });
      }
    },
    withTransactionAsync: async (fn: () => Promise<void>): Promise<void> => fn(),
  };
  return { db: db as unknown as Db, daily, events };
}

function noopMutations(): MutationStore {
  return {
    enqueue: async () => {},
    enqueueCoalescing: async () => {},
    pending: async () => [] as never,
    all: async () => [] as never,
    replace: async () => 0,
    remove: async () => 0,
    removeParked: async () => 0,
    removeMany: async () => {},
    unpark: async () => {},
  };
}

describe('createReport concurrency (get-or-create)', () => {
  it('creates exactly one report when two calls race for the same project/date', async () => {
    const { db, daily } = raceFakeDb();
    const repo = createSqliteRepo(db, noopMutations());

    const [a, b] = await Promise.all([
      repo.createReport('proj-1', '2026-07-24'),
      repo.createReport('proj-1', '2026-07-24'),
    ]);

    expect(daily).toHaveLength(1);
    expect(a.id).toBe(b.id);
  });

  it('does not serialize unrelated (project, date) keys against each other', async () => {
    const { db, daily, events } = raceFakeDb();
    const repo = createSqliteRepo(db, noopMutations());

    await Promise.all([
      repo.createReport('proj-1', '2026-07-24'),
      repo.createReport('proj-2', '2026-07-24'),
    ]);

    expect(daily).toHaveLength(2);
    // Two rows on their own prove nothing: a single global lock would also
    // produce two. What proves the lock is keyed by (project, date) is that
    // the second key's SELECT enters before the first key's INSERT — i.e. the
    // two calls genuinely overlap. Widening the lock to a global one yields
    // ['select:proj-1', 'insert:proj-1', 'select:proj-2', 'insert:proj-2']
    // and fails here, which is the regression this test exists to catch.
    expect(events.slice(0, 2).sort()).toEqual(['select:proj-1', 'select:proj-2']);
    expect(events).toHaveLength(4);
  });
});
