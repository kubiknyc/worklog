#!/usr/bin/env node
// WorkLog QA role check — LOCAL stack only. Run after seed-local.mjs.
//
//   node qa/seed/verify-roles.mjs
//
// Signs in as every qa-wl-* account through GoTrue (anon key, password grant)
// and reads through PostgREST / Storage exactly as the app does, so every
// count below is what RLS lets that user see. Also replays the client half of
// the delete-account warning (src/auth/soloCompany.ts) for the deletion cases.
// It never calls prepare_account_deletion: that function deletes data.

import { QA_PASSWORD, URL_BASE, assertLocal, localKeys } from './seed-local.mjs';

const P = (s) => `0b000000-0000-4000-8000-${s}`;
const RIVERSIDE = P('00000000a001');
/** PostgREST can't LIKE a uuid; the 0b namespace as a range instead. */
const NS = (col) => `${col}=gte.0b000000-0000-0000-0000-000000000000&${col}=lt.0c000000-0000-0000-0000-000000000000`;

/**
 * reports/photos/signatures/amendments: rows visible in those tables.
 * statuses: sorted report statuses. projects: visible project ids count.
 * photoRead: can this user download the Riverside draft photo?
 */
const EXPECT = {
  'qa-wl-admin': { projects: 2, reports: 6, statuses: 'draft,locked,locked,locked,submitted,submitted', photos: 5, signatures: 6, amendments: 1, photoRead: true },
  'qa-wl-super': { projects: 1, reports: 4, statuses: 'draft,locked,locked,submitted', photos: 4, signatures: 4, amendments: 1, photoRead: true },
  'qa-wl-pm': { projects: 2, reports: 6, statuses: 'draft,locked,locked,locked,submitted,submitted', photos: 5, signatures: 6, amendments: 1, photoRead: true },
  'qa-wl-sub': { projects: 1, reports: 0, statuses: '', photos: 0, signatures: 0, amendments: 0, photoRead: false },
  'qa-wl-owner': { projects: 1, reports: 0, statuses: '', photos: 0, signatures: 0, amendments: 0, photoRead: false },
  'qa-wl-architect': { projects: 1, reports: 0, statuses: '', photos: 0, signatures: 0, amendments: 0, photoRead: false },
  'qa-wl-b-admin': { projects: 1, reports: 1, statuses: 'submitted', photos: 1, signatures: 1, amendments: 0, photoRead: false },
  'qa-wl-member': { projects: 0, reports: 0, statuses: '', photos: 0, signatures: 0, amendments: 0, photoRead: false },
  'qa-wl-new': { projects: 0, reports: 0, statuses: '', photos: 0, signatures: 0, amendments: 0, photoRead: false },
  'qa-wl-solo': { projects: 1, reports: 2, statuses: 'draft,locked', photos: 1, signatures: 1, amendments: 0, photoRead: false },
  'qa-wl-soloco': { projects: 1, reports: 1, statuses: 'locked', photos: 1, signatures: 1, amendments: 0, photoRead: false },
};

/** Delete-account warning expectation: solo company / solo no-company project impact. */
const DELETION = {
  'qa-wl-admin': 'refuse', // only admin of A, other members exist → last_admin refusal
  'qa-wl-soloco': 'solo-company', // sole member of C → company + 1 sealed report deleted
  'qa-wl-solo': 'solo-no-company', // sole member of a company-less project → 1 sealed report deleted
};

async function signIn(anon, email) {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: QA_PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in ${email}: ${res.status} ${body.error_description ?? body.msg ?? ''}`);
  return { token: body.access_token, userId: body.user.id };
}

function client(anon, token) {
  const headers = { apikey: anon, Authorization: `Bearer ${token}` };
  return {
    async rows(path) {
      const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { headers });
      if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
      return res.json();
    },
    async canRead(object) {
      const res = await fetch(`${URL_BASE}/storage/v1/object/authenticated/${object}`, { headers });
      return res.ok;
    },
  };
}

async function deletionImpact(db, userId) {
  const cms = await db.rows(`company_members?select=company_id,role&user_id=eq.${userId}`);
  const admin = cms.find((c) => c.role === 'admin');
  if (admin) {
    const others = await db.rows(`company_members?select=user_id&company_id=eq.${admin.company_id}&user_id=neq.${userId}`);
    if (others.length > 0) return { kind: 'refuse' };
    const projects = await db.rows(`projects?select=id&company_id=eq.${admin.company_id}`);
    const ids = projects.map((p) => p.id).join(',');
    const people = await db.rows(`project_members?select=user_id&project_id=in.(${ids})&user_id=neq.${userId}`);
    if (people.length > 0) return { kind: 'refuse' };
    const sealed = await db.rows(`daily_reports?select=id&project_id=in.(${ids})&status=in.(submitted,locked)`);
    return { kind: 'solo-company', sealed: sealed.length };
  }
  const mine = await db.rows(`project_members?select=project_id,role,projects!inner(company_id)&user_id=eq.${userId}&projects.company_id=is.null`);
  const ids = mine.map((m) => m.project_id).join(',');
  if (!ids) return { kind: 'none' };
  const others = await db.rows(`project_members?select=user_id&project_id=in.(${ids})&user_id=neq.${userId}`);
  if (others.length > 0) return { kind: 'none' };
  const sealed = await db.rows(`daily_reports?select=id&project_id=in.(${ids})&status=in.(submitted,locked)`);
  return { kind: 'solo-no-company', sealed: sealed.length };
}

async function check(anon, name) {
  const want = EXPECT[name];
  const { token, userId } = await signIn(anon, `${name}@worklog.test`);
  const db = client(anon, token);
  const reports = await db.rows(`daily_reports?select=id,status&${NS('id')}`);
  const got = {
    projects: (await db.rows(`projects?select=id&${NS('id')}`)).length,
    reports: reports.length,
    statuses: reports.map((r) => r.status).sort().join(','),
    photos: (await db.rows(`report_photos?select=id&${NS('id')}`)).length,
    signatures: (await db.rows(`report_signatures?select=id&${NS('report_id')}`)).length,
    amendments: (await db.rows(`report_amendments?select=id&${NS('report_id')}`)).length,
    photoRead: await db.canRead(`worklog-photos/${RIVERSIDE}/${P('00000000d101')}/${P('00000000f101')}.jpg`),
  };
  const diffs = Object.keys(want).filter((k) => want[k] !== got[k]).map((k) => `${k}: want ${want[k]}, got ${got[k]}`);
  if (DELETION[name]) {
    const impact = await deletionImpact(db, userId);
    const ok = impact.kind === DELETION[name] && (impact.kind === 'refuse' || impact.sealed === 1);
    if (!ok) diffs.push(`deletion: want ${DELETION[name]} (1 sealed), got ${JSON.stringify(impact)}`);
    got.deletion = impact.kind + (impact.sealed === undefined ? '' : ` (${impact.sealed} sealed)`);
  }
  const summary = `projects=${got.projects} reports=${got.reports} [${got.statuses}] photos=${got.photos} sigs=${got.signatures} amends=${got.amendments} photoRead=${got.photoRead}${got.deletion ? ` deletion=${got.deletion}` : ''}`;
  console.log(`${diffs.length ? 'FAIL' : 'PASS'} ${name.padEnd(15)} ${summary}${diffs.length ? `\n     ${diffs.join('\n     ')}` : ''}`);
  return diffs.length === 0;
}

async function main() {
  assertLocal(URL_BASE);
  const { anon } = localKeys();
  let pass = 0;
  for (const name of Object.keys(EXPECT)) {
    try {
      if (await check(anon, name)) pass += 1;
    } catch (err) {
      console.log(`FAIL ${name.padEnd(15)} ${err.message}`);
    }
  }
  const total = Object.keys(EXPECT).length;
  console.log(`${pass}/${total} PASS`);
  process.exit(pass === total ? 0 : 1);
}

main();
