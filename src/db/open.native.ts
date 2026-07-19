/**
 * Open the device database and migrate it forward.
 *
 * Versioning rides on SQLite's `PRAGMA user_version`: we read the stored version,
 * apply every `MIGRATIONS[n]` for n above it inside one transaction, then stamp
 * the new version. Idempotent — a half-applied upgrade re-runs cleanly because
 * the DDL is `CREATE … IF NOT EXISTS` and the version only advances on commit.
 */
import { openDatabaseAsync } from 'expo-sqlite';

import { MIGRATIONS, SCHEMA_VERSION } from './schema';
import type { Db } from './rows.native';

const DB_NAME = 'worklog.db';

async function userVersion(db: Db): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

export async function migrate(db: Db): Promise<void> {
  let version = await userVersion(db);
  while (version < SCHEMA_VERSION) {
    const next = version + 1;
    if (!(next in MIGRATIONS)) throw new Error(`Missing migration ${next}`);
    const statements = MIGRATIONS[next];
    await db.withTransactionAsync(async () => {
      for (const sql of statements) await db.execAsync(sql);
      // Stamp the version inside the same transaction as its DDL: SQLite honours
      // `PRAGMA user_version` transactionally, so schema and version commit (or
      // roll back) atomically. A kill between the two can no longer leave the
      // schema upgraded but the version stale — which would re-run the migration
      // and corrupt the first non-idempotent step. `next` is an integer we
      // control, so the unparameterizable pragma interpolation is safe.
      await db.execAsync(`PRAGMA user_version = ${next}`);
    });
    version = next;
  }
}

export async function openDb(): Promise<Db> {
  const db = await openDatabaseAsync(DB_NAME);
  await db.execAsync('PRAGMA journal_mode = WAL');
  await migrate(db);
  return db;
}
