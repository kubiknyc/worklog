#!/usr/bin/env node
// Fold qa/web/results/web-results.json into qa/matrix.csv as Web Result /
// Web Evidence / Bug columns (Android Result / Android Evidence left for stage 4).
// Sub-checks named <ID>-<suffix> (e.g. PERM-012-API) merge into <ID>; any Fail wins.
//
//   node qa/web/merge-results.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CSV = join(HERE, '..', 'matrix.csv');
const results = JSON.parse(readFileSync(join(HERE, 'results', 'web-results.json'), 'utf8'));
const BUGS = {
  'STORE-001': 'MULT-55',
  'SYNC-014': 'MULT-56',
  'LIFE-011': 'MULT-57',
  'SECT-015': 'MULT-58',
  'PERM-005': 'MULT-59',
  'DEL-012': 'MULT-60',
  'NAV-008': 'MULT-61',
  'PROJ-001': 'MULT-61',
  'SECT-002': 'MULT-62',
  'SECT-012': 'MULT-63',
};
const RANK = ['Fail', 'Blocked', 'Not testable on web', 'Not built', 'Pass'];

/** Minimal RFC 4180 parser (quoted fields, embedded commas/newlines). */
function parse(text) {
  const rows = [];
  let row = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') ((f += '"'), i++);
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') (row.push(f), (f = ''));
    else if (c === '\n') (row.push(f.replace(/\r$/, '')), rows.push(row), (row = []), (f = ''));
    else f += c;
  }
  if (f || row.length) (row.push(f), rows.push(row));
  return rows;
}
const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const [header, ...rows] = parse(readFileSync(CSV, 'utf8'));
const old = Object.fromEntries(header.map((h, i) => [h, i]));
const out = [
  [
    ...header.slice(0, 7),
    'Web Result',
    'Web Evidence',
    'Bug',
    'Android Result',
    'Android Evidence',
  ],
];
for (const r of rows) {
  const id = r[0];
  const platform = r[4];
  const hits = Object.entries(results).filter(([k]) => k === id || k.startsWith(`${id}-`));
  let result = '';
  let evidence = '';
  if (hits.length) {
    result = hits.map(([, v]) => v.result).sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0];
    evidence = hits.map(([k, v]) => (hits.length > 1 ? `[${k}] ` : '') + v.evidence).join(' | ');
  } else if (platform === 'Android') result = 'n/a (Android only)';
  else if (platform === 'Manual (Eli)') result = 'Manual (Eli)';
  const keep = (h) => (old[h] !== undefined ? (r[old[h]] ?? '') : '');
  out.push([
    ...r.slice(0, 7),
    result,
    evidence,
    BUGS[id] ?? '',
    keep('Android Result'),
    keep('Android Evidence'),
  ]);
}
writeFileSync(CSV, out.map((r) => r.map(esc).join(',')).join('\n') + '\n');
const tally = {};
for (const r of out.slice(1)) tally[r[7] || '(none)'] = (tally[r[7] || '(none)'] ?? 0) + 1;
console.log(`matrix.csv: ${out.length - 1} rows`, tally);
