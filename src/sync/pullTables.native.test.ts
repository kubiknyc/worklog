/**
 * Tier-1 reference snapshot applier, against an in-memory Db fake (no real
 * SQLite — jest-expo can't open a device database). The fake records every
 * `runAsync`/`getAllAsync` call and counts `withTransactionAsync` entries so
 * tests can assert the whole replace happens inside ONE transaction.
 */
import { applyReferenceSnapshot, applyReports, applySections } from './pullTables.native';
import type { ReferenceSnapshot, PulledReportBundle, PulledSection } from './pullTables.native';
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
  } = {},
) {
  const daily_reports = new Map<string, Row>();
  (seed.daily_reports ?? []).forEach((r) => daily_reports.set(`${r.id}`, { ...r }));
  const report_weather = new Map<string, Row>();
  (seed.report_weather ?? []).forEach((r) => report_weather.set(`${r.report_id}`, { ...r }));
  const report_sections = new Map<string, Row>();
  (seed.report_sections ?? []).forEach((r) =>
    report_sections.set(`${r.report_id}:${r.section}`, { ...r }),
  );
  let report_crew: Row[] = (seed.report_crew ?? []).map((r) => ({ ...r }));

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
    if (!row) return null;
    const out: Row = {};
    for (const c of cols) out[c] = row[c] ?? null;
    return out as unknown as T;
  }

  async function getAllAsync<T>(): Promise<T[]> {
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
      }
      return { changes: 1 };
    }

    return { changes: 0 };
  }

  return {
    daily_reports,
    report_weather,
    report_sections,
    get report_crew(): readonly Row[] {
      return report_crew;
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
});
