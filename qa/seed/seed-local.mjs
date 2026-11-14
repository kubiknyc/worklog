#!/usr/bin/env node
// WorkLog QA seed runner — LOCAL Supabase stack only. Re-runnable.
//
//   node qa/seed/seed-local.mjs
//
// 1. Removes every worklog-photos / worklog-pdfs object under the fixed QA
//    project ids (photos the tester added in-app included), via the Storage API.
// 2. Pipes seed-local.sql into the local Postgres container (docker exec psql),
//    passing the shared password (-v) and the signature PNG as hex (\set on stdin).
// 3. Uploads the photo bytes the SQL's report_photos rows point at.
//
// Env (all optional):
//   QA_SUPABASE_URL      default http://127.0.0.1:54321 — must be a loopback host
//   QA_DB_CONTAINER      default supabase_db_PUNCH-LOG-NEW
//   QA_BACKEND_DIR       jobsight-backend checkout, used to read `supabase status`
//                        (default ../jobsight-backend next to this repo)
//   QA_SERVICE_ROLE_KEY  local service-role key; read from `supabase status` if unset
//
// Never point this at a hosted project: the URL guard refuses anything that is
// not loopback, and the SQL only ever runs inside the local container.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Shared local-only password for every qa-wl-*@worklog.test account. */
export const QA_PASSWORD = 'qa-local-only-2026';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const ASSETS = join(HERE, 'assets');

export const URL_BASE = (process.env.QA_SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(
  /\/+$/,
  '',
);
const CONTAINER = process.env.QA_DB_CONTAINER ?? 'supabase_db_PUNCH-LOG-NEW';
const BACKEND_DIR = process.env.QA_BACKEND_DIR ?? resolve(REPO, '..', 'jobsight-backend');

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function assertLocal(url) {
  const host = new URL(url).hostname;
  if (!LOOPBACK.has(host)) {
    throw new Error(`Refusing to use ${url}: WorkLog QA runs against the local stack only.`);
  }
}

/** Local keys from `supabase status` (local demo keys — not secrets). */
export function localKeys() {
  const out = execFileSync('supabase', ['status', '-o', 'env'], {
    cwd: BACKEND_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    shell: process.platform === 'win32',
  });
  const env = Object.fromEntries(
    out
      .split(/\r?\n/)
      .map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
  if (!env.API_URL || !LOOPBACK.has(new URL(env.API_URL).hostname)) {
    throw new Error(
      '`supabase status` did not report a local API_URL; is the local stack running?',
    );
  }
  return {
    anon: process.env.QA_ANON_KEY ?? env.ANON_KEY,
    service: process.env.QA_SERVICE_ROLE_KEY ?? env.SERVICE_ROLE_KEY,
  };
}

const P = (s) => `0b000000-0000-4000-8000-${s}`;
const RIVERSIDE = P('00000000a001');
const DEPOT = P('00000000a002');
const PIER9 = P('00000000b001');
const SOLO = P('000000005001');
const SOLOCO = P('000000006001');
const QA_PROJECTS = [RIVERSIDE, DEPOT, PIER9, SOLO, SOLOCO];

/** [project, report, photo, asset] — must match the report_photos rows in seed-local.sql. */
const PHOTOS = [
  [RIVERSIDE, P('00000000d101'), P('00000000f101'), 'site-framing.jpg'],
  [RIVERSIDE, P('00000000d101'), P('00000000f102'), 'site-delivery.jpg'],
  [RIVERSIDE, P('00000000d102'), P('00000000f103'), 'site-framing.jpg'],
  [RIVERSIDE, P('00000000d103'), P('00000000f104'), 'site-concrete.jpg'],
  [DEPOT, P('00000000d201'), P('00000000f105'), 'site-delivery.jpg'],
  [PIER9, P('00000000d301'), P('00000000f106'), 'site-concrete.jpg'],
  [SOLO, P('00000000d401'), P('00000000f107'), 'site-framing.jpg'],
  [SOLOCO, P('00000000d501'), P('00000000f108'), 'site-concrete.jpg'],
];

async function storage(key, method, path, body, headers = {}) {
  const res = await fetch(`${URL_BASE}/storage/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, apikey: key, ...headers },
    body,
  });
  if (!res.ok)
    throw new Error(`storage ${method} ${path} failed: ${res.status} ${await res.text()}`);
  return res.json().catch(() => null);
}

/** Every object name under `prefix` (folders recursed). */
async function listAll(key, bucket, prefix) {
  const entries = await storage(
    key,
    'POST',
    `object/list/${bucket}`,
    JSON.stringify({ prefix, limit: 1000, offset: 0 }),
    { 'Content-Type': 'application/json' },
  );
  const names = [];
  for (const e of entries ?? []) {
    const name = `${prefix}/${e.name}`;
    if (e.id === null) names.push(...(await listAll(key, bucket, name)));
    else names.push(name);
  }
  return names;
}

async function wipeStorage(key) {
  let removed = 0;
  for (const bucket of ['worklog-photos', 'worklog-pdfs']) {
    for (const project of QA_PROJECTS) {
      const names = await listAll(key, bucket, project);
      if (names.length === 0) continue;
      await storage(key, 'DELETE', `object/${bucket}`, JSON.stringify({ prefixes: names }), {
        'Content-Type': 'application/json',
      });
      removed += names.length;
    }
  }
  return removed;
}

function runSql() {
  const sql = readFileSync(join(HERE, 'seed-local.sql'), 'utf8');
  const sigHex = readFileSync(join(ASSETS, 'signature.png')).toString('hex');
  const out = execFileSync(
    'docker',
    [
      'exec',
      '-i',
      CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-v',
      `qa_password=${QA_PASSWORD}`,
    ],
    // sig_hex goes in on stdin (\set) so a failure message doesn't echo 2 KB of hex.
    { input: `\\set sig_hex '${sigHex}'\n${sql}`, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  process.stdout.write(out);
}

async function main() {
  assertLocal(URL_BASE);
  const { service } = localKeys();
  if (!service) throw new Error('`supabase status` printed no SERVICE_ROLE_KEY.');
  console.log(`Removed ${await wipeStorage(service)} old QA storage objects.`);
  runSql();
  for (const [project, report, photo, asset] of PHOTOS) {
    await storage(
      service,
      'POST',
      `object/worklog-photos/${project}/${report}/${photo}.jpg`,
      readFileSync(join(ASSETS, asset)),
      { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
    );
  }
  console.log(`Uploaded ${PHOTOS.length} report photos.`);
  console.log(`WorkLog QA seed done. Accounts: qa-wl-*@worklog.test / ${QA_PASSWORD}`);
}

// Only seed when run directly — verify-roles.mjs imports from this module.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
