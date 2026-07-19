/**
 * Regenerates src/db/serverColumns.generated.json from the sibling
 * jobsight-backend clone's migrations. Run after any backend schema change:
 *   npm run gen:server-columns
 * Tables tracked = the WorkLog app's DOMAIN_COLUMNS tables.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(HERE, '../../jobsight-backend/supabase/migrations');
const OUT = path.resolve(HERE, '../src/db/serverColumns.generated.json');

const TABLES = [
  'profiles', 'projects', 'project_members', 'report_member_prefs', 'daily_reports',
  'report_sections', 'report_crew', 'report_equipment', 'report_work_performed',
  'report_delays', 'report_safety_observations', 'report_weather', 'report_photos',
  'report_amendments', 'report_amendment_changes',
];

const CONSTRAINT_WORDS = new Set([
  'primary', 'unique', 'constraint', 'foreign', 'check', 'exclude', 'like', 'references',
]);

/** Body of the first top-level (...) after `from`, tracking paren depth. */
function parenBody(sql, from) {
  const open = sql.indexOf('(', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    if (sql[i] === ')') { depth -= 1; if (depth === 0) return sql.slice(open + 1, i); }
  }
  return null;
}

/** Split a CREATE TABLE body on top-level commas only. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0; let cur = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else { cur += ch; }
  }
  parts.push(cur);
  return parts;
}

const columns = Object.fromEntries(TABLES.map((t) => [t, new Set()]));
const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

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
    const alterStartRe = new RegExp(`alter table (if exists )?(only )?(public\\.)?${table}\\b`, 'gi');
    for (const m of [...sql.matchAll(alterStartRe)]) {
      const terminator = sql.indexOf(';', m.index);
      const stmt = sql.slice(m.index, terminator < 0 ? sql.length : terminator);
      for (const am of [...stmt.matchAll(/add column (if not exists )?"?([a-z_]+)"?/gi)]) {
        columns[table].add(am[2].toLowerCase());
      }
      for (const dm of [...stmt.matchAll(/drop column (if exists )?"?([a-z_]+)"?/gi)]) {
        columns[table].delete(dm[2].toLowerCase());
      }
    }
  }
}

const out = Object.fromEntries(TABLES.map((t) => [t, [...columns[t]].sort()]));
for (const [t, cols] of Object.entries(out)) {
  if (cols.length === 0) throw new Error(`No columns found for ${t} — parser or migrations problem`);
}
fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`Wrote ${OUT}\n`);
