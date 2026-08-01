/**
 * Tier-1 reference snapshot applier, against an in-memory Db fake (no real
 * SQLite — jest-expo can't open a device database). The fake records every
 * `runAsync`/`getAllAsync` call and counts `withTransactionAsync` entries so
 * tests can assert the whole replace happens inside ONE transaction.
 */
import {
  applyReferenceSnapshot,
  applyReports,
  applySections,
  applyPhotos,
  applyAmendments,
  heldStatusReportIds,
} from './pullTables.native';
import type {
  ReferenceSnapshot,
  PulledReportBundle,
  PulledSection,
  PulledAmendment,
} from './pullTables.native';
import type { Db } from '../db/rows.native';

type Row = Record<string, unknown>;

interface Seed {
  readonly projects?: readonly Row[];
  readonly project_members?: readonly Row[];
  readonly report_member_prefs?: readonly Row[];
  readonly profiles?: readonly Row[];
}

/** Minimal SQLite stand-in: recognizes only the statements this applier issues. */
function fakeDb(seed: Seed = {}) {
  const tables: Record<string, Row[]> = {
    projects: seed.projects ? [...seed.projects] : [],
    project_members: seed.project_members ? [...seed.project_members] : [],
    report_member_prefs: seed.report_member_prefs ? [...seed.report_member_prefs] : [],
    profiles: seed.profiles ? [...seed.profiles] : [],
  };
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  let txCount = 0;

  async function getAllAsync<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    calls.push({ sql, params });
    if (/SELECT project_id FROM project_members WHERE user_id = \?/i.test(sql)) {
      const [userId] = params as string[];
      return tables.project_members
        .filter((r) => r.user_id === userId)
        .map((r) => ({ project_id: r.project_id })) as unknown as T[];
    }
    const m = sql.match(/^SELECT \* FROM (\w+)/i);
    if (m) return [...tables[m[1]]] as unknown as T[];
    return [] as T[];
  }

  async function runAsync(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<{ changes: number }> {
    calls.push({ sql, params });
    const del = sql.match(/^DELETE FROM (\w+)/i);
    if (del) {
      const n = tables[del[1]].length;
      tables[del[1]] = [];
      return { changes: n };
    }
    const ins = sql.match(/^INSERT INTO (\w+) \(([^)]+)\)/i);
    if (ins) {
      const table = ins[1];
      const cols = ins[2].split(',').map((c) => c.trim());
      const row: Row = {};
      cols.forEach((c, i) => (row[c] = (params as unknown[])[i]));
      tables[table].push(row);
      return { changes: 1 };
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
      await fn();
    },
  };
}

function snapshot(overrides: Partial<ReferenceSnapshot> = {}): ReferenceSnapshot {
  return {
    projects: [],
    members: [],
    prefs: [],
    profiles: [],
    ...overrides,
  };
}

describe('applyReferenceSnapshot', () => {
  it('full replace removes stale local rows', async () => {
    const db = fakeDb({
      projects: [
        {
          id: 'p-old',
          name: 'Old Project',
          address: null,
          created_by: null,
          created_at: null,
          company_id: null,
          code_prefix: null,
          timezone: null,
          lat: null,
          lng: null,
          geocode_source: null,
          geocoded_at: null,
        },
      ],
    });
    await applyReferenceSnapshot(
      db as unknown as Db,
      'u1',
      snapshot({
        projects: [{ id: 'p-new', name: 'New Project' }],
      }),
    );
    expect(db.tables.projects).toHaveLength(1);
    expect(db.tables.projects[0].id).toBe('p-new');
  });

  it('replaces prefs in the same tx as members', async () => {
    const db = fakeDb();
    await applyReferenceSnapshot(
      db as unknown as Db,
      'u1',
      snapshot({
        members: [{ project_id: 'p1', user_id: 'u1', role: 'member', created_at: 't' }],
        prefs: [{ project_id: 'p1', user_id: 'u1', title: 'Foreman' }],
      }),
    );
    expect(db.txCount).toBe(1);
    const tables = db.calls
      .filter((c) => /^(DELETE|INSERT)/i.test(c.sql))
      .map((c) => (c.sql.match(/(?:FROM|INTO) (\w+)/i) as RegExpMatchArray)[1]);
    expect(tables).toContain('project_members');
    expect(tables).toContain('report_member_prefs');
  });

  it('runs the whole replace inside exactly one transaction', async () => {
    const db = fakeDb();
    await applyReferenceSnapshot(db as unknown as Db, 'u1', snapshot());
    expect(db.txCount).toBe(1);
  });

  it('computes before/after project id diff, including first-sync empty-before', async () => {
    const db = fakeDb(); // no seeded project_members: first sync
    const diff = await applyReferenceSnapshot(
      db as unknown as Db,
      'u1',
      snapshot({
        members: [
          { project_id: 'p1', user_id: 'u1', role: 'member', created_at: 't' },
          { project_id: 'p2', user_id: 'u2', role: 'member', created_at: 't' },
        ],
      }),
    );
    expect(diff.beforeProjectIds).toEqual([]);
    expect(diff.afterProjectIds).toEqual(['p1']);
  });

  it('computes beforeProjectIds from pre-replace local rows for the session user', async () => {
    const db = fakeDb({
      project_members: [
        { project_id: 'p0', user_id: 'u1', role: 'member', created_at: 't' },
        { project_id: 'p9', user_id: 'other', role: 'member', created_at: 't' },
      ],
    });
    const diff = await applyReferenceSnapshot(
      db as unknown as Db,
      'u1',
      snapshot({
        members: [{ project_id: 'p1', user_id: 'u1', role: 'member', created_at: 't' }],
      }),
    );
    expect(diff.beforeProjectIds).toEqual(['p0']);
    expect(diff.afterProjectIds).toEqual(['p1']);
  });

  it('drops unknown server keys', async () => {
    const db = fakeDb();
    await applyReferenceSnapshot(
      db as unknown as Db,
      'u1',
      snapshot({
        projects: [{ id: 'p1', name: 'A', mystery_field: 'nope' }],
      }),
    );
    expect(db.tables.projects[0]).not.toHaveProperty('mystery_field');
    expect(db.tables.projects[0].id).toBe('p1');
  });

  it('writes NULL for a column missing from the snapshot row', async () => {
    const db = fakeDb();
    await applyReferenceSnapshot(
      db as unknown as Db,
      'u1',
      snapshot({
        projects: [{ id: 'p1', name: 'A' }], // no `lat`
      }),
    );
    expect(db.tables.projects[0].lat).toBeNull();
  });

  it('changed is false for a byte-identical re-pulled snapshot', async () => {
    const projectRow = {
      id: 'p1',
      name: 'A',
      address: null,
      created_by: null,
      created_at: 't',
      company_id: null,
      code_prefix: null,
      timezone: null,
      lat: null,
      lng: null,
      geocode_source: null,
      geocoded_at: null,
    };
    const memberRow = { project_id: 'p1', user_id: 'u1', role: 'member', created_at: 't' };
    const prefRow = { project_id: 'p1', user_id: 'u1', title: 'Foreman' };
    const profileRow = {
      id: 'u1',
      full_name: 'A',
      email: 'a@a.com',
      phone: null,
      company: null,
      trade: null,
      avatar_url: null,
      expo_push_token: null,
      created_at: 't',
    };

    const db = fakeDb({
      projects: [projectRow],
      project_members: [memberRow],
      report_member_prefs: [prefRow],
      profiles: [profileRow],
    });

    const diff = await applyReferenceSnapshot(
      db as unknown as Db,
      'u1',
      snapshot({
        projects: [projectRow],
        members: [memberRow],
        prefs: [prefRow],
        profiles: [profileRow],
      }),
    );

    expect(diff.changed).toBe(false);
  });

  it('changed is true when a row is added to any of the four tables', async () => {
    const memberRow = { project_id: 'p1', user_id: 'u1', role: 'member', created_at: 't' };
    const db = fakeDb({ project_members: [memberRow] });

    const diff = await applyReferenceSnapshot(
      db as unknown as Db,
      'u1',
      snapshot({
        members: [memberRow, { project_id: 'p2', user_id: 'u1', role: 'member', created_at: 't' }],
      }),
    );

    expect(diff.changed).toBe(true);
  });

  it('changed is true when a column value differs on an otherwise-identical row', async () => {
    const prefRow = { project_id: 'p1', user_id: 'u1', title: 'Foreman' };
    const db = fakeDb({ report_member_prefs: [prefRow] });

    const diff = await applyReferenceSnapshot(
      db as unknown as Db,
      'u1',
      snapshot({
        prefs: [{ project_id: 'p1', user_id: 'u1', title: 'Superintendent' }],
      }),
    );

    expect(diff.changed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyReports / applySections — dirty shield + ride-alongs
// ---------------------------------------------------------------------------

/**
 * In-memory stand-in for `daily_reports` / `report_weather` / `report_sections`
 * / `report_crew`. Parses the SQL generically (column lists off INSERT/SELECT)
 * so it doesn't need one branch per exact query string, and records every
 * `withTransactionAsync` entry so tests can assert one tx per CALL.
 */
function fakeReportDb(
  seed: {
    daily_reports?: readonly Row[];
    report_weather?: readonly Row[];
    report_sections?: readonly Row[];
    report_crew?: readonly Row[];
    report_photos?: readonly Row[];
    report_amendments?: readonly Row[];
    report_amendment_changes?: readonly Row[];
    sync_mutations?: readonly Row[];
  } = {},
) {
  const sync_mutations: Row[] = (seed.sync_mutations ?? []).map((r) => ({ ...r }));
  const daily_reports = new Map<string, Row>();
  (seed.daily_reports ?? []).forEach((r) => daily_reports.set(`${r.id}`, { ...r }));
  const report_weather = new Map<string, Row>();
  (seed.report_weather ?? []).forEach((r) => report_weather.set(`${r.report_id}`, { ...r }));
  const report_sections = new Map<string, Row>();
  (seed.report_sections ?? []).forEach((r) =>
    report_sections.set(`${r.report_id}:${r.section}`, { ...r }),
  );
  let report_crew: Row[] = (seed.report_crew ?? []).map((r) => ({ ...r }));
  const report_photos = new Map<string, Row>();
  (seed.report_photos ?? []).forEach((r) => report_photos.set(`${r.id}`, { ...r }));
  const report_amendments = new Map<string, Row>();
  (seed.report_amendments ?? []).forEach((r) => report_amendments.set(`${r.id}`, { ...r }));
  let report_amendment_changes: Row[] = (seed.report_amendment_changes ?? []).map((r) => ({
    ...r,
  }));

  const calls: { sql: string; params: readonly unknown[] }[] = [];
  let txCount = 0;

  async function getFirstAsync<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    calls.push({ sql, params });
    const m = sql.match(/SELECT (.+?) FROM (\w+) WHERE (.+)/is);
    if (!m) return null;
    const [, colsRaw, table] = m;
    const cols = colsRaw.split(',').map((c) => c.trim());
    let row: Row | undefined;
    if (table === 'daily_reports') row = daily_reports.get(`${params[0]}`);
    else if (table === 'report_weather') row = report_weather.get(`${params[0]}`);
    else if (table === 'report_sections') row = report_sections.get(`${params[0]}:${params[1]}`);
    else if (table === 'report_photos') row = report_photos.get(`${params[0]}`);
    else if (table === 'report_amendments') row = report_amendments.get(`${params[0]}`);
    if (!row) return null;
    const out: Row = {};
    for (const c of cols) out[c] = row[c] ?? null;
    return out as unknown as T;
  }

  async function getAllAsync<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    calls.push({ sql, params });
    const m = sql.match(/SELECT (.+?) FROM (\w+) WHERE (.+)/is);
    if (m) {
      const [, colsRaw, table] = m;
      if (table === 'report_amendment_changes') {
        const [amendmentId] = params as string[];
        const cols = colsRaw.split(',').map((c) => c.trim());
        return report_amendment_changes
          .filter((r) => r.amendment_id === amendmentId)
          .map((r) => {
            const out: Row = {};
            for (const c of cols) out[c] = r[c] ?? null;
            return out;
          }) as unknown as T[];
      }
      if (table === 'sync_mutations') {
        return sync_mutations
          .filter(
            (r) =>
              r.status === 'pending' &&
              (String(r.client_id).startsWith('submit:') ||
                String(r.client_id).startsWith('lock:')),
          )
          .map((r) => ({ client_id: r.client_id })) as unknown as T[];
      }
    }
    return [] as T[];
  }

  async function runAsync(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<{ changes: number }> {
    calls.push({ sql, params });

    if (/^UPDATE daily_reports SET status = \? WHERE id = \?/i.test(sql)) {
      const [status, id] = params as string[];
      const row = daily_reports.get(id);
      if (row) row.status = status;
      return { changes: row ? 1 : 0 };
    }
    if (/^UPDATE daily_reports\s+SET has_delay/i.test(sql)) return { changes: 0 };
    if (/^UPDATE daily_reports\s+SET has_incident/i.test(sql)) return { changes: 0 };

    const delById = sql.match(/^DELETE FROM report_photos WHERE id = \?/i);
    if (delById) {
      const [id] = params as string[];
      const existed = report_photos.has(`${id}`);
      report_photos.delete(`${id}`);
      return { changes: existed ? 1 : 0 };
    }

    const delByAmendment = sql.match(
      /^DELETE FROM report_amendment_changes WHERE amendment_id = \?/i,
    );
    if (delByAmendment) {
      const [amendmentId] = params as string[];
      const before = report_amendment_changes.length;
      report_amendment_changes = report_amendment_changes.filter(
        (r) => r.amendment_id !== amendmentId,
      );
      return { changes: before - report_amendment_changes.length };
    }

    const del = sql.match(/^DELETE FROM (\w+) WHERE report_id = \?/i);
    if (del) {
      const [reportId] = params as string[];
      if (del[1] === 'report_crew')
        report_crew = report_crew.filter((r) => r.report_id !== reportId);
      return { changes: 0 };
    }

    const ins = sql.match(/^INSERT INTO (\w+) \(([^)]+)\)/i);
    if (ins) {
      const table = ins[1];
      const cols = ins[2].split(',').map((c) => c.trim());
      const row: Row = {};
      cols.forEach((c, i) => (row[c] = (params as unknown[])[i]));

      if (table === 'daily_reports') {
        row._dirty = 0;
        daily_reports.set(`${row.id}`, row);
      } else if (table === 'report_weather') {
        const prior = report_weather.get(`${row.report_id}`);
        row._dirty = prior?._dirty ?? 0;
        report_weather.set(`${row.report_id}`, row);
      } else if (table === 'report_sections') {
        row._dirty = 0;
        report_sections.set(`${row.report_id}:${row.section}`, row);
      } else if (table === 'report_crew') {
        report_crew.push(row);
      } else if (table === 'report_photos') {
        // Mirrors SQLite's ON CONFLICT DO UPDATE SET semantics: the local-only
        // columns (_pending/_dirty/local_uri/local_thumb_uri) are outside the
        // applier's SET list, so an existing row keeps them untouched; only a
        // brand-new row gets the literal 0/0/null/null the applier inserts.
        const prior = report_photos.get(`${row.id}`);
        if (prior) {
          const merged: Row = { ...prior, ...row };
          merged._pending = prior._pending;
          merged._dirty = prior._dirty;
          merged.local_uri = prior.local_uri;
          merged.local_thumb_uri = prior.local_thumb_uri;
          report_photos.set(`${row.id}`, merged);
        } else {
          row._pending = 0;
          row._dirty = 0;
          report_photos.set(`${row.id}`, row);
        }
      } else if (table === 'report_amendments') {
        row._dirty = 0;
        report_amendments.set(`${row.id}`, row);
      } else if (table === 'report_amendment_changes') {
        report_amendment_changes.push(row);
      }
      return { changes: 1 };
    }

    return { changes: 0 };
  }

  return {
    daily_reports,
    report_weather,
    report_sections,
    report_photos,
    report_amendments,
    get report_crew(): readonly Row[] {
      return report_crew;
    },
    get report_amendment_changes(): readonly Row[] {
      return report_amendment_changes;
    },
    calls,
    get txCount(): number {
      return txCount;
    },
    getFirstAsync,
    getAllAsync,
    runAsync,
    async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
      txCount++;
      await fn();
    },
  };
}

function reportRow(overrides: Row = {}): Record<string, unknown> {
  return {
    id: 'r1',
    project_id: 'p1',
    report_date: '2026-07-01',
    status: 'draft',
    has_incident: false,
    has_delay: false,
    created_by: 'u1',
    created_at: '2026-07-01T00:00:00Z',
    submitted_by: null,
    submitted_at: null,
    locked_by: null,
    locked_at: null,
    updated_at: '2026-07-01T10:00:00Z',
    ...overrides,
  };
}

function reportBundle(overrides: Partial<PulledReportBundle> = {}): PulledReportBundle {
  return { report: reportRow(), weather: null, ...overrides };
}

describe('applyReports', () => {
  it('clean report (no local row) is inserted verbatim, _dirty = 0', async () => {
    const db = fakeReportDb();
    const result = await applyReports(db as unknown as Db, [
      reportBundle({ report: reportRow({ id: 'r1', status: 'submitted' }) }),
    ]);
    expect(result.applied).toBe(1);
    expect(result.hardSkipped).toBe(0);
    expect(result.cursorKeys).toEqual(['2026-07-01T10:00:00Z']);
    expect(db.daily_reports.get('r1')).toMatchObject({ status: 'submitted', _dirty: 0 });
  });

  it('holds the optimistic local status while a lifecycle mutation is pending for that report', async () => {
    const db = fakeReportDb({
      daily_reports: [{ id: 'r1', status: 'submitted', updated_at: 'T1', _dirty: 0 }],
    });
    const result = await applyReports(
      db as unknown as Db,
      [
        reportBundle({
          report: reportRow({ id: 'r1', status: 'draft', updated_at: 'T2' }),
        }),
      ],
      new Set(['r1']),
    );
    expect(db.daily_reports.get('r1')).toMatchObject({ status: 'submitted' });
    expect(result.cursorKeys).toContain('T2');
  });

  it('clean local report is replaced verbatim regardless of timestamps (server older)', async () => {
    const db = fakeReportDb({
      daily_reports: [{ id: 'r1', status: 'draft', updated_at: '2026-07-05T00:00:00Z', _dirty: 0 }],
    });
    const result = await applyReports(db as unknown as Db, [
      reportBundle({
        report: reportRow({ id: 'r1', status: 'submitted', updated_at: '2026-07-01T00:00:00Z' }),
      }),
    ]);
    expect(result.applied).toBe(1);
    expect(db.daily_reports.get('r1')).toMatchObject({
      status: 'submitted',
      updated_at: '2026-07-01T00:00:00Z',
      _dirty: 0,
    });
  });

  it('no-op rule: clean local row with identical updated_at is skipped (not written, applied unchanged, cursor credited)', async () => {
    const db = fakeReportDb({
      daily_reports: [{ id: 'r1', status: 'draft', updated_at: '2026-07-01T10:00:00Z', _dirty: 0 }],
    });
    const result = await applyReports(db as unknown as Db, [
      reportBundle({ report: reportRow({ id: 'r1', status: 'draft' }) }),
    ]);
    expect(result.applied).toBe(0);
    expect(result.cursorKeys).toEqual(['2026-07-01T10:00:00Z']);
    expect(db.calls.some((c) => /^INSERT INTO daily_reports/i.test(c.sql))).toBe(false);
    expect(db.calls.some((c) => /^UPDATE daily_reports SET status/i.test(c.sql))).toBe(false);
  });

  it('dirty report keeps local content but adopts server status — server NEWER than local', async () => {
    const db = fakeReportDb({
      daily_reports: [{ id: 'r1', status: 'draft', updated_at: '2026-07-01T00:00:00Z', _dirty: 1 }],
    });
    const result = await applyReports(db as unknown as Db, [
      reportBundle({
        report: reportRow({ id: 'r1', status: 'submitted', updated_at: '2026-07-05T00:00:00Z' }),
      }),
    ]);
    expect(result.applied).toBe(1);
    expect(result.cursorKeys).toEqual(['2026-07-05T00:00:00Z']);
    const local = db.daily_reports.get('r1');
    expect(local?.status).toBe('submitted');
    expect(local?.updated_at).toBe('2026-07-01T00:00:00Z'); // content/timestamp untouched — only status moved
    expect(local?._dirty).toBe(1);
  });

  it('dirty report keeps local content but adopts server status — server OLDER than local (timestamps must not matter)', async () => {
    const db = fakeReportDb({
      daily_reports: [{ id: 'r1', status: 'draft', updated_at: '2026-07-10T00:00:00Z', _dirty: 1 }],
    });
    const result = await applyReports(db as unknown as Db, [
      reportBundle({
        report: reportRow({ id: 'r1', status: 'submitted', updated_at: '2026-07-01T00:00:00Z' }),
      }),
    ]);
    expect(result.applied).toBe(1);
    const local = db.daily_reports.get('r1');
    expect(local?.status).toBe('submitted');
    expect(local?.updated_at).toBe('2026-07-10T00:00:00Z');
    expect(local?._dirty).toBe(1);
  });

  it('dirty report with same status as server: nothing changes, but timestamp still credited', async () => {
    const db = fakeReportDb({
      daily_reports: [{ id: 'r1', status: 'draft', updated_at: '2026-07-01T00:00:00Z', _dirty: 1 }],
    });
    const result = await applyReports(db as unknown as Db, [
      reportBundle({
        report: reportRow({ id: 'r1', status: 'draft', updated_at: '2026-07-09T00:00:00Z' }),
      }),
    ]);
    expect(result.applied).toBe(0);
    expect(result.cursorKeys).toEqual(['2026-07-09T00:00:00Z']);
    expect(db.calls.some((c) => /^UPDATE daily_reports SET status/i.test(c.sql))).toBe(false);
  });

  it('malformed report row (no id/status) is hardSkipped', async () => {
    const db = fakeReportDb();
    const result = await applyReports(db as unknown as Db, [
      reportBundle({ report: reportRow({ id: null }) }),
      reportBundle({ report: reportRow({ status: undefined }) }),
    ]);
    expect(result.hardSkipped).toBe(2);
    expect(result.applied).toBe(0);
  });

  it('report row missing project_id (NOT NULL locally) is hardSkipped; sibling rows still commit', async () => {
    const db = fakeReportDb();
    const result = await applyReports(db as unknown as Db, [
      reportBundle({ report: reportRow({ id: 'r-bad', project_id: null }) }),
      reportBundle({ report: reportRow({ id: 'r-bad-2', report_date: undefined }) }),
      reportBundle({ report: reportRow({ id: 'r-good' }) }),
    ]);
    expect(result.hardSkipped).toBe(2);
    expect(result.applied).toBe(1);
    expect(db.daily_reports.get('r-good')).toBeDefined();
    expect(db.daily_reports.get('r-bad')).toBeUndefined();
    expect(db.daily_reports.get('r-bad-2')).toBeUndefined();
  });

  it('weather rides the same tx on clean weather (no local weather row)', async () => {
    const db = fakeReportDb();
    const result = await applyReports(db as unknown as Db, [
      reportBundle({
        report: reportRow({ id: 'r1' }),
        weather: {
          report_id: 'r1',
          weather_source: 'auto',
          auto_condition: 'sunny',
          auto_temp_f: 72,
        },
      }),
    ]);
    expect(result.applied).toBe(1);
    expect(db.txCount).toBe(1);
    expect(db.report_weather.get('r1')).toMatchObject({
      weather_source: 'auto',
      auto_condition: 'sunny',
      auto_temp_f: 72,
    });
  });

  it('dirty weather row is untouched while the parent report still applies', async () => {
    const db = fakeReportDb({
      daily_reports: [{ id: 'r1', status: 'draft', updated_at: '2026-07-01T00:00:00Z', _dirty: 1 }],
      report_weather: [
        { report_id: 'r1', weather_source: 'manual', override_condition: 'rain', _dirty: 1 },
      ],
    });
    const result = await applyReports(db as unknown as Db, [
      reportBundle({
        report: reportRow({ id: 'r1', status: 'submitted', updated_at: '2026-07-05T00:00:00Z' }),
        weather: {
          report_id: 'r1',
          weather_source: 'auto',
          auto_condition: 'sunny',
          auto_temp_f: 72,
        },
      }),
    ]);
    expect(result.applied).toBe(1); // report status change applied
    expect(db.report_weather.get('r1')).toMatchObject({
      weather_source: 'manual',
      override_condition: 'rain',
      _dirty: 1,
    });
  });

  it('weather === null leaves local report_weather untouched (not a deletion)', async () => {
    const db = fakeReportDb({
      report_weather: [
        { report_id: 'r1', weather_source: 'auto', auto_condition: 'sunny', _dirty: 0 },
      ],
    });
    await applyReports(db as unknown as Db, [
      reportBundle({ report: reportRow({ id: 'r1' }), weather: null }),
    ]);
    expect(db.report_weather.get('r1')).toMatchObject({
      weather_source: 'auto',
      auto_condition: 'sunny',
    });
  });

  it('report no-op (identical updated_at, clean) + clean CHANGED weather: weather still applies, bundle counted', async () => {
    const db = fakeReportDb({
      daily_reports: [{ id: 'r1', status: 'draft', updated_at: '2026-07-01T10:00:00Z', _dirty: 0 }],
      report_weather: [
        {
          report_id: 'r1',
          weather_source: 'auto',
          auto_condition: 'rain',
          updated_at: '2026-07-01T09:00:00Z',
          _dirty: 0,
        },
      ],
    });
    const result = await applyReports(db as unknown as Db, [
      reportBundle({
        report: reportRow({ id: 'r1', status: 'draft' }), // identical updated_at ⇒ report is a no-op
        weather: {
          report_id: 'r1',
          weather_source: 'auto',
          auto_condition: 'sunny',
          auto_temp_f: 72,
          updated_at: '2026-07-01T11:00:00Z', // fresher weather, distinct from the report no-op
        },
      }),
    ]);
    expect(result.applied).toBe(1); // weather-only change still counts
    expect(db.calls.some((c) => /^INSERT INTO daily_reports/i.test(c.sql))).toBe(false);
    expect(db.calls.some((c) => /^UPDATE daily_reports SET status/i.test(c.sql))).toBe(false);
    expect(db.report_weather.get('r1')).toMatchObject({
      auto_condition: 'sunny',
      auto_temp_f: 72,
      updated_at: '2026-07-01T11:00:00Z',
    });
  });

  it('report no-op + dirty weather: weather untouched, applied stays 0', async () => {
    const db = fakeReportDb({
      daily_reports: [{ id: 'r1', status: 'draft', updated_at: '2026-07-01T10:00:00Z', _dirty: 0 }],
      report_weather: [
        { report_id: 'r1', weather_source: 'manual', override_condition: 'rain', _dirty: 1 },
      ],
    });
    const result = await applyReports(db as unknown as Db, [
      reportBundle({
        report: reportRow({ id: 'r1', status: 'draft' }),
        weather: {
          report_id: 'r1',
          weather_source: 'auto',
          auto_condition: 'sunny',
          auto_temp_f: 72,
        },
      }),
    ]);
    expect(result.applied).toBe(0);
    expect(db.report_weather.get('r1')).toMatchObject({
      weather_source: 'manual',
      override_condition: 'rain',
      _dirty: 1,
    });
  });

  it('identical clean weather re-delivery (same updated_at) is its own no-op — not counted in applied', async () => {
    const db = fakeReportDb({
      report_weather: [
        {
          report_id: 'r1',
          weather_source: 'auto',
          auto_condition: 'sunny',
          auto_temp_f: 72,
          updated_at: '2026-07-01T09:00:00Z',
          _dirty: 0,
        },
      ],
    });
    const result = await applyReports(db as unknown as Db, [
      reportBundle({
        report: reportRow({ id: 'r1', status: 'submitted' }), // report itself still changes
        weather: {
          report_id: 'r1',
          weather_source: 'auto',
          auto_condition: 'sunny',
          auto_temp_f: 72,
          updated_at: '2026-07-01T09:00:00Z', // identical — weather write is a no-op
        },
      }),
    ]);
    expect(result.applied).toBe(1); // credited to the report insert, not double-counted for weather
    expect(db.calls.filter((c) => /^INSERT INTO report_weather/i.test(c.sql))).toHaveLength(0);
  });
});

describe('heldStatusReportIds', () => {
  it('parses pending submit:/lock: clientIds and ignores parked ones', async () => {
    const db = fakeReportDb({
      sync_mutations: [
        { client_id: 'submit:r1', status: 'pending' },
        { client_id: 'lock:r2', status: 'pending' },
        { client_id: 'submit:r3', status: 'parked' },
        { client_id: 'r4', status: 'pending' },
        { client_id: 'r5:crew', status: 'pending' },
      ],
    });
    const held = await heldStatusReportIds(db as unknown as Db);
    expect(held).toEqual(new Set(['r1', 'r2']));
  });
});

function sectionRow(overrides: Row = {}): PulledSection {
  return {
    report_id: 'r1',
    section: 'general_notes',
    payload: { text: 'hello' },
    is_complete: true,
    updated_at: '2026-07-01T10:00:00Z',
    ...overrides,
  } as PulledSection;
}

describe('applySections', () => {
  it('clean section (no local row) is upserted, _dirty = 0', async () => {
    const db = fakeReportDb();
    const result = await applySections(db as unknown as Db, [sectionRow()]);
    expect(result.applied).toBe(1);
    expect(result.hardSkipped).toBe(0);
    expect(db.report_sections.get('r1:general_notes')).toMatchObject({
      payload: JSON.stringify({ text: 'hello' }),
      _dirty: 0,
    });
  });

  it('clean section upsert re-explodes children in the same tx', async () => {
    const db = fakeReportDb({
      report_sections: [
        { report_id: 'r1', section: 'crew', updated_at: '2026-07-01T00:00:00Z', _dirty: 0 },
      ],
      report_crew: [{ id: 'stale', report_id: 'r1', trade: 'stale-trade' }],
    });
    const result = await applySections(db as unknown as Db, [
      sectionRow({
        section: 'crew',
        payload: {
          rows: [
            { id: 'c1', trade: 'electrical', headcount: 3, hours: 8, is_carried_forward: false },
          ],
        },
        updated_at: '2026-07-05T00:00:00Z',
      }),
    ]);
    expect(result.applied).toBe(1);
    expect(db.txCount).toBe(1);
    expect(db.report_crew).toHaveLength(1);
    expect(db.report_crew[0]).toMatchObject({ trade: 'electrical' });
  });

  it('no-op rule: clean local section with identical updated_at is skipped', async () => {
    const db = fakeReportDb({
      report_sections: [
        {
          report_id: 'r1',
          section: 'general_notes',
          updated_at: '2026-07-01T10:00:00Z',
          _dirty: 0,
        },
      ],
    });
    const result = await applySections(db as unknown as Db, [sectionRow()]);
    expect(result.applied).toBe(0);
    expect(result.cursorKeys).toEqual(['2026-07-01T10:00:00Z']);
    expect(db.calls.some((c) => /^INSERT INTO report_sections/i.test(c.sql))).toBe(false);
  });

  it('dirty section and its children are untouched, but the timestamp is still credited', async () => {
    const db = fakeReportDb({
      report_sections: [
        { report_id: 'r1', section: 'crew', updated_at: '2026-07-01T00:00:00Z', _dirty: 1 },
      ],
      report_crew: [{ id: 'keep', report_id: 'r1', trade: 'keep-trade' }],
    });
    const result = await applySections(db as unknown as Db, [
      sectionRow({
        section: 'crew',
        payload: {
          rows: [
            { id: 'c1', trade: 'electrical', headcount: 3, hours: 8, is_carried_forward: false },
          ],
        },
        updated_at: '2026-07-09T00:00:00Z',
      }),
    ]);
    expect(result.applied).toBe(0);
    expect(result.cursorKeys).toEqual(['2026-07-09T00:00:00Z']);
    expect(db.report_crew).toHaveLength(1);
    expect(db.report_crew[0]).toMatchObject({ trade: 'keep-trade' });
    expect(db.calls.some((c) => /^DELETE FROM report_crew/i.test(c.sql))).toBe(false);
  });

  it('unknown section kind is hardSkipped', async () => {
    const db = fakeReportDb();
    const result = await applySections(db as unknown as Db, [
      sectionRow({ section: 'not_a_real_kind' }),
    ]);
    expect(result.hardSkipped).toBe(1);
    expect(result.applied).toBe(0);
  });

  it('non-string section updated_at is hardSkipped', async () => {
    const db = fakeReportDb();
    const result = await applySections(db as unknown as Db, [sectionRow({ updated_at: 12345 })]);
    expect(result.hardSkipped).toBe(1);
  });

  it('non-string section report_id is hardSkipped; sibling row still commits', async () => {
    const db = fakeReportDb();
    const result = await applySections(db as unknown as Db, [
      sectionRow({ report_id: 12345 }),
      sectionRow({ report_id: 'r-good' }),
    ]);
    expect(result.hardSkipped).toBe(1);
    expect(result.applied).toBe(1);
    expect(db.report_sections.get('r-good:general_notes')).toBeDefined();
  });

  it('unparseable payload is hardSkipped; other rows still commit', async () => {
    const db = fakeReportDb();
    const result = await applySections(db as unknown as Db, [
      sectionRow({ report_id: 'r1', section: 'general_notes', payload: '{not json' }),
      sectionRow({ report_id: 'r2', section: 'general_notes', payload: { text: 'ok' } }),
    ]);
    expect(result.hardSkipped).toBe(1);
    expect(result.applied).toBe(1);
    expect(db.report_sections.get('r2:general_notes')).toBeDefined();
  });

  it('updated_by round-trips through applySections into the written row', async () => {
    const db = fakeReportDb();
    const result = await applySections(db as unknown as Db, [
      sectionRow({ updated_by: 'user-42' }),
    ]);
    expect(result.applied).toBe(1);
    expect(db.report_sections.get('r1:general_notes')).toMatchObject({ updated_by: 'user-42' });
  });
});

// ---------------------------------------------------------------------------
// applyPhotos / applyAmendments — tombstone hold-back + amendment backfill
// ---------------------------------------------------------------------------

function photoRow(overrides: Row = {}): Record<string, unknown> {
  return {
    id: 'ph1',
    report_id: 'r1',
    project_id: 'p1',
    storage_path: 'photos/ph1.jpg',
    trade_tag: null,
    location_tag: null,
    caption: null,
    source: 'camera',
    captured_at: null,
    exif_datetime_original: null,
    added_at: null,
    gps_lat: null,
    gps_lng: null,
    gps_accuracy: null,
    width: null,
    height: null,
    created_by: 'u1',
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T10:00:00Z',
    deleted_at: null,
    ...overrides,
  };
}

describe('applyPhotos', () => {
  it('new server photo row inserts with _pending = 0, _dirty = 0', async () => {
    const db = fakeReportDb();
    const result = await applyPhotos(db as unknown as Db, [photoRow()]);
    expect(result.applied).toBe(1);
    expect(result.hardSkipped).toBe(0);
    expect(result.heldBack).toBe(0);
    expect(result.cursorKeys).toEqual(['2026-07-01T10:00:00Z']);
    expect(db.txCount).toBe(1);
    expect(db.report_photos.get('ph1')).toMatchObject({ _pending: 0, _dirty: 0 });

    // Assert against the emitted SQL text, not just the fake's recorded row —
    // the fake unconditionally stamps _pending/_dirty on a fresh INSERT, so a
    // regression that dropped the literal `, 0, 0` from the INSERT VALUES
    // would still pass the assertion above.
    const insertCall = db.calls.find((c) => /^INSERT INTO report_photos/i.test(c.sql));
    expect(insertCall).toBeDefined();
    expect(insertCall!.sql).toMatch(/\(\s*[\s\S]*?_pending,\s*_dirty\s*\)/);
    expect(insertCall!.sql).toMatch(/VALUES\s*\([\s\S]*?,\s*0,\s*0\s*\)/);
  });

  it('upsert leaves _pending/_dirty/local_uri/local_thumb_uri untouched on an existing row', async () => {
    const db = fakeReportDb({
      report_photos: [
        {
          id: 'ph1',
          updated_at: '2026-07-01T00:00:00Z',
          _dirty: 0,
          _pending: 0,
          local_uri: 'file:///cache/ph1.jpg',
          local_thumb_uri: 'file:///cache/ph1-thumb.jpg',
        },
      ],
    });
    const result = await applyPhotos(db as unknown as Db, [
      photoRow({ caption: 'updated caption' }),
    ]);
    expect(result.applied).toBe(1);
    expect(db.report_photos.get('ph1')).toMatchObject({
      caption: 'updated caption',
      _pending: 0,
      _dirty: 0,
      local_uri: 'file:///cache/ph1.jpg',
      local_thumb_uri: 'file:///cache/ph1-thumb.jpg',
    });

    // The fake unconditionally restores prior._pending/_dirty/local_uri/
    // local_thumb_uri on an existing row regardless of what the applier's SQL
    // actually says — so assert directly on the emitted SET clause too: a
    // regression to `SET ... _pending = excluded._pending` would still pass
    // the assertions above but must fail this one.
    const insertCall = db.calls.find((c) => /^INSERT INTO report_photos/i.test(c.sql));
    expect(insertCall).toBeDefined();
    const setClause = insertCall!.sql.split(/DO UPDATE SET/i)[1] ?? '';
    expect(setClause).not.toMatch(/_pending/);
    expect(setClause).not.toMatch(/_dirty/);
    expect(setClause).not.toMatch(/local_uri/);
    expect(setClause).not.toMatch(/local_thumb_uri/);
  });

  it('tombstone hard-deletes a clean local row', async () => {
    const db = fakeReportDb({
      report_photos: [{ id: 'ph1', updated_at: '2026-07-01T00:00:00Z', _dirty: 0, _pending: 0 }],
    });
    const result = await applyPhotos(db as unknown as Db, [
      photoRow({ deleted_at: '2026-07-02T00:00:00Z', updated_at: '2026-07-02T00:00:00Z' }),
    ]);
    expect(result.applied).toBe(1);
    expect(result.heldBack).toBe(0);
    expect(db.report_photos.get('ph1')).toBeUndefined();
  });

  it('re-delivered settled tombstone with no local row is a no-op, cursor still credited', async () => {
    const db = fakeReportDb();
    const result = await applyPhotos(db as unknown as Db, [
      photoRow({ deleted_at: '2026-07-02T00:00:00Z', updated_at: '2026-07-02T00:00:00Z' }),
    ]);
    expect(result.applied).toBe(0);
    expect(result.cursorKeys).toEqual(['2026-07-02T00:00:00Z']);
  });

  it('tombstone + local _pending = 1: row survives AND heldBack > 0 (feed cursor frozen)', async () => {
    const db = fakeReportDb({
      report_photos: [{ id: 'ph1', updated_at: '2026-07-01T00:00:00Z', _dirty: 0, _pending: 1 }],
    });
    const result = await applyPhotos(db as unknown as Db, [
      photoRow({ deleted_at: '2026-07-02T00:00:00Z', updated_at: '2026-07-02T00:00:00Z' }),
    ]);
    expect(result.heldBack).toBe(1);
    expect(result.cursorKeys).toEqual([]);
    expect(result.applied).toBe(0);
    expect(db.report_photos.get('ph1')).toBeDefined();
  });

  it('tombstone + local _dirty = 1: row survives AND heldBack > 0 (feed cursor frozen)', async () => {
    const db = fakeReportDb({
      report_photos: [{ id: 'ph1', updated_at: '2026-07-01T00:00:00Z', _dirty: 1, _pending: 0 }],
    });
    const result = await applyPhotos(db as unknown as Db, [
      photoRow({ deleted_at: '2026-07-02T00:00:00Z', updated_at: '2026-07-02T00:00:00Z' }),
    ]);
    expect(result.heldBack).toBe(1);
    expect(result.applied).toBe(0);
    expect(db.report_photos.get('ph1')).toBeDefined();
  });

  it('non-tombstone + _dirty = 1: row survives, heldBack === 0, timestamp IS in cursorKeys (plain shield still credits)', async () => {
    const db = fakeReportDb({
      report_photos: [{ id: 'ph1', updated_at: '2026-07-01T00:00:00Z', _dirty: 1, _pending: 0 }],
    });
    const result = await applyPhotos(db as unknown as Db, [
      photoRow({ caption: 'server edit', updated_at: '2026-07-02T00:00:00Z' }),
    ]);
    expect(result.heldBack).toBe(0);
    expect(result.applied).toBe(0);
    expect(result.cursorKeys).toEqual(['2026-07-02T00:00:00Z']);
    expect(db.report_photos.get('ph1')).toMatchObject({ updated_at: '2026-07-01T00:00:00Z' });
  });

  it('non-tombstone + _pending = 1: row survives, heldBack === 0, timestamp credited', async () => {
    const db = fakeReportDb({
      report_photos: [{ id: 'ph1', updated_at: '2026-07-01T00:00:00Z', _dirty: 0, _pending: 1 }],
    });
    const result = await applyPhotos(db as unknown as Db, [
      photoRow({ caption: 'server edit', updated_at: '2026-07-02T00:00:00Z' }),
    ]);
    expect(result.heldBack).toBe(0);
    expect(result.cursorKeys).toEqual(['2026-07-02T00:00:00Z']);
    expect(db.report_photos.get('ph1')).toMatchObject({ updated_at: '2026-07-01T00:00:00Z' });
  });

  it('no-op rule: identical re-delivered clean photo (same updated_at) is skipped, applied unchanged', async () => {
    const db = fakeReportDb({
      report_photos: [{ id: 'ph1', updated_at: '2026-07-01T10:00:00Z', _dirty: 0, _pending: 0 }],
    });
    const result = await applyPhotos(db as unknown as Db, [photoRow()]);
    expect(result.applied).toBe(0);
    expect(result.cursorKeys).toEqual(['2026-07-01T10:00:00Z']);
    expect(db.calls.some((c) => /^INSERT INTO report_photos/i.test(c.sql))).toBe(false);
  });

  it('malformed photo row (no id/updated_at) is hardSkipped; sibling rows still commit', async () => {
    const db = fakeReportDb();
    const result = await applyPhotos(db as unknown as Db, [
      photoRow({ id: null }),
      photoRow({ id: 'ph-bad2', updated_at: undefined }),
      photoRow({ id: 'ph-bad3', report_id: null }),
      photoRow({ id: 'ph-bad4', project_id: null }),
      photoRow({ id: 'ph-bad5', storage_path: null }),
      photoRow({ id: 'ph-good' }),
    ]);
    expect(result.hardSkipped).toBe(5);
    expect(result.applied).toBe(1);
    expect(db.report_photos.get('ph-good')).toBeDefined();
  });
});

function amendmentRow(overrides: Row = {}): Record<string, unknown> {
  return {
    id: 'am1',
    report_id: 'r1',
    amendment_number: 3,
    reason: 'correction',
    created_by: 'u1',
    created_at: '2026-07-01T10:00:00Z',
    signature_id: null,
    ...overrides,
  };
}

function changeRow(overrides: Row = {}): Record<string, unknown> {
  return {
    id: 'ch1',
    section: 'general_notes',
    before_payload: { text: 'before' },
    after_payload: { text: 'after' },
    ...overrides,
  };
}

function amendmentBundle(overrides: Partial<PulledAmendment> = {}): PulledAmendment {
  return { amendment: amendmentRow(), changes: [changeRow()], ...overrides };
}

describe('applyAmendments', () => {
  it('clean amendment upsert backfills NULL amendment_number and replaces changes in the same tx', async () => {
    const db = fakeReportDb({
      report_amendments: [
        { id: 'am1', amendment_number: null, created_at: '2026-06-01T00:00:00Z', _dirty: 0 },
      ],
      report_amendment_changes: [
        {
          id: 'stale',
          amendment_id: 'am1',
          section: 'stale',
          before_payload: '{}',
          after_payload: '{}',
        },
      ],
    });
    const result = await applyAmendments(db as unknown as Db, [amendmentBundle()]);
    expect(result.applied).toBe(1);
    expect(result.heldBack).toBe(0);
    expect(db.txCount).toBe(1);
    expect(db.report_amendments.get('am1')).toMatchObject({ amendment_number: 3 });
    expect(db.report_amendment_changes).toHaveLength(1);
    expect(db.report_amendment_changes[0]).toMatchObject({ id: 'ch1', amendment_id: 'am1' });
  });

  it('dirty amendment is fully shielded (row + changes) with created_at in cursorKeys', async () => {
    const db = fakeReportDb({
      report_amendments: [
        { id: 'am1', amendment_number: 1, created_at: '2026-06-01T00:00:00Z', _dirty: 1 },
      ],
      report_amendment_changes: [
        {
          id: 'keep',
          amendment_id: 'am1',
          section: 'kept',
          before_payload: '{}',
          after_payload: '{}',
        },
      ],
    });
    const result = await applyAmendments(db as unknown as Db, [
      amendmentBundle({ amendment: amendmentRow({ amendment_number: 9 }) }),
    ]);
    expect(result.applied).toBe(0);
    expect(result.heldBack).toBe(0);
    expect(result.cursorKeys).toEqual(['2026-07-01T10:00:00Z']);
    expect(db.report_amendments.get('am1')).toMatchObject({ amendment_number: 1 });
    expect(db.report_amendment_changes).toHaveLength(1);
    expect(db.report_amendment_changes[0].id).toBe('keep');
  });

  it('floor (d): empty fetched changes but non-empty local changes → row + changes untouched, heldBack > 0; sibling still applies', async () => {
    const db = fakeReportDb({
      report_amendments: [
        { id: 'am1', amendment_number: null, created_at: '2026-06-01T00:00:00Z', _dirty: 0 },
      ],
      report_amendment_changes: [
        {
          id: 'keep',
          amendment_id: 'am1',
          section: 'kept',
          before_payload: '{}',
          after_payload: '{}',
        },
      ],
    });
    const result = await applyAmendments(db as unknown as Db, [
      amendmentBundle({ amendment: amendmentRow(), changes: [] }),
      amendmentBundle({
        amendment: amendmentRow({ id: 'am2', created_at: '2026-07-02T00:00:00Z' }),
      }),
    ]);
    expect(result.heldBack).toBe(1);
    expect(result.applied).toBe(1);
    expect(db.report_amendments.get('am1')).toMatchObject({ amendment_number: null });
    expect(db.report_amendment_changes.filter((r) => r.amendment_id === 'am1')).toHaveLength(1);
    expect(db.report_amendments.get('am2')).toBeDefined();
  });

  it('clean amendment with empty fetched changes AND empty local changes applies normally (legitimate zero)', async () => {
    const db = fakeReportDb({
      report_amendments: [
        { id: 'am1', amendment_number: null, created_at: '2026-06-01T00:00:00Z', _dirty: 0 },
      ],
    });
    const result = await applyAmendments(db as unknown as Db, [
      amendmentBundle({ amendment: amendmentRow(), changes: [] }),
    ]);
    expect(result.heldBack).toBe(0);
    expect(result.applied).toBe(1);
    expect(db.report_amendments.get('am1')).toMatchObject({ amendment_number: 3 });
    expect(db.report_amendment_changes).toHaveLength(0);
  });

  it('no-op rule: identical created_at, non-null local number, equal change count → applied unchanged, credited', async () => {
    const db = fakeReportDb({
      report_amendments: [
        { id: 'am1', amendment_number: 3, created_at: '2026-07-01T10:00:00Z', _dirty: 0 },
      ],
      report_amendment_changes: [
        {
          id: 'ch1',
          amendment_id: 'am1',
          section: 'general_notes',
          before_payload: '{}',
          after_payload: '{}',
        },
      ],
    });
    const result = await applyAmendments(db as unknown as Db, [amendmentBundle()]);
    expect(result.applied).toBe(0);
    expect(result.cursorKeys).toEqual(['2026-07-01T10:00:00Z']);
    expect(db.calls.some((c) => /^INSERT INTO report_amendments/i.test(c.sql))).toBe(false);
  });

  it('malformed amendment row (no id/created_at/report_id) is hardSkipped; sibling still commits', async () => {
    const db = fakeReportDb();
    const result = await applyAmendments(db as unknown as Db, [
      amendmentBundle({ amendment: amendmentRow({ id: null }) }),
      amendmentBundle({ amendment: amendmentRow({ id: 'am-bad2', created_at: undefined }) }),
      amendmentBundle({ amendment: amendmentRow({ id: 'am-bad3', report_id: null }) }),
      amendmentBundle({ amendment: amendmentRow({ id: 'am-good' }) }),
    ]);
    expect(result.hardSkipped).toBe(3);
    expect(result.applied).toBe(1);
    expect(db.report_amendments.get('am-good')).toBeDefined();
  });
});
