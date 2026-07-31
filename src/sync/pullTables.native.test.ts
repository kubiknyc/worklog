/**
 * Tier-1 reference snapshot applier, against an in-memory Db fake (no real
 * SQLite — jest-expo can't open a device database). The fake records every
 * `runAsync`/`getAllAsync` call and counts `withTransactionAsync` entries so
 * tests can assert the whole replace happens inside ONE transaction.
 */
import { applyReferenceSnapshot } from './pullTables.native';
import type { ReferenceSnapshot } from './pullTables.native';
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
