// Shared helpers for the WorkLog web pass (MULT-53). Local stack only.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { QA_PASSWORD, URL_BASE, assertLocal, localKeys } from '../seed/seed-local.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const OUT = join(HERE, 'results');
mkdirSync(OUT, { recursive: true });
const RESULTS = join(OUT, 'web-results.json');

assertLocal(URL_BASE);
export const KEYS = localKeys();
export { URL_BASE, QA_PASSWORD };

export const P = (s) => `0b000000-0000-4000-8000-${s}`;
export const IDS = {
  RIVERSIDE: P('00000000a001'),
  DEPOT: P('00000000a002'),
  PIER9: P('00000000b001'),
  SOLO: P('000000005001'),
  SOLOCO: P('000000006001'),
  R_TODAY: P('00000000d101'), // draft
  R_T1: P('00000000d102'), // submitted
  R_T3: P('00000000d103'), // locked + amended
  R_T2: P('00000000d104'), // locked, incident + delay
  PIER9_T1: P('00000000d301'),
  PHOTO_R: P('00000000f101'),
};
export const email = (role) => `qa-wl-${role}@worklog.test`;

/** Merge one verdict into results/web-results.json. result: Pass | Fail | Not built | Not testable on web | Blocked */
export function record(id, result, evidence, bug = '') {
  const all = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : {};
  all[id] = { result, evidence: String(evidence).slice(0, 600), bug, at: new Date().toISOString() };
  writeFileSync(RESULTS, JSON.stringify(all, null, 2));
  console.log(`${result.padEnd(6)} ${id}  ${String(evidence).slice(0, 160)}`);
}

export const service = () =>
  createClient(URL_BASE, KEYS.service, { auth: { persistSession: false } });

const sessions = new Map();
/** One password sign-in per role per process (auth rate limit is 30 / 5 min). */
export async function as(role) {
  if (sessions.has(role)) return sessions.get(role);
  const c = createClient(URL_BASE, KEYS.anon, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: email(role), password: QA_PASSWORD });
  if (error) throw new Error(`sign-in ${role}: ${error.message}`);
  sessions.set(role, c);
  return c;
}

export async function token(role) {
  const c = await as(role);
  return (await c.auth.getSession()).data.session.access_token;
}

/** Run one check; an exception is a Fail with its message as evidence. */
export async function check(id, fn) {
  try {
    const out = await fn();
    if (out) record(id, out[0], out[1], out[2] ?? '');
  } catch (e) {
    record(id, 'Fail', `exception: ${e.message}`);
  }
}
