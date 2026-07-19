import { createSqliteRepo } from './sqliteRepo.native';
import type { MutationStore } from '../sync/types';

// ── In-memory Db fake ─────────────────────────────────────────────────────────
// Table-aware stand-in for expo-sqlite: it recognizes the exact statements the
// repo issues (incl. ON CONFLICT upserts and the has_delay/has_incident
// recompute) so writes are observable by inspecting the exposed table stores.
type Row = Record<string, unknown>;

function fakeDb(seed: { projects?: Row[]; daily_reports?: Row[] } = {}) {
  const tables: Record<string, Row[]> = {
    projects: seed.projects ?? [],
    daily_reports: seed.daily_reports ?? [],
    report_weather: [],
    report_sections: [],
    report_crew: [],
    report_equipment: [],
    report_work_performed: [],
    report_delays: [],
    report_safety_observations: [],
  };

  async function runAsync(sql: string, params: readonly unknown[] = []): Promise<void> {
    if (/INSERT INTO daily_reports/i.test(sql)) {
      const [id, project_id, report_date] = params as string[];
      tables.daily_reports.push({ id, project_id, report_date, status: 'draft', _dirty: 1, has_delay: 0, has_incident: 0 });
    } else if (/INSERT OR IGNORE INTO report_weather/i.test(sql)) {
      const [report_id] = params as string[];
      if (!tables.report_weather.some((r) => r.report_id === report_id)) {
        tables.report_weather.push({ report_id, weather_source: 'none', _dirty: 0 });
      }
    } else if (/INSERT INTO report_weather/i.test(sql)) {
      const [report_id, override_condition, override_temp_f] = params as unknown[];
      const existing = tables.report_weather.find((r) => r.report_id === report_id);
      const next = { report_id, weather_source: 'manual', override_condition, override_temp_f, _dirty: 1 };
      if (existing) Object.assign(existing, next);
      else tables.report_weather.push(next);
    } else if (/INSERT INTO report_sections/i.test(sql)) {
      const [report_id, section, payload, is_complete] = params as unknown[];
      const key = (r: Row) => r.report_id === report_id && r.section === section;
      const existing = tables.report_sections.find(key);
      const next = { report_id, section, payload, is_complete, _dirty: 1 };
      if (existing) Object.assign(existing, next);
      else tables.report_sections.push(next);
    } else if (/^\s*DELETE FROM (\w+) WHERE report_id/i.test(sql)) {
      const table = (sql.match(/DELETE FROM (\w+)/i) as RegExpMatchArray)[1];
      const [report_id] = params as string[];
      tables[table] = tables[table].filter((r) => r.report_id !== report_id);
    } else if (/INSERT INTO report_crew/i.test(sql)) {
      const [id, report_id, trade, headcount, hours, is_carried_forward] = params as unknown[];
      tables.report_crew.push({ id, report_id, trade, headcount, hours, is_carried_forward });
    } else if (/INSERT INTO report_equipment/i.test(sql)) {
      const [id, report_id, name, status, on_site] = params as unknown[];
      tables.report_equipment.push({ id, report_id, name, status, on_site });
    } else if (/INSERT INTO report_work_performed/i.test(sql)) {
      const [id, report_id, trade, area, note] = params as unknown[];
      tables.report_work_performed.push({ id, report_id, trade, area, note });
    } else if (/INSERT INTO report_delays/i.test(sql)) {
      const [id, report_id, cause, responsible_party, duration_hours, is_ongoing, note] = params as unknown[];
      tables.report_delays.push({ id, report_id, cause, responsible_party, duration_hours, is_ongoing, note });
    } else if (/INSERT INTO report_safety_observations/i.test(sql)) {
      const [id, report_id, obs_type, description, is_incident] = params as unknown[];
      tables.report_safety_observations.push({ id, report_id, obs_type, description, is_incident });
    } else if (/UPDATE daily_reports[\s\S]*has_delay/i.test(sql)) {
      const [reportId] = params as string[];
      const dr = tables.daily_reports.find((r) => r.id === reportId);
      if (dr) dr.has_delay = tables.report_delays.some((r) => r.report_id === reportId) ? 1 : 0;
    } else if (/UPDATE daily_reports[\s\S]*has_incident/i.test(sql)) {
      const [reportId] = params as string[];
      const dr = tables.daily_reports.find((r) => r.id === reportId);
      if (dr) dr.has_incident = tables.report_safety_observations.some((r) => r.report_id === reportId && r.is_incident === 1) ? 1 : 0;
    }
  }

  return {
    tables,
    getAllAsync: async (sql: string): Promise<Row[]> => (/FROM projects/i.test(sql) ? tables.projects : []),
    getFirstAsync: async (sql: string, params: readonly unknown[] = []): Promise<Row | null> => {
      if (!/FROM daily_reports/i.test(sql)) return null;
      if (/WHERE id = \?/i.test(sql)) {
        const [id] = params;
        return tables.daily_reports.find((r) => r.id === id) ?? null;
      }
      const [projectId, reportDate] = params;
      return tables.daily_reports.find((r) => r.project_id === projectId && r.report_date === reportDate) ?? null;
    },
    runAsync,
    withTransactionAsync: async (fn: () => Promise<void>): Promise<void> => fn(),
  };
}

// ── In-memory MutationStore fake ──────────────────────────────────────────────
function fakeMutations(): MutationStore & { map: Map<string, unknown>; kinds: string[] } {
  const map = new Map<string, { clientId: string; status: string; attempts: number; lastError: string | null; payload: unknown }>();
  const kinds: string[] = [];
  return {
    map,
    kinds,
    async enqueue(m) {
      kinds.push('enqueue');
      if (!map.has(m.clientId)) {
        map.set(m.clientId, { clientId: m.clientId, status: m.status, attempts: m.attempts, lastError: m.lastError, payload: m.payload });
      }
    },
    async enqueueCoalescing(m) {
      kinds.push('coalesce');
      map.set(m.clientId, { clientId: m.clientId, status: 'pending', attempts: 0, lastError: null, payload: m.payload });
    },
    async pending() {
      return [...map.values()].filter((m) => m.status === 'pending') as never;
    },
    async all() {
      return [...map.values()] as never;
    },
    async replace(m) {
      map.set(m.clientId, { clientId: m.clientId, status: m.status, attempts: m.attempts, lastError: m.lastError, payload: m.payload });
    },
    async remove(id) {
      map.delete(id);
    },
    async unpark(id) {
      const m = map.get(id);
      if (m) map.set(id, { ...m, status: 'pending', attempts: 0, lastError: null });
    },
  };
}

describe('sqliteRepo reads', () => {
  it('lists projects', async () => {
    const repo = createSqliteRepo(
      fakeDb({ projects: [{ id: 'p1', name: 'Site A', address: null, timezone: null, lat: null, lng: null }] }) as never,
      fakeMutations(),
    );
    expect(await repo.listProjects()).toEqual([
      { id: 'p1', name: 'Site A', address: null, timezone: null, lat: null, lng: null },
    ]);
  });

  it('getReportByDate returns the matching row or null', async () => {
    const report = { id: 'r1', project_id: 'p1', report_date: '2026-07-18', status: 'draft' };
    const repo = createSqliteRepo(fakeDb({ daily_reports: [report] }) as never, fakeMutations());
    expect(await repo.getReportByDate('p1', '2026-07-18')).toEqual(report);
    expect(await repo.getReportByDate('p1', '2026-07-19')).toBeNull();
  });
});

describe('sqliteRepo createReport', () => {
  it('(a) writes a dirty draft row and enqueues create_report atomically', async () => {
    const db = fakeDb();
    const mutations = fakeMutations();
    const repo = createSqliteRepo(db as never, mutations);
    const row = await repo.createReport('p1', '2026-07-19');

    expect(row).toMatchObject({ project_id: 'p1', report_date: '2026-07-19', status: 'draft' });
    const stored = db.tables.daily_reports.find((r) => r.id === row.id);
    expect(stored?._dirty).toBe(1);
    // clientId of a create_report is the report id (doc 06 §A).
    const m = mutations.map.get(row.id) as { payload: { kind: string; data: { reportId: string } } };
    expect(m.payload.kind).toBe('create_report');
    expect(m.payload.data.reportId).toBe(row.id);
  });

  it('(b) get-or-create returns the existing row without enqueuing', async () => {
    const existing = { id: 'r1', project_id: 'p1', report_date: '2026-07-19', status: 'draft' };
    const db = fakeDb({ daily_reports: [existing] });
    const mutations = fakeMutations();
    const repo = createSqliteRepo(db as never, mutations);
    const row = await repo.createReport('p1', '2026-07-19');
    expect(row).toEqual(existing);
    expect(mutations.map.size).toBe(0);
    expect(db.tables.daily_reports).toHaveLength(1);
  });
});

describe('sqliteRepo updateSection', () => {
  it('(c) weather routes to report_weather.override_* (not report_sections)', async () => {
    const db = fakeDb();
    const repo = createSqliteRepo(db as never, fakeMutations());
    await repo.updateSection('r1', 'weather', { condition: 'Rain', tempF: 55 }, false);
    expect(db.tables.report_sections).toHaveLength(0);
    expect(db.tables.report_weather[0]).toMatchObject({
      report_id: 'r1',
      weather_source: 'manual',
      override_condition: 'Rain',
      override_temp_f: 55,
      _dirty: 1,
    });
  });

  it('(d) crew explode delete-and-inserts child rows', async () => {
    const db = fakeDb();
    const repo = createSqliteRepo(db as never, fakeMutations());
    await repo.updateSection(
      'r1',
      'crew',
      { rows: [{ id: 'c1', trade: 'Electrician', headcount: 3, hours: 8, is_carried_forward: false }] },
      false,
    );
    expect(db.tables.report_crew).toEqual([
      { id: 'c1', report_id: 'r1', trade: 'Electrician', headcount: 3, hours: 8, is_carried_forward: 0 },
    ]);
    // A second full-replacement edit replaces the child rows, never appends.
    await repo.updateSection(
      'r1',
      'crew',
      { rows: [{ id: 'c2', trade: 'Plumber', headcount: 1, hours: 4, is_carried_forward: false }] },
      false,
    );
    expect(db.tables.report_crew.map((r) => r.id)).toEqual(['c2']);
  });

  it('(e) recomputes has_delay and has_incident from the exploded child rows', async () => {
    const db = fakeDb({ daily_reports: [{ id: 'r1', project_id: 'p1', report_date: '2026-07-19', status: 'draft', has_delay: 0, has_incident: 0 }] });
    const repo = createSqliteRepo(db as never, fakeMutations());

    await repo.updateSection('r1', 'delays', { rows: [{ id: 'd1', cause: 'Weather', is_ongoing: false }] }, false);
    expect(db.tables.daily_reports[0].has_delay).toBe(1);

    await repo.updateSection('r1', 'safety', { rows: [{ id: 's1', obs_type: 'incident', is_incident: true }] }, false);
    expect(db.tables.daily_reports[0].has_incident).toBe(1);

    // Clearing the section flips the flag back off.
    await repo.updateSection('r1', 'delays', { rows: [] }, true);
    expect(db.tables.daily_reports[0].has_delay).toBe(0);
  });

  it('(f) coalescing: two edits to one section leave ONE pending mutation with the latest payload', async () => {
    const db = fakeDb();
    const mutations = fakeMutations();
    const repo = createSqliteRepo(db as never, mutations);
    await repo.updateSection('r1', 'deliveries', { entries: ['first'] }, false);
    await repo.updateSection('r1', 'deliveries', { entries: ['second'] }, false);

    expect(mutations.map.size).toBe(1);
    const m = mutations.map.get('r1:deliveries') as { status: string; payload: { data: { content: { entries: string[] } } } };
    expect(m.status).toBe('pending');
    expect(m.payload.data.content.entries).toEqual(['second']);
    expect(mutations.kinds.every((k) => k === 'coalesce')).toBe(true);
  });
});
