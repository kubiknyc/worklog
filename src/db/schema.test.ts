/**
 * `open.native.ts`'s `migrate()` against a fake Db (jest-expo can't open a real
 * SQLite database). `jest.setup.js` mocks async-storage/expo-crypto only, so
 * this file adds its own `expo-sqlite` mock purely so importing `open.native`
 * (which reaches for `openDatabaseAsync` at module scope) doesn't throw —
 * `migrate()` itself never calls it.
 *
 * Caveat: a fake Db can't genuinely reject a duplicate column the way real
 * SQLite would, so the v0→v2 case below asserts the migration SEQUENCE (every
 * MIGRATIONS[n] statement runs exactly once, in order, ending at
 * SCHEMA_VERSION) rather than relying on real constraint enforcement.
 */
import { migrate } from './open.native';
import { MIGRATIONS, SCHEMA_V1, SCHEMA_VERSION } from './schema';

jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn() }));

function fakeDb(initialVersion: number) {
  let version = initialVersion;
  const executed: string[] = [];
  return {
    executed,
    getVersion: () => version,
    async getFirstAsync(sql: string): Promise<{ user_version: number } | null> {
      if (/PRAGMA user_version/i.test(sql)) return { user_version: version };
      return null;
    },
    async execAsync(sql: string): Promise<void> {
      executed.push(sql);
      const versionMatch = sql.match(/PRAGMA user_version = (\d+)/i);
      if (versionMatch) version = Number(versionMatch[1]);
    },
    async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
      await fn();
    },
  };
}

describe('schema migration', () => {
  it('SCHEMA_VERSION is 2 and MIGRATIONS[2] is the sole producer of the revision column', () => {
    expect(SCHEMA_VERSION).toBe(2);
    expect(MIGRATIONS[2]).toEqual([
      'ALTER TABLE sync_mutations ADD COLUMN revision INTEGER NOT NULL DEFAULT 0',
    ]);
    // SCHEMA_V1 stays byte-identical — no `revision` column snuck into the
    // sync_mutations CREATE TABLE statement.
    const syncMutationsCreate = SCHEMA_V1.find((s) =>
      /CREATE TABLE IF NOT EXISTS sync_mutations/i.test(s),
    );
    expect(syncMutationsCreate).toBeDefined();
    expect(syncMutationsCreate).not.toMatch(/revision/i);
  });

  it('v1 → v2 upgrade runs only MIGRATIONS[2] and lands at version 2', async () => {
    const db = fakeDb(1);
    await migrate(db as never);

    expect(db.getVersion()).toBe(2);
    // Only the v2 ALTER + its version stamp — SCHEMA_V1's CREATE TABLEs never re-run.
    expect(db.executed).toEqual([...MIGRATIONS[2]!, 'PRAGMA user_version = 2']);
  });

  it('v0 → v2 fresh install runs MIGRATIONS[1] then MIGRATIONS[2] in sequence', async () => {
    const db = fakeDb(0);
    await migrate(db as never);

    expect(db.getVersion()).toBe(2);
    expect(db.executed).toEqual([
      ...MIGRATIONS[1]!,
      'PRAGMA user_version = 1',
      ...MIGRATIONS[2]!,
      'PRAGMA user_version = 2',
    ]);
    // Sequence check only (documented caveat): the fake can't detect a real
    // `duplicate column name` error the way SQLite would if the column were
    // also present in SCHEMA_V1.
  });

  it('an already-current device (v2) runs no migrations', async () => {
    const db = fakeDb(2);
    await migrate(db as never);

    expect(db.getVersion()).toBe(2);
    expect(db.executed).toEqual([]);
  });
});
