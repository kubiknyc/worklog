/**
 * Pure keyset pagination over PostgREST. No IO of its own — the caller supplies
 * a builder factory. Kept separate from the native pull module so it can be
 * unit-tested without pulling in the native SQLite / Supabase layers.
 *
 * Why keyset and not offset (`.range()`): offset pagination is only sound over
 * an immutable, totally-ordered snapshot, and separate PostgREST requests are
 * separate transactions. Without an ORDER BY, Postgres guarantees no stable
 * order at all, so a row can fall between two pages of the same scan; even with
 * an ORDER BY on a mutable, non-unique column (`updated_at`), a concurrent
 * write shifts rows across page boundaries and a row is skipped or duplicated.
 * Keyset pagination re-anchors each page on the last row actually seen
 * (`key > last`), so concurrent writes can only add rows ahead of the scan,
 * never shift unseen rows behind it.
 */

/**
 * Rows requested per page. Every page passes this via an explicit `.limit()` —
 * we never rely on the server's `db-max-rows` default being any particular
 * value (a lower server cap would otherwise silently truncate pages and break
 * the `batch.length < PAGE_SIZE` termination test).
 */
export const PAGE_SIZE = 1000;

export interface PageResult<T> {
  data: T[] | null;
  error: unknown;
}

/** Minimal builder surface for an id-keyset scan (satisfied by supabase-js). */
export interface IdPageQuery<T> {
  order(column: string, options: { ascending: boolean }): this;
  gt(column: string, value: string): this;
  limit(count: number): PromiseLike<PageResult<T>>;
}

/** Builder surface for a compound-keyset scan (satisfied by supabase-js). */
export interface KeysetPageQuery<T> extends IdPageQuery<T> {
  gte(column: string, value: string): this;
  or(filters: string): this;
}

/**
 * Quote a value for use inside a PostgREST `or=(...)` filter string.
 *
 * PostgREST parses the or-group itself — splitting conditions on `,` and the
 * `column.operator.value` parts on `.` — so any VALUE containing reserved
 * characters (`,` `.` `:` `(` `)`) must be double-quoted or it corrupts the
 * parse. ISO timestamps always contain `:`, usually `.` (fractional seconds),
 * and possibly `+` (zone offset), so we always quote. Inside the quotes,
 * PostgREST accepts backslash escapes for `"` and `\`. URL transport is a
 * separate concern: supabase-js percent-encodes the whole query parameter, so
 * a `+` survives as `%2B` rather than decoding to a space.
 */
export function quoteOrValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * PostgREST `.or()` filter selecting rows strictly AFTER the compound key
 * `(primary, tiebreak)` in ascending `(primaryCol, tiebreakCol)` order:
 *
 *   primaryCol > primary  OR  (primaryCol = primary AND tiebreakCol > tiebreak)
 *
 * With a unique tiebreak column this is a strict total order, so paging with it
 * can neither skip nor repeat a row that existed when the scan started.
 */
export function keysetAfter(
  primaryCol: string,
  primary: string,
  tiebreakCol: string,
  tiebreak: string,
): string {
  const p = quoteOrValue(primary);
  const t = quoteOrValue(tiebreak);
  return `${primaryCol}.gt.${p},and(${primaryCol}.eq.${p},${tiebreakCol}.gt.${t})`;
}

/** A compound keyset position: column names, or the values of one row. */
export interface CompoundKey {
  readonly primary: string;
  readonly tiebreak: string;
}

/**
 * Fetch every row of a query, keyset-paginated on the unique `id` column.
 * `make` must return a FRESH builder each call (ordering and the keyset filter
 * are applied per page). Throws on the first page error, so callers never act
 * on a truncated/partial set — load-bearing for reconciliation, where a short
 * read would evict genuinely-visible rows.
 */
export async function selectAllById<T extends { id: string }>(
  make: () => IdPageQuery<T>,
): Promise<T[]> {
  const out: T[] = [];
  let lastId: string | null = null;
  for (;;) {
    let q = make().order('id', { ascending: true });
    if (lastId !== null) q = q.gt('id', lastId);
    const { data, error } = await q.limit(PAGE_SIZE);
    if (error) throw error;
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break; // short page ⇒ nothing after it
    lastId = batch[batch.length - 1].id;
  }
  return out;
}

/**
 * Fetch every row of a query, keyset-paginated on a compound
 * `(columns.primary, columns.tiebreak)` key — e.g. `(updated_at, id)` for the
 * incremental item pull, or `(project_id, user_id)` for a table whose primary
 * key is composite. `keyOf` extracts the key values from a row.
 *
 * `floor`, when given, is an inclusive lower bound on the primary column
 * (`primary >= floor`) applied to EVERY page. The first page has only this
 * filter; later pages add the strict compound keyset from the last row seen.
 * The keyset already subsumes the floor (order is ascending), but keeping both
 * is harmless — they compose — and simpler to reason about.
 *
 * Same error contract as `selectAllById`: throws rather than returning a
 * partial set.
 */
export async function selectAllKeyset<T>(
  make: () => KeysetPageQuery<T>,
  columns: CompoundKey,
  keyOf: (row: T) => CompoundKey,
  floor?: string | null,
): Promise<T[]> {
  const out: T[] = [];
  let last: CompoundKey | null = null;
  for (;;) {
    let q = make();
    if (floor != null) q = q.gte(columns.primary, floor);
    if (last !== null) {
      q = q.or(keysetAfter(columns.primary, last.primary, columns.tiebreak, last.tiebreak));
    }
    const { data, error } = await q
      .order(columns.primary, { ascending: true })
      .order(columns.tiebreak, { ascending: true })
      .limit(PAGE_SIZE);
    if (error) throw error;
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break; // short page ⇒ nothing after it
    last = keyOf(batch[batch.length - 1]);
  }
  return out;
}

/** A triple keyset position: column names, or the values of one row. */
export interface TripleKey {
  readonly primary: string;
  readonly second: string;
  readonly third: string;
}

/**
 * PostgREST `.or()` filter selecting rows strictly AFTER the triple key
 * `(primary, second, third)` in ascending `(primaryCol, secondCol, thirdCol)`
 * order:
 *
 *   primaryCol > primary
 *   OR (primaryCol = primary AND secondCol > second)
 *   OR (primaryCol = primary AND secondCol = second AND thirdCol > third)
 *
 * With a unique `(second, third)` — or unique `third` alone — this is a
 * strict total order, so paging with it can neither skip nor repeat a row
 * that existed when the scan started. Mirrors `keysetAfter` one column wider,
 * for tables whose natural pull order needs a middle tiebreak (e.g.
 * `updated_at, report_id, section`) before the final unique column.
 */
export function keysetAfter3(cols: TripleKey, vals: TripleKey): string {
  const p = quoteOrValue(vals.primary);
  const s = quoteOrValue(vals.second);
  const t = quoteOrValue(vals.third);
  return (
    `${cols.primary}.gt.${p},` +
    `and(${cols.primary}.eq.${p},${cols.second}.gt.${s}),` +
    `and(${cols.primary}.eq.${p},${cols.second}.eq.${s},${cols.third}.gt.${t})`
  );
}

/**
 * Fetch every row of a query, keyset-paginated on a triple
 * `(columns.primary, columns.second, columns.third)` key — e.g.
 * `(updated_at, report_id, section)` for a section pull whose rows aren't
 * uniquely ordered by `(updated_at, report_id)` alone. `keyOf` extracts the
 * key values from a row.
 *
 * Mirrors `selectAllKeyset`'s protocol exactly, one column wider: `floor`
 * (when given) is an inclusive lower bound on the primary column applied to
 * EVERY page; the first page has only that filter, later pages add the
 * strict triple keyset from the last row seen. Same error contract: throws
 * rather than returning a partial set.
 */
export async function selectAllKeyset3<T>(
  make: () => KeysetPageQuery<T>,
  columns: TripleKey,
  keyOf: (row: T) => TripleKey,
  floor?: string | null,
): Promise<T[]> {
  const out: T[] = [];
  let last: TripleKey | null = null;
  for (;;) {
    let q = make();
    if (floor != null) q = q.gte(columns.primary, floor);
    if (last !== null) {
      q = q.or(keysetAfter3(columns, last));
    }
    const { data, error } = await q
      .order(columns.primary, { ascending: true })
      .order(columns.second, { ascending: true })
      .order(columns.third, { ascending: true })
      .limit(PAGE_SIZE);
    if (error) throw error;
    const batch = data ?? [];
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break; // short page ⇒ nothing after it
    last = keyOf(batch[batch.length - 1]);
  }
  return out;
}
