/**
 * Thin typed wrappers over an open `expo-sqlite` database. Native-only — the web
 * bundle never reaches this file (it's `.native`). Centralizing the calls here
 * gives store/pull/push/repo one import surface and one place to evolve.
 */
import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';

export type Db = SQLiteDatabase;
export type BindValue = SQLiteBindValue;

/** Rows matching a query (empty array when none). */
export function all<T>(db: Db, sql: string, params: BindValue[] = []): Promise<T[]> {
  return db.getAllAsync<T>(sql, params);
}

/** First matching row, or null. */
export function first<T>(db: Db, sql: string, params: BindValue[] = []): Promise<T | null> {
  return db.getFirstAsync<T>(sql, params);
}

/** Execute a write; returns `{ changes, lastInsertRowId }`. */
export function run(db: Db, sql: string, params: BindValue[] = []) {
  return db.runAsync(sql, params);
}

/**
 * Transactions are serialized through this promise chain. expo-sqlite's
 * `withTransactionAsync` is NOT exclusive — statements awaited elsewhere on the
 * same connection interleave inside an open transaction — so a user write
 * landing mid-pull would either fail with a nested-BEGIN error or be absorbed
 * into (and rolled back with) the pull's transaction. Queuing every transaction
 * behind the previous one restores the atomicity the write paths rely on.
 * Callbacks must not call `tx` themselves (they'd deadlock on their own turn);
 * plain `run`/`all`/`first` inside a callback are fine.
 */
let txQueue: Promise<unknown> = Promise.resolve();

/**
 * Run `fn` inside a transaction (committed on resolve, rolled back on throw).
 * The `db` parameter is narrowed to just `withTransactionAsync` (the only method
 * this uses) so callers holding a smaller `Pick` — the repository's `Db` seam,
 * and its widened test fake — can pass it without a cast.
 */
export function tx(
  db: Pick<SQLiteDatabase, 'withTransactionAsync'>,
  fn: () => Promise<void>,
): Promise<void> {
  const turn = txQueue.then(() => db.withTransactionAsync(fn));
  txQueue = turn.catch(() => {}); // a rolled-back transaction must not wedge the queue
  return turn;
}
