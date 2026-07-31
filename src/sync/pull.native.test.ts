/**
 * Pull orchestrator tests. Two fakes, per the `paginate.test.ts` idiom:
 *
 * - a SEMANTIC PostgREST client — `.select/.eq/.in/.gt/.gte/.order/.limit` are
 *   evaluated against in-memory tables, so `selectAllById` /
 *   `selectAllKeyset(3)` run their REAL paging protocol against it (including
 *   the full-page-then-short-page termination test), and every call is logged
 *   so scoping/chunking assertions read off actual requests;
 * - a fake `Db` covering only what the ORCHESTRATOR itself issues: `sync_meta`
 *   reads/writes, the floor `COUNT(*)` probes, and `sync_cursors` (the REAL
 *   `createCursorStore` runs against it — cursor writes are asserted as rows,
 *   not as spy calls).
 *
 * The appliers (Tasks 5-7) and the sweeps (Task 8) are mocked: this suite is
 * about the composition — which query was issued, which cursor moved, which
 * floor refused — and each of those modules already has its own semantic suite
 * proving the row-level behaviour. Mocking them is also the only way to drive
 * `hardSkipped`/`heldBack` directly, which the cursor rule turns on.
 */
import { SCOPES, overlapFloor } from './cursors';
import { IN_CHUNK_SIZE, PROFILE_PULL_COLUMNS } from './pullCore';
import { PAGE_SIZE } from './paginate';
import type { ApplyResult, MembershipDiff } from './pullTables.native';
import type { Db } from '../db/rows.native';
import { createPuller } from './pull.native';
import {
  applyReferenceSnapshot,
  applyReports,
  applySections,
  applyPhotos,
  applyAmendments,
} from './pullTables.native';
import { evictProjects, sweepProject } from './pullSweep.native';
import { reportSyncIncident } from '../lib/observability.native';

// babel-jest hoists these above the imports (store.native.test.ts precedent).
jest.mock('./pullTables.native', () => ({
  applyReferenceSnapshot: jest.fn(),
  applyReports: jest.fn(),
  applySections: jest.fn(),
  applyPhotos: jest.fn(),
  applyAmendments: jest.fn(),
}));
jest.mock('./pullSweep.native', () => ({
  evictProjects: jest.fn(async () => undefined),
  sweepProject: jest.fn(async () => 0),
}));
jest.mock('../lib/observability.native', () => ({
  reportSyncIncident: jest.fn(),
}));

type Row = Record<string, unknown>;

const mockApplyReferenceSnapshot = applyReferenceSnapshot as jest.MockedFunction<
  (db: Db, userId: string, snap: unknown) => Promise<MembershipDiff>
>;
const mockApplyReports = applyReports as jest.MockedFunction<
  (db: Db, rows: readonly unknown[]) => Promise<ApplyResult>
>;
const mockApplySections = applySections as jest.MockedFunction<
  (db: Db, rows: readonly unknown[]) => Promise<ApplyResult>
>;
const mockApplyPhotos = applyPhotos as jest.MockedFunction<
  (db: Db, rows: readonly unknown[]) => Promise<ApplyResult>
>;
const mockApplyAmendments = applyAmendments as jest.MockedFunction<
  (db: Db, rows: readonly unknown[]) => Promise<ApplyResult>
>;
const mockEvictProjects = evictProjects as jest.MockedFunction<
  (db: Db, ids: readonly string[], onEvicted: (projectId: string) => void) => Promise<void>
>;
const mockSweepProject = sweepProject as jest.MockedFunction<
  (db: Db, projectId: string, r: readonly string[], p: readonly string[]) => Promise<number>
>;
const mockIncident = reportSyncIncident as jest.MockedFunction<(a: string, b: unknown) => void>;

// ---------------------------------------------------------------------------
// Fake Db — sync_meta / sync_cursors / COUNT(*) floors only
// ---------------------------------------------------------------------------

interface DbSeed {
  readonly sync_meta?: readonly Row[];
  readonly sync_cursors?: readonly Row[];
  readonly projects?: readonly Row[];
  readonly project_members?: readonly Row[];
  readonly profiles?: readonly Row[];
  readonly daily_reports?: readonly Row[];
  readonly report_photos?: readonly Row[];
}

function fakeDb(seed: DbSeed = {}) {
  const tables: Record<string, Row[]> = {
    sync_meta: seed.sync_meta ? [...seed.sync_meta] : [],
    sync_cursors: seed.sync_cursors ? [...seed.sync_cursors] : [],
    projects: seed.projects ? [...seed.projects] : [],
    project_members: seed.project_members ? [...seed.project_members] : [],
    profiles: seed.profiles ? [...seed.profiles] : [],
    daily_reports: seed.daily_reports ? [...seed.daily_reports] : [],
    report_photos: seed.report_photos ? [...seed.report_photos] : [],
  };

  /**
   * `col = ?` / `col = <integer literal>` clauses ANDed together. Only the
   * `?` clauses consume a bound parameter, in order.
   */
  function matches(row: Row, where: string | undefined, params: readonly unknown[]): boolean {
    if (!where) return true;
    let paramIndex = 0;
    return where.split(/\s+AND\s+/i).every((clause) => {
      const [, col, rhs] = clause.trim().match(/^(\w+) = (\?|\d+)$/) ?? [];
      if (col === undefined) throw new Error(`fakeDb: unsupported clause ${clause}`);
      const expected = rhs === '?' ? params[paramIndex++] : Number(rhs);
      return row[col] === expected;
    });
  }

  async function getAllAsync<T>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
    const trimmed = sql.trim().replace(/\s+/g, ' ');
    if (/^SELECT key, value FROM sync_meta$/i.test(trimmed)) {
      return tables.sync_meta!.map((r) => ({ ...r })) as unknown as T[];
    }
    throw new Error(`fakeDb: unsupported getAll ${trimmed}`);
  }

  async function getFirstAsync<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
    const trimmed = sql.trim().replace(/\s+/g, ' ');

    const countMatch = trimmed.match(/^SELECT COUNT\(\*\) AS n FROM (\w+)(?: WHERE (.+))?$/i);
    if (countMatch) {
      const [, table, where] = countMatch;
      const rows = tables[table!] ?? [];
      return { n: rows.filter((r) => matches(r, where, params)).length } as unknown as T;
    }

    if (/^SELECT value FROM sync_cursors WHERE scope = \?$/i.test(trimmed)) {
      const found = tables.sync_cursors!.find((r) => r.scope === params[0]);
      return (found ? { value: found.value } : null) as unknown as T | null;
    }

    throw new Error(`fakeDb: unsupported getFirst ${trimmed}`);
  }

  async function runAsync(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<{ changes: number }> {
    const trimmed = sql.trim().replace(/\s+/g, ' ');

    const upsertMatch = trimmed.match(
      /^INSERT INTO (sync_cursors|sync_meta) \((\w+), value\) VALUES \(\?, \?\) ON CONFLICT \(\w+\) DO UPDATE SET value = excluded\.value$/i,
    );
    if (upsertMatch) {
      const [, table, keyCol] = upsertMatch;
      const rows = tables[table!]!;
      const existing = rows.find((r) => r[keyCol!] === params[0]);
      if (existing) existing.value = params[1] as string;
      else rows.push({ [keyCol!]: params[0], value: params[1] });
      return { changes: 1 };
    }

    const deleteMatch = trimmed.match(/^DELETE FROM (\w+) WHERE (\w+) = \?$/i);
    if (deleteMatch) {
      const [, table, col] = deleteMatch;
      const rows = tables[table!] ?? [];
      const before = rows.length;
      tables[table!] = rows.filter((r) => r[col!] !== params[0]);
      return { changes: before - tables[table!]!.length };
    }

    throw new Error(`fakeDb: unsupported run ${trimmed}`);
  }

  return {
    tables,
    getAllAsync,
    getFirstAsync,
    runAsync,
    async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
      await fn();
    },
  };
}

function metaValue(db: ReturnType<typeof fakeDb>, key: string): unknown {
  return db.tables.sync_meta!.find((r) => r.key === key)?.value;
}

function cursorValue(db: ReturnType<typeof fakeDb>, scope: string): unknown {
  return db.tables.sync_cursors!.find((r) => r.scope === scope)?.value;
}

// ---------------------------------------------------------------------------
// Semantic PostgREST client fake
// ---------------------------------------------------------------------------

interface ClientCall {
  readonly table: string;
  select: string | null;
  readonly eq: [string, string][];
  readonly in: [string, readonly string[]][];
  readonly gt: [string, string][];
  readonly gte: [string, string][];
  readonly or: string[];
  readonly order: string[];
  limit: number | null;
}

interface ClientSeed {
  readonly tables?: Record<string, Row[]>;
  /** table → error value surfaced in the `PageResult` (paginate throws it). */
  readonly pageError?: Record<string, unknown>;
  /** table → value thrown synchronously from `.limit()`. */
  readonly throwOn?: Record<string, unknown>;
}

/** Resolve `a.b` against a row (embedded PostgREST join filters). */
function resolvePath(row: Row, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    return (acc as Row)[part];
  }, row);
}

function fakeClient(seed: ClientSeed = {}) {
  const tables = seed.tables ?? {};
  const calls: ClientCall[] = [];

  function from(table: string) {
    const call: ClientCall = {
      table,
      select: null,
      eq: [],
      in: [],
      gt: [],
      gte: [],
      or: [],
      order: [],
      limit: null,
    };
    calls.push(call);

    const q = {
      select(columns: string) {
        call.select = columns;
        return q;
      },
      eq(column: string, value: string) {
        call.eq.push([column, value]);
        return q;
      },
      in(column: string, values: readonly string[]) {
        call.in.push([column, values]);
        return q;
      },
      gt(column: string, value: string) {
        call.gt.push([column, value]);
        return q;
      },
      gte(column: string, value: string) {
        call.gte.push([column, value]);
        return q;
      },
      or(filter: string) {
        call.or.push(filter);
        return q;
      },
      order(column: string) {
        call.order.push(column);
        return q;
      },
      limit(count: number) {
        call.limit = count;
        if (seed.throwOn && table in seed.throwOn) throw seed.throwOn[table];
        if (seed.pageError && table in seed.pageError) {
          return Promise.resolve({ data: null, error: seed.pageError[table] });
        }
        let rows = [...(tables[table] ?? [])];
        for (const [col, value] of call.eq)
          rows = rows.filter((r) => resolvePath(r, col) === value);
        for (const [col, values] of call.in)
          rows = rows.filter((r) => values.includes(String(resolvePath(r, col))));
        for (const [col, value] of call.gt) rows = rows.filter((r) => String(r[col]) > value);
        for (const [col, value] of call.gte) rows = rows.filter((r) => String(r[col]) >= value);
        for (const col of [...call.order].reverse()) {
          rows.sort((a, b) => String(a[col]).localeCompare(String(b[col])));
        }
        return Promise.resolve({ data: rows.slice(0, count), error: null });
      },
    };
    return q;
  }

  return { client: { from } as never, calls };
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const USER = 'u1';

function result(over: Partial<ApplyResult> = {}): ApplyResult {
  return { applied: 0, cursorKeys: [], hardSkipped: 0, heldBack: 0, ...over };
}

function diff(over: Partial<MembershipDiff> = {}): MembershipDiff {
  return { beforeProjectIds: [], afterProjectIds: [], changed: false, ...over };
}

/** Tier-1 succeeds with membership `after`, no eviction, nothing changed. */
function tier1(after: readonly string[], over: Partial<MembershipDiff> = {}): void {
  mockApplyReferenceSnapshot.mockResolvedValue(
    diff({ beforeProjectIds: [...after], afterProjectIds: [...after], ...over }),
  );
}

function emptyFeeds(): void {
  mockApplyReports.mockResolvedValue(result());
  mockApplySections.mockResolvedValue(result());
  mockApplyPhotos.mockResolvedValue(result());
  mockApplyAmendments.mockResolvedValue(result());
}

/** Tier-1 rows so the empty-snapshot floors pass. */
function tier1Tables(): Record<string, Row[]> {
  return {
    projects: [{ id: 'p1', name: 'P1' }],
    project_members: [{ project_id: 'p1', user_id: USER }],
    profiles: [{ id: USER, full_name: 'U' }],
    report_member_prefs: [],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  emptyFeeds();
  mockEvictProjects.mockResolvedValue(undefined);
  mockSweepProject.mockResolvedValue(0);
});

// ---------------------------------------------------------------------------
// Tier 1
// ---------------------------------------------------------------------------

describe('tier 1', () => {
  it('fetches members and prefs by the (project_id, user_id) composite keyset, NOT by id', async () => {
    tier1([]);
    const db = fakeDb();
    const { client, calls } = fakeClient({ tables: tier1Tables() });

    await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    const members = calls.find((c) => c.table === 'project_members')!;
    expect(members.order).toEqual(['project_id', 'user_id']);
    const prefs = calls.find((c) => c.table === 'report_member_prefs')!;
    expect(prefs.order).toEqual(['project_id', 'user_id']);
    // Full snapshot: no floor on a composite-PK table.
    expect(members.gte).toEqual([]);
    expect(prefs.gte).toEqual([]);
    // projects/profiles DO scan by id.
    expect(calls.find((c) => c.table === 'projects')!.order).toEqual(['id']);
    expect(calls.find((c) => c.table === 'profiles')!.order).toEqual(['id']);
  });

  it('pins the profiles manifest (no expo_push_token, never "*")', async () => {
    tier1([]);
    const db = fakeDb();
    const { client, calls } = fakeClient({ tables: tier1Tables() });

    await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    const profiles = calls.find((c) => c.table === 'profiles')!;
    expect(profiles.select).toBe(PROFILE_PULL_COLUMNS);
    expect(profiles.select).not.toContain('expo_push_token');
  });

  it.each([
    ['projects', 'projects'],
    ['project_members', 'project_members'],
    ['profiles', 'profiles'],
  ])(
    'refuses the replace, the eviction and ALL of tier 2 when %s comes back empty against a non-empty local table',
    async (emptied, localTable) => {
      const tables = tier1Tables();
      tables[emptied] = [];
      const db = fakeDb({ [localTable]: [{ id: 'x' }] } as DbSeed);
      const { client } = fakeClient({ tables });

      const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

      expect(outcome.ok).toBe(false);
      expect(outcome.error).toBe(`tier1 ${emptied} empty — refusing replace`);
      expect(mockApplyReferenceSnapshot).not.toHaveBeenCalled();
      expect(mockEvictProjects).not.toHaveBeenCalled();
      expect(mockApplyReports).not.toHaveBeenCalled();
      // Rotation is untouched on the tier-1 failure path.
      expect(metaValue(db, 'pull_rotation_v1')).toBeUndefined();
    },
  );

  it('passes when report_member_prefs is empty — it is legitimately empty', async () => {
    tier1(['p1'], { changed: true });
    const db = fakeDb({
      sync_meta: [{ key: 'active_project_id', value: 'p1' }],
      // A non-empty local prefs table would trip a floor if prefs had one.
      projects: [{ id: 'p1' }],
    });
    const { client } = fakeClient({ tables: tier1Tables() });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(mockApplyReferenceSnapshot).toHaveBeenCalled();
    expect(outcome.ok).toBe(true);
    expect(outcome.committed).toBe(true); // tier-1 `changed`
  });

  it('skips the eviction when floor (b) fails (after-set empty, before-set non-empty)', async () => {
    mockApplyReferenceSnapshot.mockResolvedValue(
      diff({ beforeProjectIds: ['p1'], afterProjectIds: [] }),
    );
    const db = fakeDb();
    // The wire snapshot stays non-empty (the tier-1 floor passes); it is the
    // MEMBERSHIP diff that reports a total wipe, which floor (b) refuses.
    const { client } = fakeClient({ tables: tier1Tables() });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(mockEvictProjects).not.toHaveBeenCalled();
    // Refused LOUDLY — the premise is a suspected server-side membership
    // regression, and the tier-1 replace already committed.
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('tier1 membership: refusing eviction — all memberships vanished');
    // Tier 2 still runs: the members snapshot itself passed floor (a).
    expect(metaValue(db, 'pull_rotation_v1')).toBeDefined();
  });

  it('evicts lost projects and fires ONE membership incident per project', async () => {
    mockApplyReferenceSnapshot.mockResolvedValue(
      diff({ beforeProjectIds: ['p1', 'p2'], afterProjectIds: ['p1'] }),
    );
    mockEvictProjects.mockImplementation(async (_db, ids, onEvicted) => {
      for (const id of ids) onEvicted(id);
    });
    const db = fakeDb();
    const { client } = fakeClient({ tables: tier1Tables() });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(mockEvictProjects).toHaveBeenCalledTimes(1);
    expect(mockEvictProjects.mock.calls[0]![1]).toEqual(['p2']);
    expect(mockIncident).toHaveBeenCalledTimes(1);
    expect(mockIncident).toHaveBeenCalledWith('evicted', {
      kind: 'membership_sweep',
      attempts: 0,
    });
    expect(outcome.committed).toBe(true); // an eviction ran
  });
});

// ---------------------------------------------------------------------------
// Eviction intent (crash resumability)
// ---------------------------------------------------------------------------

describe('eviction intent', () => {
  it('writes the pending set BEFORE evicting and clears it after', async () => {
    mockApplyReferenceSnapshot.mockResolvedValue(
      diff({ beforeProjectIds: ['p1', 'p2'], afterProjectIds: ['p1'] }),
    );
    const db = fakeDb();
    let pendingDuringEviction: unknown;
    mockEvictProjects.mockImplementation(async () => {
      pendingDuringEviction = metaValue(db, 'pull_evict_pending');
    });
    const { client } = fakeClient({ tables: tier1Tables() });

    await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(pendingDuringEviction).toBe(JSON.stringify(['p2']));
    expect(metaValue(db, 'pull_evict_pending')).toBeUndefined();
  });

  it('drains a pending set left by a crashed run at the START, then clears the key', async () => {
    tier1([]);
    const db = fakeDb({ sync_meta: [{ key: 'pull_evict_pending', value: '["p9","p8"]' }] });
    const { client } = fakeClient({ tables: tier1Tables() });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(mockEvictProjects).toHaveBeenCalledTimes(1);
    expect(mockEvictProjects.mock.calls[0]![1]).toEqual(['p9', 'p8']);
    // Drained before tier 1 applied.
    expect(mockEvictProjects.mock.invocationCallOrder[0]!).toBeLessThan(
      mockApplyReferenceSnapshot.mock.invocationCallOrder[0]!,
    );
    expect(metaValue(db, 'pull_evict_pending')).toBeUndefined();
    expect(outcome.committed).toBe(true);
  });

  it('keeps the key when the DRAIN throws, and MERGES the fresh evicted set into it rather than overwriting', async () => {
    mockApplyReferenceSnapshot.mockResolvedValue(
      diff({ beforeProjectIds: ['p1', 'p2'], afterProjectIds: ['p1'] }),
    );
    const db = fakeDb({ sync_meta: [{ key: 'pull_evict_pending', value: '["p9"]' }] });
    const written: unknown[] = [];
    mockEvictProjects
      .mockImplementationOnce(async () => {
        throw new Error('drain boom');
      })
      .mockImplementationOnce(async () => {
        written.push(metaValue(db, 'pull_evict_pending'));
      });
    const { client } = fakeClient({ tables: tier1Tables() });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    // p9 survived the failed drain and rode along with the fresh p2 — no
    // membership diff will ever rediscover p9, so overwriting would strand it.
    expect(mockEvictProjects.mock.calls[1]![1]).toEqual(['p9', 'p2']);
    expect(written[0]).toBe(JSON.stringify(['p9', 'p2']));
    // One call covered EVERYTHING the key held, so the key is cleared.
    expect(metaValue(db, 'pull_evict_pending')).toBeUndefined();
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('drain boom');
  });

  it('keeps the key for the next run when the drain throws and no fresh eviction follows', async () => {
    tier1(['p1']);
    const db = fakeDb({ sync_meta: [{ key: 'pull_evict_pending', value: '["p9"]' }] });
    mockEvictProjects.mockRejectedValue(new Error('drain boom'));
    const { client } = fakeClient({ tables: tier1Tables() });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(metaValue(db, 'pull_evict_pending')).toBe('["p9"]');
    expect(outcome.ok).toBe(false);
  });

  it('keeps the key when the NORMAL-path eviction throws after the intent was written', async () => {
    mockApplyReferenceSnapshot.mockResolvedValue(
      diff({ beforeProjectIds: ['p1', 'p2'], afterProjectIds: ['p1'] }),
    );
    const db = fakeDb();
    mockEvictProjects.mockRejectedValue(new Error('evict boom'));
    const { client } = fakeClient({ tables: tier1Tables() });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(metaValue(db, 'pull_evict_pending')).toBe(JSON.stringify(['p2']));
    expect(outcome.ok).toBe(false);
    expect(outcome.committed).toBe(false);
  });

  it('treats an unparseable pending key as absent and deletes it', async () => {
    tier1([]);
    const db = fakeDb({ sync_meta: [{ key: 'pull_evict_pending', value: 'not json' }] });
    const { client } = fakeClient({ tables: tier1Tables() });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(mockEvictProjects).not.toHaveBeenCalled();
    expect(metaValue(db, 'pull_evict_pending')).toBeUndefined();
    expect(outcome.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tier 2 scoping + ride-alongs
// ---------------------------------------------------------------------------

function tier2Db(over: DbSeed = {}) {
  return fakeDb({ sync_meta: [{ key: 'active_project_id', value: 'p1' }], ...over });
}

function tier2Tables(over: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    ...tier1Tables(),
    daily_reports: [{ id: 'r1', project_id: 'p1', updated_at: '2026-07-02T00:00:00Z' }],
    report_weather: [{ report_id: 'r1', updated_at: '2026-07-02T00:00:00Z' }],
    report_sections: [
      {
        report_id: 'r1',
        section: 'crew',
        updated_at: '2026-07-02T00:00:00Z',
        daily_reports: { project_id: 'p1' },
      },
    ],
    report_photos: [{ id: 'ph1', project_id: 'p1', updated_at: '2026-07-02T00:00:00Z' }],
    report_amendments: [
      {
        id: 'am1',
        report_id: 'r1',
        created_at: '2026-07-02T00:00:00Z',
        daily_reports: { project_id: 'p1' },
      },
    ],
    report_amendment_changes: [{ id: 'ac1', amendment_id: 'am1' }],
    ...over,
  };
}

describe('tier 2 scoping', () => {
  it('scopes reports and photos with a plain .eq(project_id) — no embed', async () => {
    tier1(['p1']);
    const db = tier2Db();
    const { client, calls } = fakeClient({ tables: tier2Tables() });

    await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    const reports = calls.find((c) => c.table === 'daily_reports')!;
    expect(reports.eq).toEqual([['project_id', 'p1']]);
    expect(reports.select).not.toContain('daily_reports!inner');
    const photos = calls.find((c) => c.table === 'report_photos')!;
    expect(photos.eq).toEqual([['project_id', 'p1']]);
    expect(photos.select).not.toContain('daily_reports!inner');
  });

  it('scopes sections and amendments through daily_reports!inner and strips the embed before apply', async () => {
    tier1(['p1']);
    const db = tier2Db();
    const { client, calls } = fakeClient({ tables: tier2Tables() });

    await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    const sections = calls.find((c) => c.table === 'report_sections')!;
    expect(sections.select).toContain(', daily_reports!inner(project_id)');
    expect(sections.eq).toEqual([['daily_reports.project_id', 'p1']]);
    const amendments = calls.find((c) => c.table === 'report_amendments')!;
    expect(amendments.select).toContain(', daily_reports!inner(project_id)');
    expect(amendments.eq).toEqual([['daily_reports.project_id', 'p1']]);

    const sectionRows = mockApplySections.mock.calls[0]![1] as Row[];
    expect(sectionRows).toHaveLength(1);
    expect(sectionRows[0]).not.toHaveProperty('daily_reports');
    expect(sectionRows[0]!.section).toBe('crew');

    const amendmentBundles = mockApplyAmendments.mock.calls[0]![1] as {
      amendment: Row;
      changes: Row[];
    }[];
    expect(amendmentBundles[0]!.amendment).not.toHaveProperty('daily_reports');
  });

  it('orders sections on the (updated_at, report_id, section) triple keyset', async () => {
    tier1(['p1']);
    const db = tier2Db();
    const { client, calls } = fakeClient({ tables: tier2Tables() });

    await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(calls.find((c) => c.table === 'report_sections')!.order).toEqual([
      'updated_at',
      'report_id',
      'section',
    ]);
    expect(calls.find((c) => c.table === 'report_amendments')!.order).toEqual(['created_at', 'id']);
  });

  it('passes the overlap floor to the query, and no floor at all on a first pull', async () => {
    tier1(['p1']);
    const cursor = '2026-07-02T10:00:00.000Z';
    const db = tier2Db({ sync_cursors: [{ scope: SCOPES.reports('p1'), value: cursor }] });
    const { client, calls } = fakeClient({ tables: tier2Tables() });

    await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(calls.find((c) => c.table === 'daily_reports')!.gte).toEqual([
      ['updated_at', overlapFloor(cursor)],
    ]);
    // photos have no stored cursor → first pull → full history, no floor
    expect(calls.find((c) => c.table === 'report_photos')!.gte).toEqual([]);
  });

  it('chunks the weather ride-along at IN_CHUNK_SIZE and skips it when there are no reports', async () => {
    tier1(['p1']);
    const reports = Array.from({ length: IN_CHUNK_SIZE + 1 }, (_, i) => ({
      id: `r${String(i).padStart(4, '0')}`,
      project_id: 'p1',
      updated_at: '2026-07-02T00:00:00Z',
    }));
    const db = tier2Db();
    const { client, calls } = fakeClient({ tables: tier2Tables({ daily_reports: reports }) });

    await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    const weatherCalls = calls.filter((c) => c.table === 'report_weather');
    expect(weatherCalls).toHaveLength(2);
    expect(weatherCalls[0]!.in[0]![1]).toHaveLength(IN_CHUNK_SIZE);
    expect(weatherCalls[1]!.in[0]![1]).toHaveLength(1);
  });

  it('skips both ride-alongs entirely when their id sets are empty', async () => {
    tier1(['p1']);
    const db = tier2Db();
    const { client, calls } = fakeClient({
      tables: tier2Tables({ daily_reports: [], report_amendments: [] }),
    });

    await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(calls.filter((c) => c.table === 'report_weather')).toHaveLength(0);
    expect(calls.filter((c) => c.table === 'report_amendment_changes')).toHaveLength(0);
  });

  it('fetches amendment changes through selectAllById — a full page then a short page both land', async () => {
    tier1(['p1']);
    const changes = Array.from({ length: PAGE_SIZE + 3 }, (_, i) => ({
      id: String(i).padStart(6, '0'),
      amendment_id: 'am1',
    }));
    const db = tier2Db();
    const { client, calls } = fakeClient({
      tables: tier2Tables({ report_amendment_changes: changes }),
    });

    await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    const changeCalls = calls.filter((c) => c.table === 'report_amendment_changes');
    // Paginated, not a single bare `.in()` read.
    expect(changeCalls.length).toBeGreaterThan(1);
    expect(changeCalls[0]!.order).toEqual(['id']);
    expect(changeCalls[0]!.limit).toBe(PAGE_SIZE);
    expect(changeCalls[1]!.gt).toEqual([['id', String(PAGE_SIZE - 1).padStart(6, '0')]]);

    const bundles = mockApplyAmendments.mock.calls[0]![1] as { changes: Row[] }[];
    expect(bundles[0]!.changes).toHaveLength(PAGE_SIZE + 3);
  });

  it('fails only the amendments feed when a changes chunk errors — the cursor stays put', async () => {
    tier1(['p1']);
    const db = tier2Db();
    const { client } = fakeClient({
      tables: tier2Tables(),
      pageError: { report_amendment_changes: new Error('chunk boom') },
    });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(mockApplyAmendments).not.toHaveBeenCalled();
    expect(mockApplyReports).toHaveBeenCalled(); // other feeds still ran
    expect(cursorValue(db, SCOPES.amendments('p1'))).toBeUndefined();
    expect(outcome.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cursor rule
// ---------------------------------------------------------------------------

describe('cursor rule', () => {
  it('advances a feed cursor to nextCursor(cursorKeys) only after a clean commit', async () => {
    tier1(['p1']);
    mockApplyReports.mockResolvedValue(
      result({ applied: 1, cursorKeys: ['2026-07-02T00:00:00Z', '2026-07-03T00:00:00Z'] }),
    );
    const db = tier2Db();
    const { client } = fakeClient({ tables: tier2Tables() });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(cursorValue(db, SCOPES.reports('p1'))).toBe('2026-07-03T00:00:00Z');
    expect(outcome.ok).toBe(true);
    expect(outcome.committed).toBe(true);
  });

  it('does NOT advance the cursor when hardSkipped > 0', async () => {
    tier1(['p1']);
    mockApplySections.mockResolvedValue(
      result({ applied: 1, cursorKeys: ['2026-07-09T00:00:00Z'], hardSkipped: 1 }),
    );
    const db = tier2Db({ sync_cursors: [{ scope: SCOPES.sections('p1'), value: 'old' }] });
    const { client } = fakeClient({ tables: tier2Tables() });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(cursorValue(db, SCOPES.sections('p1'))).toBe('old');
    expect(outcome.ok).toBe(false);
    expect(outcome.committed).toBe(true); // applied > 0 despite the skip
  });

  it('does NOT advance the cursor when heldBack > 0 (tombstone freeze reaches the orchestrator)', async () => {
    tier1(['p1']);
    mockApplyPhotos.mockResolvedValue(
      result({ cursorKeys: ['2026-07-09T00:00:00Z'], heldBack: 1 }),
    );
    const db = tier2Db();
    const { client } = fakeClient({ tables: tier2Tables() });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(cursorValue(db, SCOPES.photos('p1'))).toBeUndefined();
    expect(outcome.ok).toBe(false);
  });

  it('skips the cursors.set write when the fold is null (first pull, nothing creditable)', async () => {
    tier1(['p1']);
    const db = tier2Db();
    const { client } = fakeClient({ tables: tier2Tables() });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(db.tables.sync_cursors).toHaveLength(0);
    expect(outcome.ok).toBe(true);
    expect(outcome.committed).toBe(false);
  });

  it('leaves the cursor untouched when an applier throws, and keeps running other feeds', async () => {
    tier1(['p1']);
    mockApplyReports.mockRejectedValue(new Error('applier boom'));
    mockApplyPhotos.mockResolvedValue(result({ applied: 1, cursorKeys: ['2026-07-04T00:00:00Z'] }));
    const db = tier2Db();
    const { client } = fakeClient({ tables: tier2Tables() });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(cursorValue(db, SCOPES.reports('p1'))).toBeUndefined();
    expect(cursorValue(db, SCOPES.photos('p1'))).toBe('2026-07-04T00:00:00Z');
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('applier boom');
  });

  it('uses SCOPES for every feed scope string', async () => {
    tier1(['p1']);
    mockApplyReports.mockResolvedValue(result({ cursorKeys: ['t1'] }));
    mockApplySections.mockResolvedValue(result({ cursorKeys: ['t1'] }));
    mockApplyPhotos.mockResolvedValue(result({ cursorKeys: ['t1'] }));
    mockApplyAmendments.mockResolvedValue(result({ cursorKeys: ['t1'] }));
    const db = tier2Db();
    const { client } = fakeClient({ tables: tier2Tables() });

    await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(db.tables.sync_cursors!.map((r) => r.scope).sort()).toEqual(
      [
        SCOPES.reports('p1'),
        SCOPES.sections('p1'),
        SCOPES.photos('p1'),
        SCOPES.amendments('p1'),
      ].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Offline short-circuit
// ---------------------------------------------------------------------------

describe('offline', () => {
  it('short-circuits the remaining feeds on the first offline-classified failure', async () => {
    tier1(['p1']);
    const db = tier2Db();
    const { client, calls } = fakeClient({
      tables: tier2Tables(),
      throwOn: { daily_reports: new TypeError('Network request failed') },
    });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(outcome.offline).toBe(true);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeNull(); // offline-only
    expect(calls.filter((c) => c.table === 'report_sections')).toHaveLength(0);
    expect(calls.filter((c) => c.table === 'report_photos')).toHaveLength(0);
    expect(mockSweepProject).not.toHaveBeenCalled();
  });

  it('classifies a tier-1 transport failure as offline and skips everything after it', async () => {
    const db = fakeDb();
    const { client } = fakeClient({
      tables: tier1Tables(),
      throwOn: { projects: new TypeError('Network request failed') },
    });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(outcome).toEqual({ ok: false, committed: false, offline: true, error: null });
    expect(mockApplyReferenceSnapshot).not.toHaveBeenCalled();
  });

  it('never rejects — a client that throws everywhere still resolves an outcome', async () => {
    const db = fakeDb();
    const { client } = fakeClient({
      tables: tier1Tables(),
      throwOn: {
        projects: new Error('boom'),
        profiles: new Error('boom'),
        project_members: new Error('boom'),
        report_member_prefs: new Error('boom'),
      },
    });

    await expect(
      createPuller(client, db as unknown as Db)({ sessionUserId: USER }),
    ).resolves.toEqual({
      ok: false,
      committed: false,
      offline: false,
      error: expect.stringContaining('boom'),
    });
  });
});

// ---------------------------------------------------------------------------
// Sweeps
// ---------------------------------------------------------------------------

describe('sweeps', () => {
  const SWEEP_DUE = 'pull_sweep_due:p1';
  const SWEEP_LAST = 'pull_sweep_last:p1';

  it('runs the sweep when both id-fetches complete and the floors pass, stamping + consuming the meta keys', async () => {
    tier1(['p1']);
    mockSweepProject.mockResolvedValue(2);
    const db = tier2Db({ sync_meta: [{ key: SWEEP_DUE, value: '2026-07-01T00:00:00Z' }] });
    db.tables.sync_meta!.push({ key: 'active_project_id', value: 'p1' });
    const { client } = fakeClient({ tables: tier2Tables() });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(mockSweepProject).toHaveBeenCalledTimes(1);
    expect(mockSweepProject.mock.calls[0]![1]).toBe('p1');
    expect(mockSweepProject.mock.calls[0]![2]).toEqual(['r1']);
    expect(mockSweepProject.mock.calls[0]![3]).toEqual(['ph1']);
    expect(metaValue(db, SWEEP_DUE)).toBeUndefined();
    expect(typeof metaValue(db, SWEEP_LAST)).toBe('string');
    expect(outcome.committed).toBe(true); // the sweep deleted rows
  });

  it('refuses on floor (c) — empty server set with clean local rows — keeping the sweep-due flag', async () => {
    tier1(['p1']);
    const db = tier2Db({
      sync_meta: [
        { key: 'active_project_id', value: 'p1' },
        { key: SWEEP_DUE, value: '2026-07-01T00:00:00Z' },
      ],
      daily_reports: [{ id: 'r1', project_id: 'p1', _dirty: 0 }],
    });
    const { client } = fakeClient({ tables: tier2Tables({ daily_reports: [] }) });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(mockSweepProject).not.toHaveBeenCalled();
    expect(metaValue(db, SWEEP_DUE)).toBe('2026-07-01T00:00:00Z');
    expect(metaValue(db, SWEEP_LAST)).toBeUndefined();
    expect(outcome.ok).toBe(false);
  });

  it('passes floor (c) on an empty server set when no clean local rows exist', async () => {
    tier1(['p1']);
    const db = tier2Db({
      sync_meta: [
        { key: 'active_project_id', value: 'p1' },
        { key: SWEEP_DUE, value: '2026-07-01T00:00:00Z' },
      ],
      daily_reports: [{ id: 'r1', project_id: 'p1', _dirty: 1 }],
    });
    const { client } = fakeClient({ tables: tier2Tables({ daily_reports: [] }) });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(mockSweepProject).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(true);
  });

  it('skips that project sweep when an id-fetch throws, leaving the flag in place', async () => {
    tier1(['p1']);
    const db = tier2Db({
      sync_meta: [
        { key: 'active_project_id', value: 'p1' },
        { key: SWEEP_DUE, value: '2026-07-01T00:00:00Z' },
      ],
    });
    let sweepFetch = 0;
    const { client } = fakeClient({ tables: tier2Tables() });
    const wrapped = {
      from(table: string) {
        if (table === 'report_photos') {
          sweepFetch += 1;
          if (sweepFetch > 1) throw new Error('sweep boom');
        }
        return (client as unknown as { from: (t: string) => unknown }).from(table);
      },
    } as never;

    const outcome = await createPuller(wrapped, db as unknown as Db)({ sessionUserId: USER });

    expect(mockSweepProject).not.toHaveBeenCalled();
    expect(metaValue(db, SWEEP_DUE)).toBe('2026-07-01T00:00:00Z');
    expect(outcome.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rotation + outcome semantics
// ---------------------------------------------------------------------------

describe('rotation and outcome', () => {
  it('writes the next rotation state back when planPullRun ran', async () => {
    tier1(['p1', 'p2']);
    const db = tier2Db();
    const { client } = fakeClient({ tables: tier2Tables() });

    await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    const rotation = JSON.parse(String(metaValue(db, 'pull_rotation_v1'))) as {
      lastProjectId: string | null;
    };
    expect(rotation.lastProjectId).toBe('p2'); // the non-active pick
  });

  it('treats an unparseable rotation state as nulls rather than failing', async () => {
    tier1(['p1', 'p2']);
    const db = tier2Db({
      sync_meta: [
        { key: 'active_project_id', value: 'p1' },
        { key: 'pull_rotation_v1', value: '{{{' },
      ],
    });
    const { client } = fakeClient({ tables: tier2Tables() });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(outcome.ok).toBe(true);
    expect(JSON.parse(String(metaValue(db, 'pull_rotation_v1')))).toMatchObject({
      lastProjectId: 'p2',
    });
  });

  it('reports committed: false when nothing was written anywhere', async () => {
    tier1(['p1']);
    const db = tier2Db();
    const { client } = fakeClient({ tables: tier2Tables() });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(outcome).toEqual({ ok: true, committed: false, offline: false, error: null });
  });

  it('lets ok: false and committed: true coexist — one feed hard-skips while another lands rows', async () => {
    tier1(['p1']);
    mockApplyReports.mockResolvedValue(
      result({ applied: 3, cursorKeys: ['2026-07-05T00:00:00Z'] }),
    );
    mockApplyPhotos.mockResolvedValue(result({ hardSkipped: 2 }));
    const db = tier2Db();
    const { client } = fakeClient({ tables: tier2Tables() });

    const outcome = await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(outcome.ok).toBe(false);
    expect(outcome.committed).toBe(true);
    expect(cursorValue(db, SCOPES.reports('p1'))).toBe('2026-07-05T00:00:00Z');
  });

  it('pulls the active project first, then the rotation pick', async () => {
    tier1(['p1', 'p2']);
    const db = tier2Db();
    const { client, calls } = fakeClient({ tables: tier2Tables() });

    await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    const reportCalls = calls.filter((c) => c.table === 'daily_reports' && c.select !== 'id');
    expect(reportCalls.map((c) => c.eq[0]![1])).toEqual(['p1', 'p2']);
  });

  it('pulls nothing in tier 2 when the active project is not a member and no rotation pick exists', async () => {
    tier1([]);
    const db = tier2Db();
    const { client, calls } = fakeClient({ tables: tier2Tables() });

    await createPuller(client, db as unknown as Db)({ sessionUserId: USER });

    expect(calls.filter((c) => c.table === 'daily_reports')).toHaveLength(0);
    expect(mockApplyReports).not.toHaveBeenCalled();
  });
});
