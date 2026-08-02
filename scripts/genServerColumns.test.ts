/**
 * The parity generator's own guard (#14).
 *
 * `scripts/gen-server-columns.mjs` had no test at all, which is why it could go
 * blind to `ALTER TABLE ... RENAME COLUMN` unnoticed: a rename neither added nor
 * dropped, so the regenerated snapshot came out byte-identical on real drift and
 * `schemaParity.test.ts` compared the app's columns against a file that was
 * already wrong. CI did not catch it either — it regenerates with this same
 * parser and diffs the result against the committed file, so both sides moved
 * together.
 *
 * These tests drive the REAL script as a subprocess against fixture migrations,
 * writing to a temp path via $SERVER_COLUMNS_OUT so the committed snapshot is
 * never touched.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'gen-server-columns.mjs');

/**
 * The tracked-table list, read from the script itself rather than duplicated —
 * the generator throws when any tracked table ends up with zero columns, so a
 * fixture must declare every one of them, and this stays correct as the list
 * grows.
 */
function trackedTables(): string[] {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const block = /const TABLES = \[([\s\S]*?)\];/.exec(src);
  if (!block) throw new Error('could not locate TABLES in gen-server-columns.mjs');
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** Minimal `create table` for every tracked table, so only the table under test varies. */
function baselineSql(except: string): string {
  return trackedTables()
    .filter((t) => t !== except)
    .map((t) => `create table if not exists public.${t} (\n  id uuid primary key\n);`)
    .join('\n\n');
}

function runGenerator(migrations: Record<string, string>): Record<string, string[]> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-server-columns-'));
  try {
    const migrationsDir = path.join(dir, 'migrations');
    fs.mkdirSync(migrationsDir);
    for (const [name, sql] of Object.entries(migrations)) {
      fs.writeFileSync(path.join(migrationsDir, name), sql);
    }
    const out = path.join(dir, 'out.json');
    execFileSync(process.execPath, [SCRIPT], {
      env: { ...process.env, BACKEND_MIGRATIONS_DIR: migrationsDir, SERVER_COLUMNS_OUT: out },
      stdio: 'pipe',
    });
    return JSON.parse(fs.readFileSync(out, 'utf8')) as Record<string, string[]>;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function expectThrows(migrations: Record<string, string>): string {
  try {
    runGenerator(migrations);
  } catch (error) {
    return String((error as { stderr?: Buffer }).stderr ?? error);
  }
  throw new Error('expected the generator to fail, but it succeeded');
}

describe('gen-server-columns', () => {
  it('applies ALTER TABLE ... RENAME COLUMN — the drift #14 was blind to', () => {
    const out = runGenerator({
      '001_init.sql': `${baselineSql('report_photos')}

create table if not exists public.report_photos (
  id uuid primary key,
  caption text
);`,
      '002_rename.sql': `alter table report_photos rename column caption to caption_text;`,
    });

    expect(out.report_photos).toEqual(['caption_text', 'id']);
    expect(out.report_photos).not.toContain('caption');
  });

  it('applies the `column`-less rename shorthand', () => {
    const out = runGenerator({
      '001_init.sql': `${baselineSql('report_photos')}

create table if not exists public.report_photos (
  id uuid primary key,
  caption text
);`,
      '002_rename.sql': `alter table report_photos rename caption to caption_text;`,
    });

    expect(out.report_photos).toEqual(['caption_text', 'id']);
  });

  it('applies add/drop/rename clauses in source order within one statement', () => {
    // Three independent matchAll passes would mis-order this: the drop of `b`
    // must land AFTER the rename that created it.
    const out = runGenerator({
      '001_init.sql': `${baselineSql('report_photos')}

create table if not exists public.report_photos (
  id uuid primary key,
  a text
);`,
      '002_alter.sql': `alter table report_photos
  add column if not exists keep text,
  rename column a to b,
  drop column if exists b;`,
    });

    expect(out.report_photos).toEqual(['id', 'keep']);
  });

  it('still handles plain add and drop column', () => {
    const out = runGenerator({
      '001_init.sql': `${baselineSql('projects')}

create table if not exists public.projects (
  id uuid primary key,
  legacy text
);`,
      '002_alter.sql': `alter table projects add column if not exists name text;
alter table projects drop column if exists legacy;`,
    });

    expect(out.projects).toEqual(['id', 'name']);
  });

  it('fails loudly on a table rename rather than emitting a stale snapshot', () => {
    const message = expectThrows({
      '001_init.sql': baselineSql(''),
      '002_rename_table.sql': `alter table report_photos rename to report_images;`,
    });

    expect(message).toContain('rename to');
    expect(message).toContain('not supported');
  });

  it('fails when a tracked table resolves to zero columns', () => {
    // The pre-existing self-check. Pinned so a refactor cannot quietly drop it.
    const message = expectThrows({ '001_init.sql': `-- no tables at all` });
    expect(message).toContain('No columns found');
  });
});
