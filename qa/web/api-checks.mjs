#!/usr/bin/env node
// API-level rows of the WorkLog web pass (MULT-53): RLS, grants, lifecycle
// RPC authority, storage, edge-function auth. Runs as each seeded user via
// supabase-js; service role only to read back state. Local stack only.
//
//   node qa/web/api-checks.mjs      (after node qa/seed/seed-local.mjs)

import { execFileSync } from 'node:child_process';
import { as, check, email, IDS, KEYS, service, token, URL_BASE } from './lib.mjs';

const svc = service();
const reportRow = async (id) =>
  (await svc.from('daily_reports').select('*').eq('id', id).single()).data;
const fn = (name, jwt, body, headers = {}) =>
  fetch(`${URL_BASE}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      apikey: KEYS.anon,
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.text() }));
const psql = (sql) =>
  execFileSync(
    'docker',
    ['exec', '-i', 'supabase_db_PUNCH-LOG-NEW', 'psql', '-U', 'postgres', '-tAc', sql],
    { encoding: 'utf8' },
  ).trim();

// LIFE-009: report tables are SELECT-only to clients.
await check('LIFE-009', async () => {
  const c = await as('super');
  const before = await reportRow(IDS.R_TODAY);
  const tries = {
    insert_daily_reports: await c.from('daily_reports').insert({
      id: crypto.randomUUID(),
      project_id: IDS.RIVERSIDE,
      report_date: '2020-01-01',
      status: 'draft',
    }),
    update_daily_reports: await c
      .from('daily_reports')
      .update({ status: 'locked' })
      .eq('id', IDS.R_TODAY)
      .select(),
    delete_daily_reports: await c.from('daily_reports').delete().eq('id', IDS.R_TODAY).select(),
    insert_report_sections: await c
      .from('report_sections')
      .insert({ report_id: IDS.R_TODAY, section: 'general_notes', payload: {} }),
    update_report_sections: await c
      .from('report_sections')
      .update({ is_complete: true })
      .eq('report_id', IDS.R_TODAY)
      .select(),
    delete_report_signatures: await c
      .from('report_signatures')
      .delete()
      .eq('report_id', IDS.R_T1)
      .select(),
  };
  const after = await reportRow(IDS.R_TODAY);
  const sigs = (await svc.from('report_signatures').select('id').eq('report_id', IDS.R_T1)).data;
  const leaks = Object.entries(tries).filter(([, r]) => !r.error && (r.data?.length ?? 0) > 0);
  const ev = Object.entries(tries)
    .map(([k, r]) => `${k}: ${r.error ? r.error.code : `ok rows=${r.data?.length ?? 0}`}`)
    .join('; ');
  const unchanged = before.status === after.status && sigs.length > 0;
  return leaks.length === 0 && unchanged
    ? ['Pass', `${ev}; draft unchanged, T1 signatures intact (${sigs.length})`]
    : ['Fail', `writes succeeded: ${leaks.map((l) => l[0])}; ${ev}`];
});

// LIFE-010: update_section refused on a locked report.
await check('LIFE-010', async () => {
  const c = await as('super');
  const read = async () =>
    JSON.stringify(
      (await svc.from('report_sections').select('*').eq('report_id', IDS.R_T2).order('section'))
        .data,
    );
  const before = await read();
  const { error } = await c.rpc('update_section', {
    p_report_id: IDS.R_T2,
    p_section: 'general_notes',
    p_payload: { text: 'QA tamper' },
    p_is_complete: false,
  });
  const same = before === (await read());
  return error && same
    ? ['Pass', `refused ${error.code}: ${error.message}; sections unchanged`]
    : ['Fail', `error=${error?.message ?? 'none'} unchanged=${same}`];
});

// PERM-007: sub reads 0 report rows.
await check('PERM-007', async () => {
  const c = await as('sub');
  const tables = [
    'daily_reports',
    'report_sections',
    'report_weather',
    'report_signatures',
    'report_amendments',
    'report_photos',
  ];
  const counts = {};
  for (const t of tables) {
    const { data, error } = await c.from(t).select('*').limit(50);
    counts[t] = error ? `err ${error.code}` : data.length;
  }
  const ok = Object.values(counts).every((v) => v === 0 || String(v).startsWith('err'));
  return [ok ? 'Pass' : 'Fail', JSON.stringify(counts)];
});

// PERM-008: sub/owner lifecycle RPCs refused.
await check('PERM-008', async () => {
  const out = [];
  let leaked = false;
  for (const role of ['sub', 'owner']) {
    const c = await as(role);
    const calls = {
      create_report: () =>
        c.rpc('create_report', {
          p_project_id: IDS.RIVERSIDE,
          p_report_date: '2021-02-02',
          p_client_id: crypto.randomUUID(),
        }),
      update_section: () =>
        c.rpc('update_section', {
          p_report_id: IDS.R_TODAY,
          p_section: 'general_notes',
          p_payload: { text: `QA ${role} tamper` },
        }),
      submit_report: () =>
        c.rpc('submit_report', {
          p_report_id: IDS.R_TODAY,
          p_signer_title: 'x',
          p_signature_png: null,
        }),
      lock_report: () => c.rpc('lock_report', { p_report_id: IDS.R_T1 }),
      amend_report: () =>
        c.rpc('amend_report', {
          p_report_id: IDS.R_T2,
          p_amendment_client_id: crypto.randomUUID(),
          p_reason: 'qa',
          p_changes: { general_notes: { payload: { text: 'x' }, is_complete: false } },
        }),
    };
    for (const [k, call] of Object.entries(calls)) {
      const { error } = await call();
      if (!error) leaked = true;
      out.push(`${role}.${k}=${error ? error.code : 'ALLOWED'}`);
    }
  }
  const stray = (await svc.from('daily_reports').select('id').eq('report_date', '2021-02-02')).data;
  const today = await reportRow(IDS.R_TODAY);
  const t1 = await reportRow(IDS.R_T1);
  if (stray.length || today.status !== 'draft' || t1.status !== 'submitted') leaked = true;
  return [
    leaked ? 'Fail' : 'Pass',
    `${out.join(' ')}; stray=${stray.length} draft=${today.status} t1=${t1.status}`,
  ];
});

// PERM-009: sub cannot read owner/architect profiles; super can.
await check('PERM-009', async () => {
  const { data } = await svc.auth.admin.listUsers({ perPage: 1000 });
  const ids = ['owner', 'architect'].map((r) => data.users.find((u) => u.email === email(r)).id);
  const seen = async (role) =>
    ((await (await as(role)).from('profiles').select('id').in('id', ids)).data ?? []).length;
  const sub = await seen('sub');
  const sup = await seen('super');
  return [sub === 0 && sup === 2 ? 'Pass' : 'Fail', `sub sees ${sub}/2, super sees ${sup}/2`];
});

// PERM-012 (API half): company B admin sees nothing of company A, and back.
await check('PERM-012-API', async () => {
  const c = await as('b-admin');
  const r = (await c.from('daily_reports').select('id').eq('project_id', IDS.RIVERSIDE)).data;
  const p = (await c.from('projects').select('id').in('id', [IDS.RIVERSIDE, IDS.DEPOT])).data;
  const m = (await c.from('project_members').select('user_id').eq('project_id', IDS.RIVERSIDE))
    .data;
  const s = (await c.from('report_sections').select('report_id').eq('report_id', IDS.R_TODAY)).data;
  const a = (await (await as('super')).from('daily_reports').select('id').eq('id', IDS.PIER9_T1))
    .data;
  const n = [r, p, m, s, a].map((x) => x?.length ?? 0);
  return [
    n.every((x) => x === 0) ? 'Pass' : 'Fail',
    `b-admin sees A reports/projects/members/sections=${n.slice(0, 4)}; super sees Pier9=${n[4]}`,
  ];
});

// PERM-013 (API half): company member without projects sees no company-A rows.
await check('PERM-013-API', async () => {
  const c = await as('member');
  const r = (await c.from('daily_reports').select('id')).data?.length;
  const p = (await c.from('projects').select('id')).data?.length;
  return [r === 0 && p === 0 ? 'Pass' : 'Fail', `member sees reports=${r} projects=${p}`];
});

// PERM-015: item_people_names with WorkLog ids and >1000 ids.
await check('PERM-015', async () => {
  const out = [];
  let ok = true;
  for (const role of ['sub', 'super']) {
    const c = await as(role);
    const a = await c.rpc('item_people_names', { p_item_ids: [IDS.R_TODAY, IDS.R_T1] });
    const many = Array.from({ length: 1001 }, () => crypto.randomUUID());
    const b = await c.rpc('item_people_names', { p_item_ids: many });
    if (a.error || a.data.length !== 0 || b.error?.code !== '22023') ok = false;
    out.push(
      `${role}: reportIds rows=${a.error ? a.error.code : a.data.length}, 1001 ids=${b.error?.code ?? 'no error'}`,
    );
  }
  return [ok ? 'Pass' : 'Fail', out.join('; ')];
});

// PHOTO-012: storage RLS on seeded photos.
await check('PHOTO-012', async () => {
  const path = `${IDS.RIVERSIDE}/${IDS.R_TODAY}/${IDS.PHOTO_R}.jpg`;
  const res = {};
  for (const role of ['super', 'sub', 'b-admin']) {
    const { data, error } = await (await as(role)).storage.from('worklog-photos').download(path);
    res[role] = error ? 'denied' : `ok ${data.size}b`;
  }
  const list = await (
    await as('sub')
  ).storage
    .from('worklog-photos')
    .list(`${IDS.RIVERSIDE}/${IDS.R_TODAY}`);
  const listed = list.data?.length ?? 0;
  const ok =
    res.super.startsWith('ok') && res.sub === 'denied' && res['b-admin'] === 'denied' && !listed;
  return [ok ? 'Pass' : 'Fail', `${JSON.stringify(res)}; sub list=${listed}`];
});

// WEATH-005: worklog-weather on a locked report is frozen.
await check('WEATH-005', async () => {
  const read = async () =>
    JSON.stringify((await svc.from('report_weather').select('*').eq('report_id', IDS.R_T2)).data);
  const before = await read();
  const r = await fn('worklog-weather', await token('super'), {
    project_id: IDS.RIVERSIDE,
    report_date: (await reportRow(IDS.R_T2)).report_date,
  });
  const same = before === (await read());
  return [
    r.status === 200 && r.body.includes('report_locked') && same ? 'Pass' : 'Fail',
    `HTTP ${r.status} ${r.body.slice(0, 120)}; row unchanged=${same}`,
  ];
});

// WEATH-008: worklog-geocode auth (contract: project member or company admin).
await check('WEATH-008', async () => {
  const body = { project_id: IDS.RIVERSIDE };
  const anon = await fn('worklog-geocode', KEYS.anon, body);
  const b = await fn('worklog-geocode', await token('b-admin'), body);
  const sub = await fn('worklog-geocode', await token('sub'), body);
  const sup = await fn('worklog-geocode', await token('super'), body);
  const refused = (s) => s === 401 || s === 403;
  return [
    refused(anon.status) && refused(b.status) && sup.status === 200 ? 'Pass' : 'Fail',
    `anon=${anon.status} b-admin=${b.status} sub=${sub.status} ${sub.body.slice(0, 60)} super=${sup.status} ${sup.body.slice(0, 60)}`,
  ];
});

// PDF-008: worklog-send-email fails closed without x-email-secret.
await check('PDF-008', async () => {
  const body = { to: ['qa-wl-super@worklog.test'], subject: 'qa', report_id: IDS.R_T1 };
  const anon = await fn('worklog-send-email', KEYS.anon, body);
  const user = await fn('worklog-send-email', await token('super'), body);
  const wrong = await fn('worklog-send-email', await token('super'), body, {
    'x-email-secret': 'x'.repeat(64),
  });
  const ok = [anon, user, wrong].every((r) => r.status === 401 || r.status === 403);
  return [
    ok ? 'Pass' : 'Fail',
    `anon=${anon.status}, user JWT no secret=${user.status} ${user.body.slice(0, 80)}, wrong secret=${wrong.status}`,
  ];
});

// LIFE-008: auto-lock after 24 h (Pier 9 today-1), read back as b-admin.
await check('LIFE-008', async () => {
  const out = psql(
    `update daily_reports set submitted_at = now() - interval '25 hours' where id='${IDS.PIER9_T1}'; select lock_stale_submitted_reports();`,
  );
  const r = (
    await (await as('b-admin')).from('daily_reports').select('status').eq('id', IDS.PIER9_T1)
  ).data?.[0];
  return [
    r?.status === 'locked' ? 'Pass' : 'Fail',
    `lock_stale_submitted_reports() -> ${out.split('\n').pop()}; b-admin sees status=${r?.status}`,
  ];
});
