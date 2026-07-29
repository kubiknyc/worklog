/**
 * reparentReport against an in-memory Db fake (no real SQLite — jest-expo
 * can't open a device database). The fake recognizes exactly the statement
 * shapes reparent.native.ts issues: per-section/report_id deletes, the
 * blanket child-table UPDATE, the sync_mutations queue rewrite, and the
 * `UPDATE OR REPLACE daily_reports` rename. See store.native.test.ts for the
 * same idiom against the mutation-store statements.
 */
import { reparentReport } from './reparent.native';
import { newMutation } from './mutationQueue';
import type { Mutation, MutationPayload } from './types';

type FakeRow = Record<string, unknown>;

const TABLES = [
  'daily_reports',
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

function fakeDb() {
  const tables: Record<string, FakeRow[]> = { sync_mutations: [] };
  for (const t of TABLES) tables[t] = [];

  return {
    tables,
    async runAsync(sql: string, params: readonly unknown[] = []): Promise<{ changes: number }> {
      const trimmed = sql.trim();
      let m: RegExpExecArray | null;

      if ((m = /^DELETE FROM (\w+) WHERE report_id = \? AND section = \?$/i.exec(trimmed))) {
        const table = m[1]!;
        const [reportId, section] = params as string[];
        const before = tables[table]!.length;
        tables[table] = tables[table]!.filter(
          (r) => !(r.report_id === reportId && r.section === section),
        );
        return { changes: before - tables[table]!.length };
      }

      if ((m = /^DELETE FROM (\w+) WHERE report_id = \?$/i.exec(trimmed))) {
        const table = m[1]!;
        const [reportId] = params as string[];
        const before = tables[table]!.length;
        tables[table] = tables[table]!.filter((r) => r.report_id !== reportId);
        return { changes: before - tables[table]!.length };
      }

      if ((m = /^UPDATE (\w+) SET report_id = \? WHERE report_id = \?$/i.exec(trimmed))) {
        const table = m[1]!;
        const [winnerId, loserId] = params as string[];
        let changes = 0;
        for (const row of tables[table] ?? []) {
          if (row.report_id === loserId) {
            row.report_id = winnerId;
            changes++;
          }
        }
        return { changes };
      }

      if (/^DELETE FROM sync_mutations WHERE client_id = \?$/i.test(trimmed)) {
        const [clientId] = params as string[];
        const before = tables.sync_mutations!.length;
        tables.sync_mutations = tables.sync_mutations!.filter((r) => r.client_id !== clientId);
        return { changes: before - tables.sync_mutations!.length };
      }

      if (
        /^UPDATE sync_mutations SET client_id = \?, payload = \? WHERE client_id = \?$/i.test(
          trimmed,
        )
      ) {
        const [newClientId, payload, oldClientId] = params as string[];
        const row = tables.sync_mutations!.find((r) => r.client_id === oldClientId);
        if (!row) return { changes: 0 };
        row.client_id = newClientId;
        row.payload = payload;
        return { changes: 1 };
      }

      if (/^UPDATE OR REPLACE daily_reports SET id = \? WHERE id = \?$/i.test(trimmed)) {
        const [winnerId, loserId] = params as string[];
        const loser = tables.daily_reports!.find((r) => r.id === loserId);
        if (!loser) return { changes: 0 };
        tables.daily_reports = tables.daily_reports!.filter((r) => r.id !== winnerId);
        loser.id = winnerId;
        return { changes: 1 };
      }

      return { changes: 0 };
    },
    async getAllAsync<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
      const trimmed = sql.trim();
      if (/^SELECT section FROM report_sections WHERE report_id = \?$/i.test(trimmed)) {
        const [reportId] = params as string[];
        return tables.report_sections!.filter((r) => r.report_id === reportId) as unknown as T[];
      }
      if (/^SELECT report_id FROM report_weather WHERE report_id = \?$/i.test(trimmed)) {
        const [reportId] = params as string[];
        return tables.report_weather!.filter((r) => r.report_id === reportId) as unknown as T[];
      }
      if (/^SELECT \* FROM sync_mutations$/i.test(trimmed)) {
        return tables.sync_mutations as unknown as T[];
      }
      return [] as T[];
    },
    async getFirstAsync<T>(): Promise<T | null> {
      return null;
    },
    async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
      await fn();
    },
  };
}

function enqueue(db: ReturnType<typeof fakeDb>, m: Mutation): void {
  db.tables.sync_mutations!.push({
    client_id: m.clientId,
    kind: m.payload.kind,
    payload: JSON.stringify(m.payload),
    created_at: m.createdAt,
    attempts: m.attempts,
    status: m.status,
    last_error: m.lastError,
    revision: m.revision,
  });
}

function updateSectionMutation(reportId: string, section: string, tag: string): Mutation {
  const payload = {
    kind: 'update_section',
    data: { reportId, section, content: { entries: [tag] }, isComplete: false },
  } as unknown as MutationPayload;
  return newMutation(`${reportId}:${section}`, payload, '2026-07-19T00:00:00.000Z');
}

function addPhotoMutation(reportId: string, photoId: string): Mutation {
  const payload = {
    kind: 'add_photo',
    data: {
      photoId,
      reportId,
      projectId: 'proj1',
      storagePath: `proj1/${reportId}/${photoId}.jpg`,
      localUri: 'file:///photo.jpg',
      width: 100,
      height: 100,
      capturedAt: null,
      exifDateTimeOriginal: null,
      gpsLat: null,
      gpsLng: null,
      gpsAccuracy: null,
      source: 'camera',
      tradeTag: null,
      locationTag: null,
      caption: null,
    },
  } as unknown as MutationPayload;
  return newMutation(photoId, payload, '2026-07-19T00:00:00.000Z');
}

function createReportMutation(reportId: string): Mutation {
  const payload = {
    kind: 'create_report',
    data: {
      reportId,
      projectId: 'proj1',
      reportDate: '2026-07-19',
      carryForwardSourceReportId: null,
    },
  } as unknown as MutationPayload;
  return newMutation(reportId, payload, '2026-07-19T00:00:00.000Z');
}

function payloadOf(row: FakeRow): { data: Record<string, unknown> } {
  return JSON.parse(row.payload as string) as { data: Record<string, unknown> };
}

const LOSER = 'loser-id';
const WINNER = 'winner-id';

describe('reparentReport', () => {
  // (a) child rewrite
  it('rewrites every report_id-keyed child table row from loser to winner', async () => {
    const db = fakeDb();
    db.tables.daily_reports!.push({ id: LOSER, status: 'draft' });
    db.tables.report_sections!.push({ report_id: LOSER, section: 'crew', payload: '{}' });
    db.tables.report_weather!.push({ report_id: LOSER });
    db.tables.report_photos!.push({ id: 'ph1', report_id: LOSER });
    db.tables.report_amendments!.push({ id: 'am1', report_id: LOSER });
    db.tables.report_crew!.push({ id: 'c1', report_id: LOSER });
    db.tables.report_equipment!.push({ id: 'e1', report_id: LOSER });
    db.tables.report_work_performed!.push({ id: 'w1', report_id: LOSER });
    db.tables.report_delays!.push({ id: 'd1', report_id: LOSER });
    db.tables.report_safety_observations!.push({ id: 's1', report_id: LOSER });

    await reparentReport(db as never, LOSER, WINNER);

    expect(db.tables.report_sections![0]!.report_id).toBe(WINNER);
    expect(db.tables.report_weather![0]!.report_id).toBe(WINNER);
    expect(db.tables.report_photos![0]!.report_id).toBe(WINNER);
    expect(db.tables.report_amendments![0]!.report_id).toBe(WINNER);
    expect(db.tables.report_crew![0]!.report_id).toBe(WINNER);
    expect(db.tables.report_equipment![0]!.report_id).toBe(WINNER);
    expect(db.tables.report_work_performed![0]!.report_id).toBe(WINNER);
    expect(db.tables.report_delays![0]!.report_id).toBe(WINNER);
    expect(db.tables.report_safety_observations![0]!.report_id).toBe(WINNER);
  });

  // (b) queued section mutation payload+client_id rewrite
  it('rewrites a queued update_section mutation payload.reportId and its coalesced client_id', async () => {
    const db = fakeDb();
    db.tables.daily_reports!.push({ id: LOSER });
    enqueue(db, updateSectionMutation(LOSER, 'crew', 'tag'));

    await reparentReport(db as never, LOSER, WINNER);

    expect(db.tables.sync_mutations).toHaveLength(1);
    const row = db.tables.sync_mutations![0]!;
    expect(row.client_id).toBe(`${WINNER}:crew`);
    expect(payloadOf(row).data.reportId).toBe(WINNER);
  });

  // (c) queued add_photo reportId+storagePath rewrite
  it('rewrites a queued add_photo mutation reportId and storagePath, leaving client_id (photoId) untouched', async () => {
    const db = fakeDb();
    db.tables.daily_reports!.push({ id: LOSER });
    enqueue(db, addPhotoMutation(LOSER, 'photo1'));

    await reparentReport(db as never, LOSER, WINNER);

    expect(db.tables.sync_mutations).toHaveLength(1);
    const row = db.tables.sync_mutations![0]!;
    expect(row.client_id).toBe('photo1'); // not reportId-prefixed — untouched
    const data = payloadOf(row).data;
    expect(data.reportId).toBe(WINNER);
    expect(data.storagePath).toBe(`proj1/${WINNER}/photo1.jpg`);
  });

  // (d) unrelated reports untouched
  it('leaves rows and queued mutations for unrelated reports untouched', async () => {
    const db = fakeDb();
    db.tables.daily_reports!.push({ id: LOSER }, { id: 'other-report' });
    db.tables.report_sections!.push({ report_id: 'other-report', section: 'crew', payload: '{}' });
    enqueue(db, updateSectionMutation('other-report', 'crew', 'tag'));

    await reparentReport(db as never, LOSER, WINNER);

    expect(db.tables.report_sections).toEqual([
      { report_id: 'other-report', section: 'crew', payload: '{}' },
    ]);
    expect(db.tables.sync_mutations![0]!.client_id).toBe('other-report:crew');
    expect(db.tables.daily_reports!.find((r) => r.id === 'other-report')).toBeTruthy();
  });

  // (e) winner-keyed queue row collision -> loser payload survives
  it('drops a pre-existing winner-keyed queue row and keeps the re-homed loser payload', async () => {
    const db = fakeDb();
    db.tables.daily_reports!.push({ id: LOSER });
    enqueue(db, updateSectionMutation(WINNER, 'crew', 'winners-own-edit'));
    enqueue(db, updateSectionMutation(LOSER, 'crew', 'losers-edit'));

    await reparentReport(db as never, LOSER, WINNER);

    expect(db.tables.sync_mutations).toHaveLength(1);
    const row = db.tables.sync_mutations![0]!;
    expect(row.client_id).toBe(`${WINNER}:crew`);
    expect(payloadOf(row).data).toMatchObject({ content: { entries: ['losers-edit'] } });
  });

  // (f) winner absent locally -> report row renamed, queryable under winner id
  it('renames the report row to the winner id when the winner is not present locally', async () => {
    const db = fakeDb();
    db.tables.daily_reports!.push({ id: LOSER, status: 'draft' });

    await reparentReport(db as never, LOSER, WINNER);

    expect(db.tables.daily_reports).toHaveLength(1);
    expect(db.tables.daily_reports![0]).toMatchObject({ id: WINNER, status: 'draft' });
  });

  // (g) winner present locally -> single row, loser content kept, winner's
  // colliding section/weather/child rows removed
  it('keeps a single report row with loser content when the winner exists locally, dropping winner-side collisions', async () => {
    const db = fakeDb();
    db.tables.daily_reports!.push(
      { id: LOSER, status: 'submitted' },
      { id: WINNER, status: 'draft' },
    );
    // Both sides have a 'crew' section + report_crew rows — winner's must be dropped.
    db.tables.report_sections!.push(
      { report_id: LOSER, section: 'crew', payload: 'loser-crew' },
      { report_id: WINNER, section: 'crew', payload: 'winner-crew' },
      { report_id: WINNER, section: 'delays', payload: 'winner-delays' }, // unrelated, must survive
    );
    db.tables.report_crew!.push(
      { id: 'loser-c1', report_id: LOSER },
      { id: 'winner-c1', report_id: WINNER },
    );
    db.tables.report_weather!.push({ report_id: LOSER, override_condition: 'sunny' });
    db.tables.report_weather!.push({ report_id: WINNER, override_condition: 'rainy' });

    await reparentReport(db as never, LOSER, WINNER);

    expect(db.tables.daily_reports).toHaveLength(1);
    expect(db.tables.daily_reports![0]).toMatchObject({ id: WINNER, status: 'submitted' });

    expect(db.tables.report_sections).toHaveLength(2); // loser's crew + winner's untouched delays
    const crew = db.tables.report_sections!.find((r) => r.section === 'crew')!;
    expect(crew).toMatchObject({ report_id: WINNER, payload: 'loser-crew' });
    const delays = db.tables.report_sections!.find((r) => r.section === 'delays')!;
    expect(delays).toMatchObject({ report_id: WINNER, payload: 'winner-delays' });

    expect(db.tables.report_crew).toHaveLength(1); // winner's colliding row removed
    expect(db.tables.report_crew![0]).toMatchObject({ id: 'loser-c1', report_id: WINNER });

    expect(db.tables.report_weather).toHaveLength(1); // winner's collision removed
    expect(db.tables.report_weather![0]).toMatchObject({
      report_id: WINNER,
      override_condition: 'sunny',
    });
  });

  // (h) idempotency: running reparentReport twice leaves the winner subtree intact
  it('is idempotent — a second call after a crash-before-queue-remove leaves the winner subtree intact', async () => {
    const db = fakeDb();
    db.tables.daily_reports!.push(
      { id: LOSER, status: 'submitted' },
      { id: WINNER, status: 'draft' },
    );
    db.tables.report_sections!.push({ report_id: LOSER, section: 'crew', payload: 'loser-crew' });
    db.tables.report_crew!.push({ id: 'loser-c1', report_id: LOSER });
    enqueue(db, createReportMutation(LOSER)); // simulates: reparent committed, queue-remove hadn't run yet

    await reparentReport(db as never, LOSER, WINNER);
    const afterFirst = JSON.parse(JSON.stringify(db.tables)) as typeof db.tables;

    // create_report re-pushes (idempotent RPC), returns the same winner again.
    await reparentReport(db as never, LOSER, WINNER);

    expect(db.tables.daily_reports).toEqual(afterFirst.daily_reports);
    expect(db.tables.report_sections).toEqual(afterFirst.report_sections);
    expect(db.tables.report_crew).toEqual(afterFirst.report_crew);
    // The re-homed subtree must still exist under the winner — a naive
    // blanket `DELETE ... WHERE report_id = winner` on the second call would
    // have wiped it instead of leaving it alone.
    expect(db.tables.report_sections).toHaveLength(1);
    expect(db.tables.report_sections![0]).toMatchObject({
      report_id: WINNER,
      payload: 'loser-crew',
    });
    expect(db.tables.report_crew).toHaveLength(1);
    expect(db.tables.report_crew![0]).toMatchObject({ report_id: WINNER });
  });
});
