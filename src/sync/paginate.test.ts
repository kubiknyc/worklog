import {
  keysetAfter,
  keysetAfter3,
  quoteOrValue,
  selectAllById,
  selectAllKeyset,
  selectAllKeyset3,
  PAGE_SIZE,
  type IdPageQuery,
  type KeysetPageQuery,
  type PageResult,
  type TripleKey,
} from './paginate';

/** Zero-padded ids so string order matches numeric order. */
function pid(i: number): string {
  return String(i).padStart(6, '0');
}

// ---------------------------------------------------------------------------
// Pure filter-string builders
// ---------------------------------------------------------------------------

describe('quoteOrValue', () => {
  it('double-quotes the value (ISO timestamps hold PostgREST-reserved ":" "." "+")', () => {
    expect(quoteOrValue('2026-07-02T10:00:00.123456+02:00')).toBe(
      '"2026-07-02T10:00:00.123456+02:00"',
    );
  });

  it('backslash-escapes embedded quotes and backslashes', () => {
    expect(quoteOrValue('a"b')).toBe('"a\\"b"');
    expect(quoteOrValue('a\\b')).toBe('"a\\\\b"');
  });
});

describe('keysetAfter', () => {
  it('builds the compound strictly-after filter with quoted values', () => {
    expect(keysetAfter('updated_at', '2026-07-02T10:00:00Z', 'id', 'abc-123')).toBe(
      'updated_at.gt."2026-07-02T10:00:00Z",and(updated_at.eq."2026-07-02T10:00:00Z",id.gt."abc-123")',
    );
  });

  it('quotes timestamps with fractional seconds and timezone offsets verbatim', () => {
    const ts = '2026-07-02T10:00:00.123456+02:00';
    expect(keysetAfter('created_at', ts, 'id', 'x')).toBe(
      `created_at.gt."${ts}",and(created_at.eq."${ts}",id.gt."x")`,
    );
  });
});

// ---------------------------------------------------------------------------
// selectAllById — keyset scan on the unique id column
// ---------------------------------------------------------------------------

interface IdPageCall {
  gt: string | null;
  limit: number;
  ordered: boolean;
}

/**
 * A fake PostgREST builder that evaluates `.order('id')` + `.gt('id', v)` +
 * `.limit(n)` semantically against an in-memory table, recording each page
 * request so tests can assert the paging protocol.
 */
function fakeIdTable<T extends { id: string }>(
  rows: T[],
  calls: IdPageCall[],
  failOnPage?: number,
): () => IdPageQuery<T> {
  return () => {
    let gtVal: string | null = null;
    let ordered = false;
    const q: IdPageQuery<T> = {
      order(column, options) {
        expect(column).toBe('id');
        expect(options.ascending).toBe(true);
        ordered = true;
        return q as never;
      },
      gt(column, value) {
        expect(column).toBe('id');
        gtVal = value;
        return q as never;
      },
      limit(count): Promise<PageResult<T>> {
        calls.push({ gt: gtVal, limit: count, ordered });
        if (failOnPage !== undefined && calls.length === failOnPage) {
          return Promise.resolve({ data: null, error: { message: `page ${failOnPage} failed` } });
        }
        const data = [...rows]
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
          .filter((r) => gtVal === null || r.id > gtVal)
          .slice(0, count);
        return Promise.resolve({ data, error: null });
      },
    };
    return q;
  };
}

describe('selectAllById', () => {
  it('returns everything when it fits in one page', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: pid(i) }));
    const calls: IdPageCall[] = [];
    expect(await selectAllById(fakeIdTable(rows, calls))).toHaveLength(10);
    expect(calls).toEqual([{ gt: null, limit: PAGE_SIZE, ordered: true }]);
  });

  it('fetches all rows across pages, re-anchoring each page on the last id seen', async () => {
    const total = PAGE_SIZE * 2 + 137; // three pages
    const rows = Array.from({ length: total }, (_, i) => ({ id: pid(i) }));
    const calls: IdPageCall[] = [];
    const result = await selectAllById(fakeIdTable(rows, calls));

    expect(result).toHaveLength(total);
    expect(result.map((r) => r.id)).toEqual(rows.map((r) => r.id)); // order + completeness
    expect(calls.map((c) => c.gt)).toEqual([null, pid(PAGE_SIZE - 1), pid(2 * PAGE_SIZE - 1)]);
    expect(calls.every((c) => c.limit === PAGE_SIZE && c.ordered)).toBe(true); // explicit limit + order on EVERY page
  });

  it('stops after an exactly-PAGE_SIZE result by reading one empty page', async () => {
    const rows = Array.from({ length: PAGE_SIZE }, (_, i) => ({ id: pid(i) }));
    const calls: IdPageCall[] = [];
    const result = await selectAllById(fakeIdTable(rows, calls));
    expect(result).toHaveLength(PAGE_SIZE);
    expect(calls.map((c) => c.gt)).toEqual([null, pid(PAGE_SIZE - 1)]); // second page comes back empty → stop
  });

  it('throws on a first-page error so callers never act on a truncated set', async () => {
    const calls: IdPageCall[] = [];
    await expect(selectAllById(fakeIdTable([{ id: 'a' }], calls, 1))).rejects.toEqual({
      message: 'page 1 failed',
    });
  });

  it('throws if a later page errors mid-pagination (no partial result)', async () => {
    const rows = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({ id: pid(i) }));
    const calls: IdPageCall[] = [];
    await expect(selectAllById(fakeIdTable(rows, calls, 2))).rejects.toEqual({
      message: 'page 2 failed',
    });
  });
});

// ---------------------------------------------------------------------------
// selectAllKeyset — compound (timestamp, id) keyset scan
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  ts: string;
}

interface KeysetPageCall {
  gte: string | null;
  or: string | null;
  limit: number;
  orderedBy: string[];
}

/** Parse the exact string `keysetAfter` emits back into its two values. */
function parseKeysetOr(filter: string): { primary: string; tiebreak: string } {
  const m = /^\w+\.gt\."([^"]*)",and\(\w+\.eq\."[^"]*",\w+\.gt\."([^"]*)"\)$/.exec(filter);
  if (!m) throw new Error(`unparseable keyset or-filter: ${filter}`);
  return { primary: m[1], tiebreak: m[2] };
}

/**
 * A fake PostgREST builder over `Row { id, ts }` keyed on (ts, id). It applies
 * `.gte(ts)`, the `.or()` compound-keyset filter, ordering, and `.limit()`
 * semantically, so the tests exercise the real page-boundary behavior
 * (duplicate timestamps straddling a boundary included).
 */
function fakeTsTable(
  rows: Row[],
  calls: KeysetPageCall[],
  failOnPage?: number,
): () => KeysetPageQuery<Row> {
  return () => {
    let gteVal: string | null = null;
    let orVal: string | null = null;
    const orderedBy: string[] = [];
    const q: KeysetPageQuery<Row> = {
      order(column, options) {
        expect(options.ascending).toBe(true);
        orderedBy.push(column);
        return q as never;
      },
      gt() {
        throw new Error('selectAllKeyset must not use bare .gt()');
      },
      gte(column, value) {
        expect(column).toBe('ts');
        gteVal = value;
        return q as never;
      },
      or(filters) {
        orVal = filters;
        return q as never;
      },
      limit(count): Promise<PageResult<Row>> {
        calls.push({ gte: gteVal, or: orVal, limit: count, orderedBy: [...orderedBy] });
        if (failOnPage !== undefined && calls.length === failOnPage) {
          return Promise.resolve({ data: null, error: { message: `page ${failOnPage} failed` } });
        }
        expect(orderedBy).toEqual(['ts', 'id']); // compound order on every page
        const after = orVal === null ? null : parseKeysetOr(orVal);
        const data = [...rows]
          .sort((a, b) => (a.ts === b.ts ? (a.id < b.id ? -1 : 1) : a.ts < b.ts ? -1 : 1))
          .filter((r) => gteVal === null || r.ts >= gteVal)
          .filter(
            (r) =>
              after === null ||
              r.ts > after.primary ||
              (r.ts === after.primary && r.id > after.tiebreak),
          )
          .slice(0, count);
        return Promise.resolve({ data, error: null });
      },
    };
    return q;
  };
}

const KEY = { primary: 'ts', tiebreak: 'id' } as const;
const keyOf = (r: Row) => ({ primary: r.ts, tiebreak: r.id });

/** `count` rows; `tsOf` maps an index to its timestamp (collisions allowed). */
function makeRows(count: number, tsOf: (i: number) => string): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: pid(i), ts: tsOf(i) }));
}

describe('selectAllKeyset', () => {
  const T = (n: number) => `2026-07-02T10:00:${String(n).padStart(2, '0')}.000Z`;

  it('returns everything when it fits in one page, with no keyset filter', async () => {
    const rows = makeRows(10, () => T(0));
    const calls: KeysetPageCall[] = [];
    const result = await selectAllKeyset(fakeTsTable(rows, calls), KEY, keyOf);
    expect(result).toHaveLength(10);
    expect(calls).toEqual([{ gte: null, or: null, limit: PAGE_SIZE, orderedBy: ['ts', 'id'] }]);
  });

  it('pages by compound keyset without skipping or duplicating rows that share a boundary timestamp', async () => {
    // Give EVERY row the same timestamp: the worst case for timestamp-only
    // paging, where offset or non-compound keyset would skip or loop.
    const total = PAGE_SIZE * 2 + 137;
    const rows = makeRows(total, () => T(1));
    const calls: KeysetPageCall[] = [];
    const result = await selectAllKeyset(fakeTsTable(rows, calls), KEY, keyOf);

    expect(result).toHaveLength(total);
    expect(new Set(result.map((r) => r.id)).size).toBe(total); // no duplicates
    expect(result.map((r) => r.id)).toEqual(rows.map((r) => r.id)); // no skips, stable order
    // Pages 2+ anchor on the last (ts, id) actually seen.
    expect(calls.map((c) => c.or)).toEqual([
      null,
      `ts.gt."${T(1)}",and(ts.eq."${T(1)}",id.gt."${pid(PAGE_SIZE - 1)}")`,
      `ts.gt."${T(1)}",and(ts.eq."${T(1)}",id.gt."${pid(2 * PAGE_SIZE - 1)}")`,
    ]);
    expect(calls.every((c) => c.limit === PAGE_SIZE)).toBe(true); // explicit limit on EVERY page
  });

  it('applies the inclusive floor on every page, composing with the keyset', async () => {
    const total = PAGE_SIZE + 50;
    // First 40 rows are older than the floor and must not appear.
    const rows = makeRows(total + 40, (i) => (i < 40 ? T(0) : T(2)));
    const calls: KeysetPageCall[] = [];
    const result = await selectAllKeyset(fakeTsTable(rows, calls), KEY, keyOf, T(1));

    expect(result).toHaveLength(total);
    expect(result.every((r) => r.ts >= T(1))).toBe(true);
    expect(calls.map((c) => c.gte)).toEqual([T(1), T(1)]); // floor on page 1 AND page 2
    expect(calls[1].or).toBe(
      `ts.gt."${T(2)}",and(ts.eq."${T(2)}",id.gt."${pid(40 + PAGE_SIZE - 1)}")`,
    );
  });

  it('skips the floor filter when there is no cursor yet', async () => {
    const calls: KeysetPageCall[] = [];
    await selectAllKeyset(fakeTsTable(makeRows(3, T), calls), KEY, keyOf, null);
    expect(calls[0].gte).toBeNull();
  });

  it('stops after an exactly-PAGE_SIZE result by reading one empty page', async () => {
    const rows = makeRows(PAGE_SIZE, (i) => T(i % 7)); // mixed timestamps
    const calls: KeysetPageCall[] = [];
    const result = await selectAllKeyset(fakeTsTable(rows, calls), KEY, keyOf);
    expect(result).toHaveLength(PAGE_SIZE);
    expect(calls).toHaveLength(2); // second page comes back empty → stop
    expect(calls[1].or).not.toBeNull();
  });

  it('throws on a page error so callers never act on a truncated set', async () => {
    const calls: KeysetPageCall[] = [];
    await expect(
      selectAllKeyset(fakeTsTable(makeRows(3, T), calls, 1), KEY, keyOf),
    ).rejects.toEqual({ message: 'page 1 failed' });
  });

  it('throws if a later page errors mid-pagination (no partial result)', async () => {
    const rows = makeRows(PAGE_SIZE + 5, () => T(1));
    const calls: KeysetPageCall[] = [];
    await expect(selectAllKeyset(fakeTsTable(rows, calls, 2), KEY, keyOf)).rejects.toEqual({
      message: 'page 2 failed',
    });
  });
});

// ---------------------------------------------------------------------------
// keysetAfter3 / selectAllKeyset3 — compound (primary, second, third) keyset scan
// ---------------------------------------------------------------------------

describe('keysetAfter3', () => {
  it('builds the triple strictly-after filter with quoted values', () => {
    expect(
      keysetAfter3(
        { primary: 'updated_at', second: 'report_id', third: 'section' },
        { primary: 'p', second: 's', third: 't' },
      ),
    ).toBe(
      'updated_at.gt."p",and(updated_at.eq."p",report_id.gt."s"),and(updated_at.eq."p",report_id.eq."s",section.gt."t")',
    );
  });

  it('quotes every value, including reserved characters in the primary timestamp', () => {
    const ts = '2026-07-02T10:00:00.123456+02:00';
    expect(
      keysetAfter3(
        { primary: 'updated_at', second: 'report_id', third: 'section' },
        { primary: ts, second: 'r1', third: 'daily' },
      ),
    ).toBe(
      `updated_at.gt."${ts}",and(updated_at.eq."${ts}",report_id.gt."r1"),and(updated_at.eq."${ts}",report_id.eq."r1",section.gt."daily")`,
    );
  });
});

interface Row3 {
  id: string;
  primary: string;
  second: string;
  third: string;
}

interface Keyset3PageCall {
  gte: string | null;
  or: string | null;
  limit: number;
  orderedBy: string[];
}

const COLS3: TripleKey = { primary: 'ts', second: 'rid', third: 'sec' };
const keyOf3 = (r: Row3): TripleKey => ({ primary: r.primary, second: r.second, third: r.third });

function cmpRow3(a: Row3, b: Row3): number {
  if (a.primary !== b.primary) return a.primary < b.primary ? -1 : 1;
  if (a.second !== b.second) return a.second < b.second ? -1 : 1;
  if (a.third !== b.third) return a.third < b.third ? -1 : 1;
  return 0;
}

function afterKey3(r: Row3, k: TripleKey): boolean {
  if (r.primary !== k.primary) return r.primary > k.primary;
  if (r.second !== k.second) return r.second > k.second;
  return r.third > k.third;
}

/**
 * A fake PostgREST builder over `Row3` keyed on (primary, second, third).
 * Mirrors `fakeTsTable`'s semantic-fake idiom: applies `.gte`, `.or`, order,
 * and `.limit()` for real, so boundary behavior is exercised rather than
 * merely asserted on call shape.
 */
function fakeTriple3Table(
  rows: Row3[],
  calls: Keyset3PageCall[],
  failOnPage?: number,
): () => KeysetPageQuery<Row3> {
  return () => {
    let gteVal: string | null = null;
    let orVal: string | null = null;
    const orderedBy: string[] = [];
    const q: KeysetPageQuery<Row3> = {
      order(column, options) {
        expect(options.ascending).toBe(true);
        orderedBy.push(column);
        return q as never;
      },
      gt() {
        throw new Error('selectAllKeyset3 must not use bare .gt()');
      },
      gte(column, value) {
        expect(column).toBe('ts');
        gteVal = value;
        return q as never;
      },
      or(filters) {
        orVal = filters;
        return q as never;
      },
      limit(count): Promise<PageResult<Row3>> {
        calls.push({ gte: gteVal, or: orVal, limit: count, orderedBy: [...orderedBy] });
        if (failOnPage !== undefined && calls.length === failOnPage) {
          return Promise.resolve({ data: null, error: { message: `page ${failOnPage} failed` } });
        }
        expect(orderedBy).toEqual(['ts', 'rid', 'sec']); // triple order on every page
        const data = [...rows]
          .sort(cmpRow3)
          .filter((r) => gteVal === null || r.primary >= gteVal)
          .filter((r) => orVal === null || afterKey3(r, parseOr3(orVal)))
          .slice(0, count);
        return Promise.resolve({ data, error: null });
      },
    };
    return q;
  };
}

/** Recover the (primary, second, third) values from a `keysetAfter3` filter string. */
function parseOr3(filter: string): TripleKey {
  const re =
    /^\w+\.gt\."([^"]*)",and\(\w+\.eq\."[^"]*",\w+\.gt\."([^"]*)"\),and\(\w+\.eq\."[^"]*",\w+\.eq\."[^"]*",\w+\.gt\."([^"]*)"\)$/;
  const m = filter.match(re);
  if (!m) throw new Error(`unparseable triple keyset or-filter: ${filter}`);
  return { primary: m[1], second: m[2], third: m[3] };
}

function makeRows3(
  count: number,
  keyOf: (i: number) => { primary: string; second: string },
): Row3[] {
  return Array.from({ length: count }, (_, i) => {
    const { primary, second } = keyOf(i);
    return { id: pid(i), primary, second, third: pid(i) };
  });
}

describe('selectAllKeyset3', () => {
  const T = (n: number) => `2026-07-02T10:00:${String(n).padStart(2, '0')}.000Z`;

  it('returns everything when it fits in one page, with no keyset filter', async () => {
    const rows = makeRows3(10, () => ({ primary: T(0), second: 'r1' }));
    const calls: Keyset3PageCall[] = [];
    const result = await selectAllKeyset3(fakeTriple3Table(rows, calls), COLS3, keyOf3);
    expect(result).toHaveLength(10);
    expect(calls).toEqual([
      { gte: null, or: null, limit: PAGE_SIZE, orderedBy: ['ts', 'rid', 'sec'] },
    ]);
  });

  it('pages by triple keyset without skipping or duplicating rows sharing (primary, second)', async () => {
    // Every row shares BOTH primary and second: the worst case for a
    // 2-column keyset, which would loop or skip without the third column.
    const total = PAGE_SIZE * 2 + 137;
    const rows = makeRows3(total, () => ({ primary: T(1), second: 'r1' }));
    const calls: Keyset3PageCall[] = [];
    const result = await selectAllKeyset3(fakeTriple3Table(rows, calls), COLS3, keyOf3);

    expect(result).toHaveLength(total);
    expect(new Set(result.map((r) => r.id)).size).toBe(total); // no duplicates
    expect(result.map((r) => r.id)).toEqual(rows.map((r) => r.id)); // no skips, stable order
    expect(calls.map((c) => c.or)).toEqual([
      null,
      `ts.gt."${T(1)}",and(ts.eq."${T(1)}",rid.gt."r1"),and(ts.eq."${T(1)}",rid.eq."r1",sec.gt."${pid(PAGE_SIZE - 1)}")`,
      `ts.gt."${T(1)}",and(ts.eq."${T(1)}",rid.gt."r1"),and(ts.eq."${T(1)}",rid.eq."r1",sec.gt."${pid(2 * PAGE_SIZE - 1)}")`,
    ]);
    expect(calls.every((c) => c.limit === PAGE_SIZE)).toBe(true); // explicit limit on EVERY page
  });

  it('applies the inclusive floor on every page, composing with the keyset', async () => {
    const total = PAGE_SIZE + 50;
    // First 40 rows are older than the floor and must not appear.
    const rows = makeRows3(total + 40, (i) => ({
      primary: i < 40 ? T(0) : T(2),
      second: 'r1',
    }));
    const calls: Keyset3PageCall[] = [];
    const result = await selectAllKeyset3(fakeTriple3Table(rows, calls), COLS3, keyOf3, T(1));

    expect(result).toHaveLength(total);
    expect(result.every((r) => r.primary >= T(1))).toBe(true);
    expect(calls.map((c) => c.gte)).toEqual([T(1), T(1)]); // floor on page 1 AND page 2
    expect(calls[1].or).toBe(
      `ts.gt."${T(2)}",and(ts.eq."${T(2)}",rid.gt."r1"),and(ts.eq."${T(2)}",rid.eq."r1",sec.gt."${pid(40 + PAGE_SIZE - 1)}")`,
    );
  });

  it('skips the floor filter when there is no cursor yet', async () => {
    const calls: Keyset3PageCall[] = [];
    await selectAllKeyset3(
      fakeTriple3Table(
        makeRows3(3, (i) => ({ primary: T(i), second: 'r1' })),
        calls,
      ),
      COLS3,
      keyOf3,
      null,
    );
    expect(calls[0].gte).toBeNull();
  });

  it('stops after an exactly-PAGE_SIZE result by reading one empty page', async () => {
    const rows = makeRows3(PAGE_SIZE, (i) => ({ primary: T(i % 7), second: 'r1' })); // mixed timestamps
    const calls: Keyset3PageCall[] = [];
    const result = await selectAllKeyset3(fakeTriple3Table(rows, calls), COLS3, keyOf3);
    expect(result).toHaveLength(PAGE_SIZE);
    expect(calls).toHaveLength(2); // second page comes back empty → stop
    expect(calls[1].or).not.toBeNull();
  });

  it('throws on a page error so callers never act on a truncated set', async () => {
    const calls: Keyset3PageCall[] = [];
    await expect(
      selectAllKeyset3(
        fakeTriple3Table(
          makeRows3(3, (i) => ({ primary: T(i), second: 'r1' })),
          calls,
          1,
        ),
        COLS3,
        keyOf3,
      ),
    ).rejects.toEqual({ message: 'page 1 failed' });
  });

  it('throws if a later page errors mid-pagination (no partial result)', async () => {
    const rows = makeRows3(PAGE_SIZE + 5, () => ({ primary: T(1), second: 'r1' }));
    const calls: Keyset3PageCall[] = [];
    await expect(selectAllKeyset3(fakeTriple3Table(rows, calls, 2), COLS3, keyOf3)).rejects.toEqual(
      {
        message: 'page 2 failed',
      },
    );
  });
});
