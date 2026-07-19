/**
 * Both-directions column parity between the app's SQLite mirror and the
 * server migrations (via the checked-in generated snapshot). Regenerate the
 * snapshot with `npm run gen:server-columns` whenever the backend changes.
 * This is the test class that caught the Phase 3 report_photos width/height
 * mismatch (08-phase3-verification.md, Check 1).
 */
import serverColumns from './serverColumns.generated.json';
import { DOMAIN_COLUMNS, MIGRATIONS, SCHEMA_V1 } from './schema';

/**
 * App-side columns that deliberately have no server counterpart.
 * `local_uri`/`local_thumb_uri` (report_photos device-file pointers) are NOT
 * listed here: schema.ts's own header comment (lines 12-16) documents them
 * as excluded from DOMAIN_COLUMNS entirely, so there is nothing for this map
 * to carve out — DOMAIN_COLUMNS.report_photos never contained them.
 */
const LOCAL_ONLY: Partial<Record<keyof typeof DOMAIN_COLUMNS, readonly string[]>> = {};
/** Server-side columns the app deliberately never mirrors. */
const SERVER_ONLY: Partial<Record<keyof typeof DOMAIN_COLUMNS, readonly string[]>> = {
  // Notification prefs feed server-side triggers only; never read offline.
  // Sanctioned by docs/architecture/06-sync-mappings.md §Tier-1 (profiles row);
  // matches the port source's identical exclusion (PunchLog schema.ts profiles mirror).
  profiles: ['notify_push', 'notify_digest', 'notify_mentions'],
};

const tables = Object.keys(DOMAIN_COLUMNS) as (keyof typeof DOMAIN_COLUMNS)[];

describe('schema parity (app ⇄ server)', () => {
  it('snapshot covers every DOMAIN_COLUMNS table', () => {
    for (const t of tables) expect(Object.keys(serverColumns)).toContain(t);
  });

  for (const table of tables) {
    const server: string[] = (serverColumns as Record<string, string[]>)[table] ?? [];
    const localOnly = LOCAL_ONLY[table] ?? [];
    const serverOnly = SERVER_ONLY[table] ?? [];

    it(`${table}: every server column is mirrored locally`, () => {
      for (const col of server) {
        if (serverOnly.includes(col)) continue;
        expect(DOMAIN_COLUMNS[table]).toContain(col);
      }
    });

    it(`${table}: every local domain column exists on the server`, () => {
      for (const col of DOMAIN_COLUMNS[table]) {
        if (localOnly.includes(col)) continue;
        expect(server).toContain(col);
      }
    });

    it(`${table}: local DDL defines every declared column`, () => {
      const create = SCHEMA_V1.find((s) =>
        new RegExp(`CREATE TABLE IF NOT EXISTS ${table} `).test(s),
      );
      expect(create).toBeDefined();
      const adds = Object.values(MIGRATIONS)
        .flat()
        .filter((s) => new RegExp(`ALTER TABLE ${table} ADD COLUMN `).test(s));
      const ddl = [create, ...adds].join('\n');
      for (const col of DOMAIN_COLUMNS[table]) {
        expect(ddl).toMatch(new RegExp(`\\b${col}\\b`));
      }
    });
  }
});
