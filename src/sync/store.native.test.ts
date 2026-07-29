/**
 * Store behaviour against an in-memory Db fake (no real SQLite — jest-expo can't
 * open a device database). The fake emulates only the handful of statements the
 * store issues, including `ON CONFLICT` upsert semantics (enqueueCoalescing's
 * revision bump) and the revision-guarded write/delete statements.
 */
import {
  clearDirty,
  createCursorStore,
  createMutationStore,
  deleteLocalReport,
} from './store.native';
import { newMutation } from './mutationQueue';
import { reportSyncIncident } from '../lib/observability.native';
import type { Mutation, MutationPayload } from './types';

jest.mock('../lib/observability.native', () => ({
  reportSyncIncident: jest.fn(),
}));

const mockReportSyncIncident = reportSyncIncident as jest.Mock;

interface Row {
  seq: number;
  client_id: string;
  kind: string;
  payload: string;
  created_at: string;
  attempts: number;
  status: string;
  last_error: string | null;
  revision: number;
}

/** Minimal SQLite stand-in: recognizes the store's statements by pattern. */
function fakeDb() {
  const rows: Row[] = [];
  const cursors = new Map<string, string>();
  let seq = 0;

  return {
    rows,
    cursors,
    async runAsync(sql: string, params: readonly unknown[] = []): Promise<{ changes: number }> {
      if (/INSERT OR IGNORE INTO sync_mutations/i.test(sql)) {
        const [client_id, kind, payload, created_at, attempts, status, last_error, revision] =
          params as never[];
        if (rows.some((r) => r.client_id === client_id)) return { changes: 0 }; // OR IGNORE
        rows.push({
          seq: ++seq,
          client_id,
          kind,
          payload,
          created_at,
          attempts,
          status,
          last_error,
          revision,
        });
        return { changes: 1 };
      }
      if (/INSERT INTO sync_mutations[\s\S]*ON CONFLICT \(client_id\) DO UPDATE/i.test(sql)) {
        const [client_id, kind, payload, created_at, attempts, status, last_error, revision] =
          params as never[];
        const existing = rows.find((r) => r.client_id === client_id);
        if (existing) {
          // DO UPDATE SET payload=excluded, status='pending', attempts=0,
          // last_error=NULL, revision=revision+1
          existing.payload = payload;
          existing.status = 'pending';
          existing.attempts = 0;
          existing.last_error = null;
          existing.revision = existing.revision + 1;
          return { changes: 1 };
        }
        rows.push({
          seq: ++seq,
          client_id,
          kind,
          payload,
          created_at,
          attempts,
          status,
          last_error,
          revision,
        });
        return { changes: 1 };
      }
      if (
        /UPDATE sync_mutations SET status = 'pending', attempts = 0, last_error = NULL/i.test(sql)
      ) {
        const [client_id] = params as string[];
        const r = rows.find((x) => x.client_id === client_id);
        if (r) {
          r.status = 'pending';
          r.attempts = 0;
          r.last_error = null;
          return { changes: 1 };
        }
        return { changes: 0 };
      }
      if (/UPDATE sync_mutations SET attempts/i.test(sql)) {
        // Revision-guarded replace: WHERE client_id = ? AND revision = ?
        const [attempts, status, last_error, client_id, revision] = params as never[];
        const r = rows.find((x) => x.client_id === client_id && x.revision === revision);
        if (!r) return { changes: 0 };
        r.attempts = attempts;
        r.status = status;
        r.last_error = last_error;
        return { changes: 1 };
      }
      if (/DELETE FROM sync_mutations WHERE client_id = \? AND revision = \?/i.test(sql)) {
        const [client_id, revision] = params as never[];
        const i = rows.findIndex((x) => x.client_id === client_id && x.revision === revision);
        if (i < 0) return { changes: 0 };
        rows.splice(i, 1);
        return { changes: 1 };
      }
      if (/DELETE FROM sync_mutations WHERE client_id = \? AND status = 'parked'/i.test(sql)) {
        const [client_id] = params as string[];
        const i = rows.findIndex((x) => x.client_id === client_id && x.status === 'parked');
        if (i < 0) return { changes: 0 };
        rows.splice(i, 1);
        return { changes: 1 };
      }
      if (/^DELETE FROM sync_mutations WHERE client_id = \?$/i.test(sql.trim())) {
        const [client_id] = params as string[];
        const i = rows.findIndex((x) => x.client_id === client_id);
        if (i < 0) return { changes: 0 };
        rows.splice(i, 1);
        return { changes: 1 };
      }
      if (/INSERT INTO sync_cursors/i.test(sql)) {
        const [scope, value] = params as string[];
        cursors.set(scope, value);
        return { changes: 1 };
      }
      return { changes: 0 };
    },
    async getAllAsync<T>(sql: string): Promise<T[]> {
      let out = [...rows];
      if (/status = 'pending'/i.test(sql)) out = out.filter((r) => r.status === 'pending');
      out.sort((a, b) => (/seq DESC/i.test(sql) ? b.seq - a.seq : a.seq - b.seq));
      return out as unknown as T[];
    },
    async getFirstAsync<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
      if (/FROM sync_cursors/i.test(sql)) {
        const [scope] = params as string[];
        const v = cursors.get(scope);
        return v === undefined ? null : ({ value: v } as unknown as T);
      }
      return null;
    },
  };
}

function updateSection(reportId: string, section: string, tag: string): Mutation {
  const payload = {
    kind: 'update_section',
    data: { reportId, section, content: { entries: [tag] }, isComplete: false },
  } as unknown as MutationPayload;
  return newMutation(`${reportId}:${section}`, payload, '2026-07-19T00:00:00.000Z');
}

describe('store.native mutation store', () => {
  beforeEach(() => {
    mockReportSyncIncident.mockClear();
  });

  it('drops a row with unparseable payload JSON, deletes it, and reports it as an incident (one-shot)', async () => {
    const db = fakeDb();
    const store = createMutationStore(db as never);
    await store.enqueue(updateSection('r1', 'crew', 'a'));
    // Corrupt the persisted payload directly, bypassing the store's own writes.
    db.rows[0]!.payload = '{not valid json';
    db.rows[0]!.kind = 'update_section';
    db.rows[0]!.attempts = 2;

    const all = await store.all();

    expect(all).toEqual([]); // corrupt row filtered out, healthy rest served
    expect(db.rows).toHaveLength(0); // deleted so the report is one-shot
    expect(mockReportSyncIncident).toHaveBeenCalledWith('evicted', {
      kind: 'update_section',
      attempts: 2,
    });
  });

  it('enqueue is idempotent on clientId (OR IGNORE)', async () => {
    const db = fakeDb();
    const store = createMutationStore(db as never);
    await store.enqueue(updateSection('r1', 'crew', 'a'));
    await store.enqueue(updateSection('r1', 'crew', 'b')); // same clientId → ignored
    expect(db.rows).toHaveLength(1);
    expect(JSON.parse(db.rows[0].payload).data.content.entries).toEqual(['a']);
  });

  it('enqueueCoalescing replaces payload and re-pends, keeping ONE row', async () => {
    const db = fakeDb();
    const store = createMutationStore(db as never);
    // First edit, then it parks (simulate a permanent failure via replace).
    await store.enqueueCoalescing(updateSection('r1', 'crew', 'first'));
    await store.replace({
      ...updateSection('r1', 'crew', 'first'),
      attempts: 5,
      status: 'parked',
      lastError: 'boom',
    });
    // A fresh user edit must supersede the parked mutation.
    await store.enqueueCoalescing(updateSection('r1', 'crew', 'second'));

    expect(db.rows).toHaveLength(1);
    const row = db.rows[0];
    expect(row.status).toBe('pending'); // re-pended
    expect(row.attempts).toBe(0); // fresh retry ceiling
    expect(row.last_error).toBeNull();
    expect(JSON.parse(row.payload).data.content.entries).toEqual(['second']); // latest payload
    expect(row.seq).toBe(1); // original queue position preserved
  });

  it('enqueueCoalescing bumps revision on every coalesced conflict-update', async () => {
    const db = fakeDb();
    const store = createMutationStore(db as never);
    await store.enqueueCoalescing(updateSection('r1', 'crew', 'first'));
    expect(db.rows[0].revision).toBe(0); // first insert — untouched

    await store.enqueueCoalescing(updateSection('r1', 'crew', 'second'));
    expect(db.rows[0].revision).toBe(1); // coalesced once

    await store.enqueueCoalescing(updateSection('r1', 'crew', 'third'));
    expect(db.rows[0].revision).toBe(2); // coalesced twice

    const [read] = await store.all();
    expect(read.revision).toBe(2); // store reads the bumped revision back
  });

  it('pending returns only pending rows, oldest-first', async () => {
    const db = fakeDb();
    const store = createMutationStore(db as never);
    await store.enqueue(updateSection('r1', 'crew', 'a'));
    await store.enqueue(updateSection('r1', 'safety', 'b'));
    await store.replace({
      ...updateSection('r1', 'crew', 'a'),
      attempts: 1,
      status: 'parked',
      lastError: 'x',
    });
    const pending = await store.pending();
    expect(pending.map((m) => m.clientId)).toEqual(['r1:safety']);
  });

  it('unpark flips a parked mutation back to pending with a fresh ceiling', async () => {
    const db = fakeDb();
    const store = createMutationStore(db as never);
    await store.enqueue(updateSection('r1', 'crew', 'a'));
    await store.replace({
      ...updateSection('r1', 'crew', 'a'),
      attempts: 5,
      status: 'parked',
      lastError: 'x',
    });
    await store.unpark('r1:crew');
    expect(db.rows[0].status).toBe('pending');
    expect(db.rows[0].attempts).toBe(0);
    expect(db.rows[0].last_error).toBeNull();
  });

  it('remove deletes the row when the revision matches', async () => {
    const db = fakeDb();
    const store = createMutationStore(db as never);
    await store.enqueue(updateSection('r1', 'crew', 'a'));
    const affected = await store.remove('r1:crew', 0);
    expect(affected).toBe(1);
    expect(db.rows).toHaveLength(0);
  });

  it('remove no-ops (0 affected) when the revision is stale', async () => {
    const db = fakeDb();
    const store = createMutationStore(db as never);
    await store.enqueue(updateSection('r1', 'crew', 'a'));
    // A coalesce happened after the caller read the mutation for pushing.
    await store.enqueueCoalescing(updateSection('r1', 'crew', 'b'));
    const affected = await store.remove('r1:crew', 0); // stale revision
    expect(affected).toBe(0);
    expect(db.rows).toHaveLength(1); // the fresher row survives
  });

  it('replace no-ops (0 affected) when the revision is stale', async () => {
    const db = fakeDb();
    const store = createMutationStore(db as never);
    await store.enqueueCoalescing(updateSection('r1', 'crew', 'a'));
    await store.enqueueCoalescing(updateSection('r1', 'crew', 'b')); // bumps revision to 1

    const affected = await store.replace({
      ...updateSection('r1', 'crew', 'a'), // stale copy, revision 0
      attempts: 5,
      status: 'parked',
      lastError: 'boom',
    });

    expect(affected).toBe(0);
    expect(db.rows[0].status).toBe('pending'); // untouched by the stale replace
    expect(JSON.parse(db.rows[0].payload).data.content.entries).toEqual(['b']);
  });

  it('removeParked deletes only when the row is still parked', async () => {
    const db = fakeDb();
    const store = createMutationStore(db as never);
    await store.enqueue(updateSection('r1', 'crew', 'a'));
    await store.replace({
      ...updateSection('r1', 'crew', 'a'),
      attempts: 5,
      status: 'parked',
      lastError: 'boom',
    });
    const affected = await store.removeParked('r1:crew');
    expect(affected).toBe(1);
    expect(db.rows).toHaveLength(0);
  });

  it('removeParked no-ops on a pending row (a racing coalesce wins over a stale discard tap)', async () => {
    const db = fakeDb();
    const store = createMutationStore(db as never);
    await store.enqueue(updateSection('r1', 'crew', 'a'));
    // Row is 'pending', not 'parked' (e.g. a coalesce just re-pended it).
    const affected = await store.removeParked('r1:crew');
    expect(affected).toBe(0);
    expect(db.rows).toHaveLength(1);
  });

  it('removeMany deletes unconditionally regardless of status or revision', async () => {
    const db = fakeDb();
    const store = createMutationStore(db as never);
    await store.enqueue(updateSection('r1', 'crew', 'a'));
    await store.enqueue(updateSection('r1', 'safety', 'b'));
    await store.removeMany(['r1:crew', 'r1:safety', 'nonexistent']);
    expect(db.rows).toHaveLength(0);
  });
});

describe('store.native cursor store', () => {
  it('get returns null then the last set value', async () => {
    const db = fakeDb();
    const cursors = createCursorStore(db as never);
    expect(await cursors.get('reports:p1')).toBeNull();
    await cursors.set('reports:p1', '2026-07-19');
    await cursors.set('reports:p1', '2026-07-20'); // upsert
    expect(await cursors.get('reports:p1')).toBe('2026-07-20');
  });
});

/**
 * A generic table-oriented Db fake for `clearDirty`/`deleteLocalReport`, which
 * touch domain tables rather than `sync_mutations`. Recognizes only the
 * `UPDATE ... SET _dirty = 0 WHERE ...` and `DELETE FROM ... WHERE ...` shapes
 * these two functions actually issue.
 */
function fakeReportDb() {
  const tables: Record<string, Record<string, unknown>[]> = {
    daily_reports: [{ id: 'r1', _dirty: 1 }],
    report_sections: [
      { report_id: 'r1', section: 'crew', _dirty: 1 },
      { report_id: 'r1', section: 'weather', _dirty: 1 },
    ],
    report_weather: [{ report_id: 'r1', _dirty: 1 }],
    report_photos: [{ id: 'ph1', report_id: 'r1', _dirty: 1 }],
    report_amendments: [{ id: 'am1', report_id: 'r1', _dirty: 1 }],
    report_amendment_changes: [{ id: 'ac1', amendment_id: 'am1', section: 'crew' }],
    report_crew: [{ id: 'c1', report_id: 'r1' }],
    report_equipment: [{ id: 'e1', report_id: 'r1' }],
    report_work_performed: [{ id: 'w1', report_id: 'r1' }],
    report_delays: [{ id: 'd1', report_id: 'r1' }],
    report_safety_observations: [{ id: 's1', report_id: 'r1' }],
  };

  function matchUpdateDirty(sql: string): { table: string; whereClause: string } | null {
    const m = /UPDATE (\w+) SET _dirty = 0 WHERE (.+)/i.exec(sql);
    return m ? { table: m[1]!, whereClause: m[2]! } : null;
  }

  /** `DELETE FROM report_amendment_changes WHERE amendment_id IN (SELECT id FROM report_amendments WHERE report_id = ?)`. */
  function matchAmendmentChangesSweep(sql: string): boolean {
    return /DELETE FROM report_amendment_changes\s+WHERE amendment_id IN \(SELECT id FROM report_amendments WHERE report_id = \?\)/i.test(
      sql,
    );
  }

  function matchDelete(sql: string): { table: string; col: string } | null {
    const m = /DELETE FROM (\w+) WHERE (\w+) = \?/i.exec(sql);
    return m ? { table: m[1]!, col: m[2]! } : null;
  }

  return {
    tables,
    async runAsync(sql: string, params: readonly unknown[] = []): Promise<{ changes: number }> {
      const updateDirty = matchUpdateDirty(sql);
      if (updateDirty) {
        const { table, whereClause } = updateDirty;
        const rows = tables[table] ?? [];
        const cols = [...whereClause.matchAll(/(\w+)\s*=\s*\?/g)].map((m) => m[1]!);
        let changes = 0;
        for (const row of rows) {
          if (cols.every((c, i) => row[c] === params[i])) {
            row._dirty = 0;
            changes++;
          }
        }
        return { changes };
      }
      if (matchAmendmentChangesSweep(sql)) {
        const [reportId] = params;
        const amendmentIds = new Set(
          tables.report_amendments!.filter((a) => a.report_id === reportId).map((a) => a.id),
        );
        const rows = tables.report_amendment_changes ?? [];
        const before = rows.length;
        tables.report_amendment_changes = rows.filter((r) => !amendmentIds.has(r.amendment_id));
        return { changes: before - tables.report_amendment_changes.length };
      }
      const del = matchDelete(sql);
      if (del) {
        const { table, col } = del;
        const rows = tables[table] ?? [];
        const before = rows.length;
        tables[table] = rows.filter((r) => r[col] !== params[0]);
        return { changes: before - tables[table].length };
      }
      return { changes: 0 };
    },
    async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
      await fn();
    },
  };
}

describe('store.native clearDirty', () => {
  it('clears daily_reports by id', async () => {
    const db = fakeReportDb();
    await clearDirty(db as never, { table: 'daily_reports', id: 'r1' });
    expect(db.tables.daily_reports[0]!._dirty).toBe(0);
  });

  it('clears report_photos by id', async () => {
    const db = fakeReportDb();
    await clearDirty(db as never, { table: 'report_photos', id: 'ph1' });
    expect(db.tables.report_photos[0]!._dirty).toBe(0);
  });

  it('clears report_amendments by id', async () => {
    const db = fakeReportDb();
    await clearDirty(db as never, { table: 'report_amendments', id: 'am1' });
    expect(db.tables.report_amendments[0]!._dirty).toBe(0);
  });

  it('splits the composite report_sections id into (report_id, section)', async () => {
    const db = fakeReportDb();
    await clearDirty(db as never, { table: 'report_sections', id: 'r1:crew' });
    const crew = db.tables.report_sections.find((r) => r.section === 'crew')!;
    const weather = db.tables.report_sections.find((r) => r.section === 'weather')!;
    expect(crew._dirty).toBe(0);
    expect(weather._dirty).toBe(1); // untouched — different section
  });

  it('also clears report_weather by report_id when section === "weather"', async () => {
    const db = fakeReportDb();
    await clearDirty(db as never, { table: 'report_sections', id: 'r1:weather' });
    const weatherSection = db.tables.report_sections.find((r) => r.section === 'weather')!;
    expect(weatherSection._dirty).toBe(0);
    expect(db.tables.report_weather[0]!._dirty).toBe(0); // the local mirror, cleared too
  });
});

describe('store.native deleteLocalReport', () => {
  it('deletes the report row and every child-table row for it, in one tx', async () => {
    const db = fakeReportDb();
    await deleteLocalReport(db as never, 'r1');

    expect(db.tables.daily_reports).toHaveLength(0);
    expect(db.tables.report_sections).toHaveLength(0);
    expect(db.tables.report_weather).toHaveLength(0);
    expect(db.tables.report_photos).toHaveLength(0);
    expect(db.tables.report_amendments).toHaveLength(0);
    expect(db.tables.report_crew).toHaveLength(0);
    expect(db.tables.report_equipment).toHaveLength(0);
    expect(db.tables.report_work_performed).toHaveLength(0);
    expect(db.tables.report_delays).toHaveLength(0);
    expect(db.tables.report_safety_observations).toHaveLength(0);
    // report_amendment_changes keys off amendment_id, not report_id — swept
    // via the report_amendments subquery, not the REPORT_CHILD_TABLES loop.
    expect(db.tables.report_amendment_changes).toHaveLength(0);
  });

  it('does not touch rows belonging to a different report', async () => {
    const db = fakeReportDb();
    db.tables.report_sections.push({ report_id: 'other', section: 'crew', _dirty: 0 });
    await deleteLocalReport(db as never, 'r1');
    expect(db.tables.report_sections).toEqual([{ report_id: 'other', section: 'crew', _dirty: 0 }]);
  });

  it('sweeps report_amendment_changes via the report_amendments subquery, leaving other reports untouched', async () => {
    const db = fakeReportDb();
    // A change row belonging to a DIFFERENT report's amendment must survive.
    db.tables.report_amendments.push({ id: 'am2', report_id: 'other', _dirty: 0 });
    db.tables.report_amendment_changes.push({ id: 'ac2', amendment_id: 'am2', section: 'safety' });

    await deleteLocalReport(db as never, 'r1');

    expect(db.tables.report_amendment_changes).toEqual([
      { id: 'ac2', amendment_id: 'am2', section: 'safety' },
    ]);
  });
});
