/**
 * Regenerates src/db/serverColumns.generated.json from the sibling
 * jobsight-backend clone's migrations. Run after any backend schema change:
 *   npm run gen:server-columns
 * Tables tracked = the WorkLog app's DOMAIN_COLUMNS tables.
 *
 * Migration source resolution:
 *   1. $BACKEND_MIGRATIONS_DIR if set (CI checks the backend out to a path
 *      inside the workspace; actions/checkout refuses to write above it)
 *   2. ../../jobsight-backend/supabase/migrations (the local clone layout
 *      documented in CLAUDE.md)
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = process.env.BACKEND_MIGRATIONS_DIR
  ? path.resolve(process.env.BACKEND_MIGRATIONS_DIR)
  : path.resolve(HERE, '../../jobsight-backend/supabase/migrations');
// $SERVER_COLUMNS_OUT lets a test drive the real script against a fixture
// migrations dir without clobbering the committed snapshot. Nothing in the app
// or CI sets it — both use the default path.
const OUT = process.env.SERVER_COLUMNS_OUT
  ? path.resolve(process.env.SERVER_COLUMNS_OUT)
  : path.resolve(HERE, '../src/db/serverColumns.generated.json');

if (!fs.existsSync(MIGRATIONS_DIR)) {
  console.error(
    `gen-server-columns: no migrations at ${MIGRATIONS_DIR}\n` +
      'Clone jobsight-backend as a sibling of this repo, or set ' +
      'BACKEND_MIGRATIONS_DIR to its supabase/migrations directory.',
  );
  process.exit(1);
}

const TABLES = [
  'profiles',
  'projects',
  'project_members',
  'report_member_prefs',
  'daily_reports',
  'report_sections',
  'report_crew',
  'report_equipment',
  'report_work_performed',
  'report_delays',
  'report_safety_observations',
  'report_weather',
  'report_photos',
  'report_amendments',
  'report_amendment_changes',
];

const CONSTRAINT_WORDS = new Set([
  'primary',
  'unique',
  'constraint',
  'foreign',
  'check',
  'exclude',
  'like',
  'references',
]);

/** Body of the first top-level (...) after `from`, tracking paren depth. */
function parenBody(sql, from) {
  const open = sql.indexOf('(', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    if (sql[i] === ')') {
      depth -= 1;
      if (depth === 0) return sql.slice(open + 1, i);
    }
  }
  return null;
}

/** Split a CREATE TABLE body on top-level commas only. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts;
}

const columns = Object.fromEntries(TABLES.map((t) => [t, new Set()]));
const files = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

for (const file of files) {
  // Strip `--` line comments first: these migrations lean heavily on inline
  // trailing comments, and without stripping them, a comment sitting between
  // one column's trailing comma and the next real column's definition gets
  // swallowed into a single bogus "line" by splitTopLevel below — dropping
  // the real column name and emitting a comment fragment as a fake one.
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').replace(/--[^\n]*/g, '');
  for (const table of TABLES) {
    const createRe = new RegExp(`create table (if not exists )?(public\\.)?${table}\\b`, 'gi');
    for (const m of [...sql.matchAll(createRe)]) {
      const body = parenBody(sql, m.index);
      if (!body) continue;
      for (const line of splitTopLevel(body)) {
        const word = line.trim().split(/\s+/)[0]?.replace(/"/g, '').toLowerCase();
        if (word && !CONSTRAINT_WORDS.has(word)) columns[table].add(word);
      }
    }
    // Scan the whole ALTER TABLE statement (up to its terminating `;`), not
    // just the text immediately after `alter table <t>`: this codebase
    // writes multi-clause statements like
    //   alter table projects add column if not exists a text,
    //     add column if not exists b text, add column if not exists c text;
    // and a regex anchored on `alter table <t> add column` only ever matches
    // the first clause, silently dropping every column added after the
    // first comma.
    const alterStartRe = new RegExp(
      `alter table (if exists )?(only )?(public\\.)?${table}\\b`,
      'gi',
    );
    for (const m of [...sql.matchAll(alterStartRe)]) {
      const terminator = sql.indexOf(';', m.index);
      const stmt = sql.slice(m.index, terminator < 0 ? sql.length : terminator);
      // A table rename would silently orphan every column tracked for it —
      // fail loudly rather than emit a stale snapshot. `rename column a to b`
      // cannot trip this: it has an identifier between `rename` and `to`.
      if (/\brename\s+to\s+/i.test(stmt)) {
        throw new Error(
          `${file}: 'alter table ${table} rename to ...' is not supported by this ` +
            `parser. Update TABLES and this script together, then regenerate.`,
        );
      }
      // One pass in SOURCE ORDER over all three mutating clause forms. Order
      // matters: `add column a, rename column a to b` and `rename a to b, drop
      // column b` both depend on clauses applying as written, which three
      // independent matchAll loops could not do.
      //
      // `rename column` was previously unhandled entirely — a rename neither
      // added nor dropped, so the regenerated snapshot came out byte-identical
      // on real drift and the parity gate passed (#14). CI did not catch it
      // either, because CI regenerates with this same parser and diffs the
      // result against the committed file.
      const clauseRe =
        /add column (?:if not exists )?"?([a-z_]+)"?|drop column (?:if exists )?"?([a-z_]+)"?|rename\s+(?:column\s+)?"?([a-z_]+)"?\s+to\s+"?([a-z_]+)"?/gi;
      for (const c of [...stmt.matchAll(clauseRe)]) {
        const [, added, dropped, renamedFrom, renamedTo] = c;
        if (added) columns[table].add(added.toLowerCase());
        else if (dropped) columns[table].delete(dropped.toLowerCase());
        else if (renamedFrom && renamedTo) {
          columns[table].delete(renamedFrom.toLowerCase());
          columns[table].add(renamedTo.toLowerCase());
        }
      }
    }
  }
}

const out = Object.fromEntries(TABLES.map((t) => [t, [...columns[t]].sort()]));
for (const [t, cols] of Object.entries(out)) {
  if (cols.length === 0)
    throw new Error(`No columns found for ${t} — parser or migrations problem`);
}
fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`Wrote ${OUT}\n`);
