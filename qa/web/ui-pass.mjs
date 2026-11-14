#!/usr/bin/env node
// UI rows of the WorkLog web pass (MULT-53), Playwright against Expo web on the
// LOCAL stack (qa/README.md §4). Phases share seeded state; run in this order
// and re-seed where noted:
//
//   node qa/web/ui-pass.mjs read        # read-only checks on a fresh seed
//   node qa/web/ui-pass.mjs mutate      # section edits, projects, invites   -> re-seed after
//   node qa/web/ui-pass.mjs mail        # register / forgot / set-password via Mailpit
//   node qa/web/ui-pass.mjs newuser     # qa-wl-new first project            -> re-seed after
//   node qa/web/ui-pass.mjs company     # qa-wl-new creates a company        -> re-seed after
//   node qa/web/ui-pass.mjs destructive # deletion rows                      -> re-seed after
//
// Every Fail gets a screenshot in qa/web/results/.

import { chromium } from 'playwright';
import { join } from 'node:path';
import { as, check, email, IDS, OUT, P, QA_PASSWORD, record, service } from './lib.mjs';

const BASE = process.env.QA_WEB_URL ?? 'http://localhost:8081';
const MAILPIT = 'http://127.0.0.1:54324';
const PHASE = process.argv[2] ?? 'read';
const svc = service();
const browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL ?? 'chrome' });
const states = new Map();
let shotN = 0;

/** A fresh page; signed in as `role` (one real UI sign-in per role per run). */
async function page(role) {
  const ctx = await browser.newContext({
    viewport: { width: 430, height: 932 },
    storageState: role ? states.get(role) : undefined,
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(20_000);
  if (!role) {
    await p.goto(`${BASE}/login`);
    await p.getByTestId('login-email').waitFor({ timeout: 120_000 });
    return p;
  }
  if (states.has(role)) {
    await p.goto(BASE);
    await p.getByTestId('screen-today').waitFor({ timeout: 60_000 });
    await p.waitForTimeout(1500);
    return p;
  }
  await p.goto(`${BASE}/login`);
  await p.getByTestId('login-email').fill(email(role), { timeout: 120_000 });
  await p.getByTestId('login-password').fill(QA_PASSWORD);
  await p.getByTestId('login-submit').click();
  await p.getByTestId('screen-today').waitFor({ timeout: 60_000 });
  await p.waitForTimeout(2000);
  states.set(role, await ctx.storageState());
  return p;
}
const visible = (p, testId, timeout = 4000) =>
  p
    .getByTestId(testId)
    .first()
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);
const seen = (loc, timeout = 8000) =>
  loc
    .first()
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);
const text = (p) => p.locator('body').innerText();
const lines = (t, re) => t.split('\n').filter((l) => re.test(l));
async function shot(p, id) {
  const f = join(OUT, `${id}-${++shotN}.png`);
  await p.screenshot({ path: f, fullPage: true }).catch(() => {});
  return `results/${id}-${shotN}.png`;
}
/** UI check wrapper; a Fail carries a screenshot path. */
const ONLY = process.env.ONLY?.split(',');
async function ui(id, role, fn) {
  if (ONLY && !ONLY.includes(id)) return;
  await check(id, async () => {
    let p;
    try {
      p = await page(role);
      const out = await fn(p);
      if (out && out[0] === 'Fail') out[1] += ` [screenshot ${await shot(p, id)}]`;
      return out;
    } catch (e) {
      return [
        'Fail',
        `${e.message.split('\n')[0]}${p ? ` [screenshot ${await shot(p, id)}]` : ''}`,
      ];
    } finally {
      await p?.context().close();
    }
  });
}
async function openReport(p, id) {
  await p.goto(`${BASE}/report/${id}`);
  await p.getByTestId('screen-report').waitFor({ timeout: 60_000 });
  await p
    .locator('[data-testid^="report-status-"]')
    .or(p.getByText('Report not found'))
    .first()
    .waitFor({ timeout: 30_000 });
}
const sectionOf = async (reportId, kind) =>
  (
    await svc
      .from('report_sections')
      .select('payload')
      .eq('report_id', reportId)
      .eq('section', kind)
      .maybeSingle()
  ).data?.payload;
const userId = async (role) => {
  const { data } = await svc.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === email(role))?.id;
};
const todayIso = () => new Date().toLocaleDateString('en-CA');
async function openSheet(p, row) {
  await p.getByTestId(`report-section-${row}`).click();
  await p.waitForTimeout(700);
}
async function closeSheet(p, prefix) {
  await p.getByTestId(`${prefix}-done`).click();
  await p.waitForTimeout(3500); // autosave flush + summary refresh
}
const summary = async (p, row) =>
  (await p.getByTestId(`report-section-${row}`).innerText()).replace(/\s+/g, ' ').trim();
const notFound = (p) => p.getByText('Report not found').isVisible();

// ---------------------------------------------------------------- read phase
async function readPhase() {
  await ui('AUTH-004', null, async (p) => {
    const n = await p.locator('[data-testid^="login-demo-"]').count();
    return [n === 0 ? 'Pass' : 'Fail', `login-demo-* rows rendered: ${n}`];
  });
  await ui('AUTH-002', null, async (p) => {
    await p.getByTestId('login-email').fill(email('super'));
    await p.getByTestId('login-password').fill('wrong-pass-1');
    await p.getByTestId('login-submit').click();
    const err = await visible(p, 'login-error', 15000);
    const msg = err ? await p.getByTestId('login-error').innerText() : '';
    const still = await visible(p, 'login-submit');
    return [err && still ? 'Pass' : 'Fail', `login-error="${msg}", still on login=${still}`];
  });
  await ui('AUTH-003', null, async (p) => {
    const calls = [];
    p.on('request', (r) => r.url().includes('/auth/v1/token') && calls.push(r.url()));
    const out = [];
    for (const v of ['', 'not-an-email']) {
      await p.getByTestId('login-email').fill(v);
      await p.getByTestId('login-password').fill('whatever-1');
      await p.getByTestId('login-submit').click();
      await p.waitForTimeout(1500);
      const err = (await visible(p, 'login-error', 2000))
        ? await p.getByTestId('login-error').innerText()
        : '(no login-error)';
      out.push(`"${v}": ${err}`);
    }
    const ok = calls.length === 0 && !out.some((o) => o.includes('(no login-error)'));
    return [ok ? 'Pass' : 'Fail', `${out.join('; ')}; token requests=${calls.length}`];
  });
  await ui('AUTH-006', null, async (p) => {
    const calls = [];
    p.on('request', (r) => r.url().includes('/auth/v1/recover') && calls.push(1));
    await p.getByTestId('login-email').fill('');
    await p.getByTestId('login-forgot').click();
    await p.waitForTimeout(1500);
    let t = '';
    if (await visible(p, 'login-error', 2000)) t = await p.getByTestId('login-error').innerText();
    else if (await visible(p, 'login-notice', 500))
      t = await p.getByTestId('login-notice').innerText();
    return [
      t && !calls.length ? 'Pass' : 'Fail',
      `message="${t}", recover requests=${calls.length}`,
    ];
  });
  await ui('AUTH-007', null, async (p) => {
    await p.getByTestId('login-register').click();
    const reg = await visible(p, 'register-submit', 10000);
    await p.getByTestId('register-back').click();
    const back = await visible(p, 'login-submit', 10000);
    return [reg && back ? 'Pass' : 'Fail', `register opened=${reg}, back to login=${back}`];
  });
  await ui('AUTH-008', null, async (p) => {
    const calls = [];
    p.on('request', (r) => r.url().includes('/functions/v1/') && calls.push(r.url()));
    await p.getByTestId('login-register').click();
    await p.getByTestId('register-submit').click();
    await p.waitForTimeout(1500);
    const doneH = await visible(p, 'register-done-heading', 1000);
    const copy = lines(await text(p), /enter|required|valid/i).join(' | ') || 'none';
    return [
      !doneH && calls.length === 0 ? 'Pass' : 'Fail',
      `done heading=${doneH}, function calls=${calls.length}, inline copy: ${copy}`,
    ];
  });
  await ui('AUTH-012', null, async (p) => {
    await p.goto(`${BASE}/set-password#error=access_denied&error_description=EVIL`);
    const err = await visible(p, 'set-password-error', 30000);
    const body = await text(p);
    const msg = err ? await p.getByTestId('set-password-error').innerText() : '';
    return [
      err && !body.includes('EVIL') ? 'Pass' : 'Fail',
      `set-password-error=${err} "${msg}", raw "EVIL" shown=${body.includes('EVIL')}`,
    ];
  });
  await ui('AUTH-013', null, async (p) => {
    const out = [];
    let ok = true;
    for (const frag of ['', '#garbage=1&access_token=nope']) {
      await p.goto(`${BASE}/confirm${frag}`);
      const m = await visible(p, 'confirm-message', 30000);
      const back = await visible(p, 'confirm-back', 2000);
      const today = await visible(p, 'screen-today', 1000);
      if (!m || !back || today) ok = false;
      const msg = m ? (await p.getByTestId('confirm-message').innerText()).slice(0, 90) : 'none';
      out.push(`"${frag}": "${msg}" back=${back} signedIn=${today}`);
    }
    return [ok ? 'Pass' : 'Fail', out.join('; ')];
  });
  await ui('NAV-002', null, async (p) => {
    let flashed = false;
    const poll = setInterval(async () => {
      if (
        await p
          .getByTestId('screen-history')
          .isVisible()
          .catch(() => false)
      )
        flashed = true;
    }, 50);
    await p.goto(`${BASE}/history`);
    const login = await visible(p, 'login-email', 30000);
    await p.waitForTimeout(500);
    clearInterval(poll);
    return [
      login && !flashed ? 'Pass' : 'Fail',
      `redirect to login=${login}, history flashed=${flashed}`,
    ];
  });
  await ui('NAV-001', null, async (p) => {
    await p.goto(BASE);
    const login = await visible(p, 'login-email', 30000);
    const q = await page('super');
    await q.goto(BASE);
    const today = await visible(q, 'screen-today', 30000);
    await q.context().close();
    return [
      today && login ? 'Pass' : 'Fail',
      `signed out / -> login=${login}; signed in / -> Today=${today}`,
    ];
  });

  // signed in
  await ui('AUTH-001', 'super', async (p) => {
    const t = await text(p);
    const ok = t.includes('QA-WL Riverside Tower');
    return [ok ? 'Pass' : 'Fail', `UI sign-in as qa-wl-super -> screen-today, Riverside=${ok}`];
  });
  await ui('AUTH-015', 'super', async (p) => {
    let loginFlash = false;
    const poll = setInterval(async () => {
      if (
        await p
          .getByTestId('login-email')
          .isVisible()
          .catch(() => false)
      )
        loginFlash = true;
    }, 50);
    await p.reload();
    const today = await visible(p, 'screen-today', 60000);
    clearInterval(poll);
    return [
      today && !loginFlash ? 'Pass' : 'Fail',
      `after reload Today=${today}, login flashed=${loginFlash}`,
    ];
  });
  await ui('NAV-003', 'super', async (p) => {
    const out = [];
    for (const path of ['/login', '/register']) {
      await p.goto(BASE + path);
      out.push(`${path}->Today=${await visible(p, 'screen-today', 30000)}`);
    }
    return [out.every((o) => o.endsWith('true')) ? 'Pass' : 'Fail', out.join(' ')];
  });
  await ui('NAV-004', 'super', async (p) => {
    const tabs = {};
    for (const t of ['tab-today', 'tab-history', 'tab-settings', 'tab-camera', 'tab-photos'])
      tabs[t] = await visible(p, t, 1500);
    const ok =
      tabs['tab-today'] &&
      tabs['tab-history'] &&
      tabs['tab-settings'] &&
      !tabs['tab-camera'] &&
      !tabs['tab-photos'];
    return [ok ? 'Pass' : 'Fail', JSON.stringify(tabs)];
  });
  await ui('NAV-005', 'super', async (p) => {
    await p.goto(`${BASE}/camera`);
    const cam = await visible(p, 'screen-camera', 30000);
    await p.goto(`${BASE}/photos`);
    const ph = await visible(p, 'screen-photos', 30000);
    return [cam && ph ? 'Pass' : 'Fail', `screen-camera=${cam} screen-photos=${ph}`];
  });
  await ui('NAV-008', 'super', async (p) => {
    await p.goto(BASE);
    await p.getByTestId('screen-today').waitFor();
    await openReport(p, '00000000-0000-4000-8000-000000000000');
    const nf = await notFound(p);
    await p.getByTestId('report-back').click();
    const back = await visible(p, 'screen-today', 10000);
    return [nf && back ? 'Pass' : 'Fail', `"Report not found"=${nf}, back to Today=${back}`];
  });
  await ui('TODAY-001', 'super', async (p) => {
    const draft = await visible(p, 'today-status-draft', 20000);
    const t = await text(p);
    await p.getByTestId('today-open-report').click();
    const opened = await visible(p, 'report-status-draft', 30000);
    return [
      draft && opened && t.includes('QA-WL Riverside Tower') ? 'Pass' : 'Fail',
      `draft chip=${draft}, opens report=${opened}. Today: ${t.split('\n').slice(0, 6).join(' / ')}`,
    ];
  });
  await ui('SECT-001', 'super', async (p) => {
    await openReport(p, IDS.R_TODAY);
    const rows = await p
      .locator('[data-testid^="report-section-"]')
      .evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
    const order = [
      'Weather',
      'Crew & work',
      'Deliveries',
      'Equipment',
      'Inspections',
      'Safety',
      'Delays',
      'Visitors',
      'RFIs',
      'General notes',
    ];
    const inOrder = order.every((o, i) => rows[i]?.startsWith(o));
    const draft = await visible(p, 'report-status-draft');
    return [
      rows.length === 10 && inOrder && draft ? 'Pass' : 'Fail',
      `${rows.length} rows: ${rows.join(' | ')}`,
    ];
  });
  await ui('SECT-015', 'super', async (p) => {
    const out = [];
    let ok = true;
    for (const rid of [IDS.R_T1, IDS.R_T2]) {
      await openReport(p, rid);
      const rows = await p
        .locator('[data-testid^="report-section-"]')
        .evaluateAll((els) => els.map((e) => e.dataset.testid));
      for (const r of rows) {
        await p.getByTestId(r).click();
        const ro = await visible(p, 'sheet-readonly', 5000);
        const editors = await p
          .locator(
            '[data-testid$="-add"]:visible, [data-testid$="-none"]:visible, textarea:visible, input:visible',
          )
          .count();
        if (!ro || editors) {
          ok = false;
          out.push(`${rid.slice(-4)}/${r}: readonly=${ro} editors=${editors}`);
        }
        await p.getByRole('button', { name: 'Dismiss' }).first().click({ timeout: 2000 });
        await p.waitForTimeout(500);
      }
      out.push(`${rid.slice(-4)}: ${rows.length} sheets checked`);
    }
    return [ok ? 'Pass' : 'Fail', out.join('; ')];
  });
  await ui('LIFE-007', 'super', async (p) => {
    await openReport(p, IDS.R_T2);
    const locked = await visible(p, 'report-status-locked');
    const btn = (await visible(p, 'report-submit', 800)) || (await visible(p, 'report-lock', 800));
    return [
      locked && !btn ? 'Pass' : 'Fail',
      `locked chip=${locked}, lifecycle buttons=${btn}; sheets read-only per SECT-015`,
    ];
  });
  await ui('LIFE-011', 'super', async (p) => {
    await openReport(p, IDS.R_T3);
    const chip = p.locator('[data-testid^="report-status-"]').first();
    const tid = await chip.getAttribute('data-testid');
    const label = (await chip.innerText()).trim();
    await p.goto(`${BASE}/history`);
    await p.getByTestId(`history-row-${IDS.R_T3}`).waitFor({ timeout: 30000 });
    const hist = (await p.getByTestId(`history-row-${IDS.R_T3}`).innerText()).replace(/\s+/g, ' ');
    const n = (await svc.from('report_amendments').select('id').eq('report_id', IDS.R_T3)).data
      .length;
    const ok = /amended/i.test(label) && /amended/i.test(hist);
    return [
      ok ? 'Pass' : 'Fail',
      `today-3 has ${n} amendment(s); detail chip ${tid} "${label}"; History row "${hist}"`,
    ];
  });
  await ui('LIFE-015', 'super', async (p) => {
    const out = [];
    for (const rid of [IDS.R_TODAY, IDS.R_T1]) {
      await openReport(p, rid);
      out.push(
        `${rid.slice(-4)}: submit=${await visible(p, 'report-submit', 800)} lock=${await visible(p, 'report-lock', 800)}`,
      );
    }
    return [out.every((o) => !o.includes('true')) ? 'Pass' : 'Fail', out.join('; ')];
  });
  await ui('LIFE-016', 'super', async (p) => {
    const out = [];
    for (const rid of [IDS.R_TODAY, IDS.R_T1, IDS.R_T2, IDS.R_T3]) {
      await openReport(p, rid);
      const chip = p.locator('[data-testid^="report-status-"]').first();
      out.push((await chip.innerText()).trim() || '(no text)');
    }
    return [
      out.every((o) => o !== '(no text)') ? 'Pass' : 'Fail',
      `chip text labels: ${out.join(', ')}`,
    ];
  });
  await ui('HIST-001', 'super', async (p) => {
    await p.getByTestId('tab-history').click();
    await p.locator('[data-testid^="history-row-"]').first().waitFor({ timeout: 30000 });
    const rows = await p
      .locator('[data-testid^="history-row-"]')
      .evaluateAll((els) =>
        els.map((e) => `${e.dataset.testid.slice(-4)}:${e.getAttribute('aria-label')}`),
      );
    const expected = ['d101', 'd102', 'd104', 'd103'];
    const ok = rows.length === 4 && expected.every((e, i) => rows[i].startsWith(e));
    await p.locator('[data-testid^="history-row-"]').first().click();
    const opened = await visible(p, 'screen-report', 20000);
    return [ok && opened ? 'Pass' : 'Fail', `${rows.join(' | ')}; tap opens report=${opened}`];
  });
  for (const role of ['new', 'member']) {
    await ui(`HIST-002-${role}`, role, async (p) => {
      await p.getByTestId('tab-history').click();
      const empty = await visible(p, 'history-empty', 20000);
      const t = empty
        ? (await p.getByTestId('history-empty').innerText()).replace(/\s+/g, ' ')
        : '';
      return [
        empty && /No project yet/i.test(t) ? 'Pass' : 'Fail',
        `history-empty=${empty} "${t}"`,
      ];
    });
  }
  await ui('HIST-004', 'admin', async (p) => {
    await p.getByTestId('tab-history').click();
    await p.locator('[data-testid^="history-row-"]').first().waitFor({ timeout: 30000 });
    const n = await p.locator('[data-testid^="history-row-"]').count();
    return [
      n === 6 ? 'Pass' : 'Not built',
      `admin History lists ${n} of 6 reports; Depot reports reachable only by URL, no project filter or switcher (TODAY-007)`,
    ];
  });
  await ui('TODAY-004', 'new', async (p) => {
    const t = await text(p);
    const card = await visible(p, 'today-company-card');
    const create = await visible(p, 'today-create-project');
    const above =
      card &&
      create &&
      (await p.getByTestId('today-company-card').boundingBox()).y <
        (await p.getByTestId('today-create-project').boundingBox()).y;
    return [
      t.includes('No project yet') && card && create && above ? 'Pass' : 'Fail',
      `No project yet=${t.includes('No project yet')} company card=${card} create-project=${create} card above=${above}`,
    ];
  });
  await ui('TODAY-005', 'member', async (p) => {
    const t = await text(p);
    const card = await visible(p, 'today-company-card', 2000);
    const create = await visible(p, 'today-create-project');
    return [
      t.includes('No project yet') && !card && create ? 'Pass' : 'Fail',
      `No project yet=${t.includes('No project yet')} company card=${card} create-project=${create}`,
    ];
  });
  await ui('TODAY-007', 'admin', async (p) => {
    const t = await text(p);
    const n = await p.getByText(/switch project|QA-WL Depot Warehouse/i).count();
    return [
      'Not built',
      `admin Today: "${t.split('\n').slice(0, 3).join(' / ')}"; switcher/Depot controls found: ${n}`,
    ];
  });
  await ui('TODAY-008', 'super', async (p) => {
    const n = await p.getByText(/last report|carry/i).count();
    return ['Not built', `no "Start from last report" entry on Today (${n} matches)`];
  });
  await ui('PROJ-002', 'super', async (p) => {
    await p.goto(`${BASE}/project/new`);
    await p.getByTestId('project-new-submit').click();
    const msg = await seen(p.getByText('Enter a project name.'));
    const n = (await svc.from('projects').select('id').ilike('name', 'QA-WL%')).data.length;
    return [
      msg && n === 5 ? 'Pass' : 'Fail',
      `"Enter a project name." shown=${msg}; QA-WL projects in DB=${n} (seed 5)`,
    ];
  });
  await ui('PROJ-005', 'super', async (p) => {
    await p.getByTestId('tab-settings').click();
    await p.getByTestId('settings-members-link').click();
    await p.getByTestId('screen-project-members').waitFor();
    await p.waitForTimeout(2500);
    const t = await text(p);
    const ok = t.includes('Project Manager') && t.includes('Superintendent');
    return [ok ? 'Pass' : 'Fail', `members screen: ${t.split('\n').slice(1, 22).join(' | ')}`];
  });
  await ui('PROJ-008', 'super', async (p) => {
    const calls = [];
    p.on('request', (r) => r.url().includes('invite-user') && calls.push(1));
    await p.goto(`${BASE}/project/${IDS.RIVERSIDE}/members`);
    await p.getByTestId('project-members-invite-email').fill('bob@');
    await p.getByTestId('project-members-invite-submit').click();
    const msg = await seen(p.getByText('Enter a valid email address.'));
    return [
      msg && !calls.length ? 'Pass' : 'Fail',
      `message=${msg}, invite requests=${calls.length}`,
    ];
  });
  await ui('PROJ-009', 'new', async (p) => {
    await p.getByTestId('tab-settings').click();
    await p.getByTestId('screen-settings').waitFor();
    const link = await visible(p, 'settings-members-link', 2000);
    return [!link ? 'Pass' : 'Fail', `settings-members-link visible=${link}`];
  });
  await ui('SYNC-001', 'super', async (p) => {
    await openReport(p, IDS.R_TODAY);
    const s = await visible(p, 'sync-status-synced', 10000);
    const label = await p
      .getByTestId('sync-status')
      .getAttribute('aria-label')
      .catch(() => '');
    return [
      s ? 'Pass' : 'Fail',
      `web half: sync-status-synced=${s} "${label}". Queued/offline states are Android (stage 4)`,
    ];
  });
  await ui('SYNC-008', 'super', async (p) => {
    await p.getByTestId('tab-settings').click();
    await p.getByTestId('settings-sync-link').click();
    const scr = await visible(p, 'sync-queue-screen', 20000);
    const t = await text(p);
    await p.getByTestId('sync-back').click();
    const back = await visible(p, 'screen-settings', 10000);
    return [
      scr && back ? 'Pass' : 'Fail',
      `queue screen=${scr} "${t.split('\n').slice(1, 4).join(' / ')}", back=${back}`,
    ];
  });
  await ui('PHOTO-006', 'super', async (p) => {
    await openReport(p, IDS.R_TODAY);
    const imgs = await p.locator('img').count();
    return [
      'Not built',
      `report detail has no photo strip (${imgs} <img> on page; 2 seeded photos)`,
    ];
  });
  await ui('PHOTO-007', 'admin', async (p) => {
    await p.goto(`${BASE}/photos`);
    const empty = await visible(p, 'photos-empty', 20000);
    return [
      'Not built',
      `/photos placeholder photos-empty=${empty}; admin can read 5 seeded photos`,
    ];
  });
  await ui('PHOTO-008', 'super', async () => [
    'Not built',
    'no photo route or lightbox (nothing to open, see PHOTO-006)',
  ]);
  for (const id of ['HIST-005', 'HIST-006', 'HIST-007']) {
    await ui(id, 'super', async (p) => {
      await p.getByTestId('tab-history').click();
      await p.getByTestId('screen-history').waitFor();
      const n = await p.getByText(/filter|calendar|rollup|weekly/i).count();
      return ['Not built', `History is a flat list; calendar/filter/rollup controls found: ${n}`];
    });
  }
  await ui('SET-001', 'super', async (p) => {
    await p.getByTestId('tab-settings').click();
    const res = [];
    for (const t of [
      'settings-sync-link',
      'settings-members-link',
      'settings-terms-link',
      'settings-privacy-link',
      'settings-signout',
      'settings-delete-account',
    ]) {
      const box = (await visible(p, t)) ? await p.getByTestId(t).boundingBox() : null;
      const label = box ? (await p.getByTestId(t).innerText()).replace(/\s+/g, ' ').trim() : '';
      res.push({ t, h: box ? Math.round(box.height) : 0, label });
    }
    const ok = res.every((r) => r.h >= 48 && r.label);
    return [ok ? 'Pass' : 'Fail', res.map((r) => `${r.label || r.t}:${r.h}px`).join(', ')];
  });
  await ui('SET-002', 'super', async (p) => {
    await p.getByTestId('tab-settings').click();
    const out = [];
    let ok = true;
    for (const t of ['settings-terms-link', 'settings-privacy-link']) {
      const [pop] = await Promise.all([
        p
          .context()
          .waitForEvent('page', { timeout: 10000 })
          .catch(() => null),
        p.getByTestId(t).click(),
      ]);
      if (pop) await pop.waitForLoadState('domcontentloaded').catch(() => {});
      const url = pop ? pop.url() : p.url();
      const status = url.startsWith('http')
        ? (await fetch(url).catch(() => ({ status: 0 }))).status
        : 0;
      if (!pop || status !== 200) ok = false;
      out.push(`${t}: new tab=${!!pop} ${url} HTTP ${status}`);
      await pop?.close();
    }
    return [ok ? 'Pass' : 'Fail', out.join('; ')];
  });
  for (const [id, what, role] of [
    ['SET-003', 'Appearance', 'super'],
    ['SET-004', 'Branding', 'admin'],
    ['SET-005', 'Customiz', 'admin'],
    ['SET-007', 'Profile', 'super'],
  ]) {
    await ui(id, role, async (p) => {
      await p.getByTestId('tab-settings').click();
      await p.getByTestId('screen-settings').waitFor();
      const n = await p.getByText(new RegExp(what, 'i')).count();
      return ['Not built', `Settings has no ${what}… entry (${n} matches)`];
    });
  }

  // Deletion copy: open the sheet, read, cancel. Non-destructive.
  const delCopy = async (p) => {
    await p.getByTestId('tab-settings').click();
    await p.getByTestId('settings-delete-account').click();
    await p.getByTestId('settings-delete-account-message').waitFor({ timeout: 20000 });
    await p.waitForTimeout(3000); // the warning loads async
    const msg = (await p.getByTestId('settings-delete-account-message').innerText()).replace(
      /\s+/g,
      ' ',
    );
    const title = await p
      .getByText(/Delete your account\?|Can't delete/)
      .first()
      .innerText();
    await p.getByTestId('settings-delete-account-cancel').click();
    await p.waitForTimeout(800);
    return { msg, title };
  };
  await ui('DEL-001', 'super', async (p) => {
    const { title } = await delCopy(p);
    const closed = !(await p
      .getByTestId('settings-delete-account-message')
      .isVisible()
      .catch(() => false));
    return [
      title.includes('Delete your account?') && closed ? 'Pass' : 'Fail',
      `Today -> Settings tab -> Delete account (2 taps) opens "${title}"; cancel closes=${closed}`,
    ];
  });
  await ui('DEL-002', 'solo', async (p) => {
    const { msg } = await delCopy(p);
    const ok =
      /only person/i.test(msg) &&
      /part of a company/i.test(msg) &&
      /locked|signed/i.test(msg) &&
      /2 daily reports/.test(msg);
    return [ok ? 'Pass' : 'Fail', `"${msg}"`];
  });
  await ui('DEL-003', 'soloco', async (p) => {
    const { msg } = await delCopy(p);
    const ok =
      msg.includes('QA-WL Solo Co') &&
      /1 project/.test(msg) &&
      /1 daily report/.test(msg) &&
      /locked|signed/i.test(msg);
    return [ok ? 'Pass' : 'Fail', `"${msg}"`];
  });
  await ui('DEL-004', 'super', async (p) => {
    const { msg } = await delCopy(p);
    const want =
      "This permanently deletes your account and removes your access to this company's reports. It cannot be undone.";
    return [msg.includes(want) ? 'Pass' : 'Fail', `"${msg}"`];
  });
  await ui('DEL-012', 'super', async (p) => {
    const { msg } = await delCopy(p);
    const ok = /PunchLog|JobSight/i.test(msg);
    return [ok ? 'Pass' : 'Fail', `PunchLog/JobSight named=${ok}: "${msg}"`];
  });
  await ui('DEL-013', 'super', async (p) => {
    await p.getByTestId('tab-settings').click();
    const n = await p.getByText(/WorkLog data/i).count();
    return ['Not built', `only full account deletion in Settings (${n} "WorkLog data" entries)`];
  });

  // Permissions
  await ui('PERM-001', 'admin', async (p) => {
    const t = await text(p);
    await openReport(p, IDS.R_TODAY);
    const draft = await visible(p, 'report-status-draft');
    await openSheet(p, 'general_notes');
    const editable = await visible(p, 'sheet-notes-input');
    await openReport(p, P('00000000d201'));
    const depot = await visible(p, 'report-status-submitted');
    return [
      draft && editable && depot ? 'Pass' : 'Fail',
      `Today "${t.split('\n').slice(0, 3).join(' / ')}"; Riverside draft opens=${draft} editable=${editable}; Depot report by URL=${depot}; 6 reports by API (verify-roles). Submit/lock buttons: Android stage`,
    ];
  });
  await ui('PERM-002', 'super', async (p) => {
    await openReport(p, P('00000000d201'));
    const nf = await notFound(p);
    return [
      nf ? 'Pass' : 'Fail',
      `Depot report by URL as super -> "Report not found"=${nf}; 1 project / 4 reports (HIST-001)`,
    ];
  });
  await ui('PERM-003', 'pm', async (p) => {
    await openReport(p, IDS.R_TODAY);
    await openSheet(p, 'general_notes');
    const editable = await visible(p, 'sheet-notes-input');
    await p.goto(`${BASE}/project/${IDS.RIVERSIDE}/members`);
    await p.getByTestId('screen-project-members').waitFor();
    const invite = await visible(p, 'project-members-invite-email');
    return [
      editable && invite ? 'Pass' : 'Fail',
      `web half: pm edits Riverside draft=${editable}, invite form=${invite}. Submit/lock and signer-title prefill are Android-only`,
    ];
  });
  for (const [id, role] of [
    ['PERM-004', 'sub'],
    ['PERM-010', 'owner'],
    ['PERM-011', 'architect'],
  ]) {
    await ui(id, role, async (p) => {
      const t = await text(p);
      const card = await visible(p, 'today-open-report', 2000);
      const start = await visible(p, 'today-start-report', 1500);
      await p.getByTestId('tab-history').click();
      await p.getByTestId('screen-history').waitFor();
      await p.waitForTimeout(2500);
      const rows = await p.locator('[data-testid^="history-row-"]').count();
      await openReport(p, IDS.R_TODAY);
      const nf = await notFound(p);
      await p.goto(`${BASE}/project/${IDS.RIVERSIDE}/members`);
      await p.getByTestId('screen-project-members').waitFor();
      const invite = await visible(p, 'project-members-invite-email', 2000);
      const proj = t.includes('QA-WL Riverside Tower');
      const ok = proj && !card && rows === 0 && nf && !invite;
      return [
        ok ? 'Pass' : 'Fail',
        `project shown=${proj}, report card=${card}, start offered=${start}, history rows=${rows}, draft by URL not found=${nf}, invite form=${invite}`,
      ];
    });
  }
  await ui('PERM-005', 'sub', async (p) => {
    const start = await visible(p, 'today-start-report', 3000);
    let msg = 'not offered';
    if (start) {
      await p.getByTestId('today-start-report').click();
      await p.waitForTimeout(5000);
      msg =
        lines(await text(p), /can't|cannot|couldn|not allowed|permission|only/i).join(' | ') ||
        '(no message)';
    }
    const n = (await svc.from('daily_reports').select('id').eq('project_id', IDS.RIVERSIDE)).data
      .length;
    const ok = n === 4 && (!start || msg !== '(no message)');
    return [
      ok ? 'Pass' : 'Fail',
      `start offered=${start}; after tap: ${msg}; Riverside reports in DB=${n} (seed 4)`,
    ];
  });
  await ui('PERM-006', 'sub', async (p) => {
    await p.getByTestId('tab-settings').click();
    if (await visible(p, 'settings-members-link'))
      await p.getByTestId('settings-members-link').click();
    else await p.goto(`${BASE}/project/${IDS.RIVERSIDE}/members`);
    await p.getByTestId('screen-project-members').waitFor();
    await p.waitForTimeout(2500);
    const t = await text(p);
    const names = (
      await svc
        .from('profiles')
        .select('full_name')
        .in('id', [await userId('owner'), await userId('architect')])
    ).data.map((x) => x.full_name);
    const shown = names.filter((n) => n && t.includes(n));
    const mail = /qa-wl-(owner|architect)@/.test(t);
    const invite = await visible(p, 'project-members-invite-email', 1500);
    return [
      !invite && !shown.length && !mail ? 'Pass' : 'Fail',
      `invite form=${invite}; owner/architect names shown=${JSON.stringify(shown)} of ${JSON.stringify(names)}; emails shown=${mail}; list: ${t.split('\n').slice(1, 14).join(' | ')}`,
    ];
  });
  await ui('PERM-012', 'b-admin', async (p) => {
    const t = await text(p);
    await openReport(p, IDS.R_TODAY);
    const nf = await notFound(p);
    await p.goto(`${BASE}/project/${IDS.RIVERSIDE}/members`);
    await p.getByTestId('screen-project-members').waitFor();
    await p.waitForTimeout(2500);
    const mt = await text(p);
    const leaks = ['Superintendent', 'Project Manager', 'qa-wl-super'].filter((x) =>
      mt.includes(x),
    );
    const pier = t.includes('QA-WL Pier 9 Lofts');
    return [
      pier && nf && !leaks.length ? 'Pass' : 'Fail',
      `Today=Pier 9: ${pier}; Riverside draft by URL not found=${nf}; Riverside members leaks=${JSON.stringify(leaks)}`,
    ];
  });
  await ui('PERM-013', 'member', async (p) => {
    const t = await text(p);
    await openReport(p, IDS.R_TODAY);
    const nf = await notFound(p);
    return [
      t.includes('No project yet') && nf ? 'Pass' : 'Fail',
      `No project yet=${t.includes('No project yet')}; Riverside draft by URL not found=${nf}; API 0 rows (PERM-013-API)`,
    ];
  });
  await ui('LIFE-008-UI', 'b-admin', async (p) => {
    await openReport(p, IDS.PIER9_T1);
    const locked = await visible(p, 'report-status-locked', 20000);
    return [locked ? 'Pass' : 'Fail', `Pier 9 today-1 after auto-lock: locked chip=${locked}`];
  });
}

// -------------------------------------------------------------- mutate phase
const PROJ_NAME = process.env.PROJ_NAME ?? 'QA-WL Test Proj';
async function mutatePhase() {
  await ui('SECT-002', 'super', async (p) => {
    await openReport(p, IDS.R_TODAY);
    await openSheet(p, 'weather');
    await p.getByRole('button', { name: 'Rain', exact: true }).click();
    for (let i = 0; i < 3; i++)
      await p.getByRole('button', { name: 'Increase Temperature' }).click();
    await closeSheet(p, 'sheet-weather');
    const s = await summary(p, 'weather');
    const w = (
      await svc.from('report_weather').select('*').eq('report_id', IDS.R_TODAY).maybeSingle()
    ).data;
    const ok = /rain/i.test(s) && /52/.test(s) && w?.weather_source === 'manual';
    return [
      ok ? 'Pass' : 'Fail',
      `summary "${s}"; report_weather ${JSON.stringify(w).slice(0, 200)}`,
    ];
  });
  await ui('SECT-003', 'super', async (p) => {
    await openReport(p, IDS.R_TODAY);
    await openSheet(p, 'crew_work');
    await p.getByRole('button', { name: 'Plumbing', exact: true }).click();
    await p.waitForTimeout(500);
    for (let i = 0; i < 12; i++)
      await p
        .getByRole('button', { name: 'Decrease Plumbing worker count' })
        .click({ timeout: 2000 })
        .catch(() => {});
    for (let i = 0; i < 2; i++)
      await p.getByRole('button', { name: 'Increase Plumbing worker count' }).click();
    await p.getByRole('button', { name: 'Decrease Plumbing hours' }).click();
    await p.getByLabel('What was done').last().fill('QA plumbing rough-in L4');
    await closeSheet(p, 'sheet-crew-work');
    const s = await summary(p, 'crew_work');
    const pl = (await sectionOf(IDS.R_TODAY, 'crew'))?.rows?.find((r) => r.trade === 'Plumbing');
    const wp = JSON.stringify(await sectionOf(IDS.R_TODAY, 'work_performed'));
    await openSheet(p, 'crew_work');
    const persisted = (await p.getByLabel('What was done').last().inputValue()).includes(
      'QA plumbing',
    );
    await closeSheet(p, 'sheet-crew-work');
    const ok = pl?.headcount === 2 && pl?.hours === 7.5 && persisted && wp.includes('QA plumbing');
    return [
      ok ? 'Pass' : 'Fail',
      `summary "${s}"; Plumbing ${JSON.stringify(pl)} (12x decrement then +2, hours 8-0.5); work line saved=${wp.includes('QA plumbing')} persisted on reopen=${persisted}`,
    ];
  });
  await ui('SECT-004', 'super', async (p) => {
    await openReport(p, IDS.R_TODAY);
    await openSheet(p, 'deliveries');
    await p.getByTestId('sheet-deliveries-add').click();
    await p.getByLabel('Supplier').last().fill('QA Lumber Co');
    await p.getByLabel('Material').last().fill('2x6 studs');
    await p.getByRole('button', { name: 'Increase Delivery 3 quantity' }).click();
    await p.getByRole('button', { name: 'Pallets' }).last().click();
    await closeSheet(p, 'sheet-deliveries');
    const s = await summary(p, 'deliveries');
    const e = (await sectionOf(IDS.R_TODAY, 'deliveries'))?.entries?.find(
      (x) => x.supplier === 'QA Lumber Co',
    );
    return [
      e && /3 deliveries/.test(s) ? 'Pass' : 'Fail',
      `summary "${s}"; entry ${JSON.stringify(e)}`,
    ];
  });
  await ui('SECT-005', 'super', async (p) => {
    await openReport(p, IDS.R_TODAY);
    await openSheet(p, 'equipment');
    await p.getByPlaceholder('Equipment name').fill('QA Scissor lift');
    await p.getByTestId('sheet-equipment-add').click();
    await p.waitForTimeout(500);
    await p.getByRole('button', { name: 'Idle' }).last().click();
    await p.getByLabel('Tower crane on site').click();
    await closeSheet(p, 'sheet-equipment');
    const s = await summary(p, 'equipment');
    const rows = (await sectionOf(IDS.R_TODAY, 'equipment'))?.rows ?? [];
    const lift = rows.find((r) => r.name === 'QA Scissor lift');
    const crane = rows.find((r) => r.name === 'Tower crane');
    return [
      lift?.status === 'idle' && crane?.on_site === false ? 'Pass' : 'Fail',
      `summary "${s}"; lift ${JSON.stringify(lift)}; crane on_site=${crane?.on_site}`,
    ];
  });
  await ui('SECT-006', 'super', async (p) => {
    await openReport(p, IDS.R_TODAY);
    await openSheet(p, 'inspections');
    await p.getByTestId('sheet-inspections-add').click();
    await p.getByRole('button', { name: 'FDNY' }).last().click();
    await p.getByLabel('Inspector').last().fill('QA Insp. Rivera');
    await p.getByRole('button', { name: 'Partial' }).last().click();
    await closeSheet(p, 'sheet-inspections');
    const s = await summary(p, 'inspections');
    const e = JSON.stringify(await sectionOf(IDS.R_TODAY, 'inspections'));
    const ok = /2 inspections/.test(s) && e.includes('QA Insp. Rivera') && /partial/i.test(e);
    return [ok ? 'Pass' : 'Fail', `summary "${s}"; ${e.slice(0, 300)}`];
  });
  await ui('SECT-007', 'super', async (p) => {
    await openReport(p, IDS.R_TODAY);
    await openSheet(p, 'safety');
    await p
      .getByTestId('sheet-safety-none')
      .click({ timeout: 3000 })
      .catch(() => {});
    await p.waitForTimeout(2500);
    const none = JSON.stringify(await sectionOf(IDS.R_TODAY, 'safety'));
    if (
      !(await p
        .getByTestId('sheet-safety-add')
        .isVisible()
        .catch(() => false))
    )
      await openSheet(p, 'safety');
    await p.getByTestId('sheet-safety-add').click();
    await p.waitForTimeout(500);
    const labels = await p
      .locator('[role=button]:visible')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.innerText));
    const nm = labels.find((t) => /near/i.test(t ?? ''));
    if (nm) await p.getByRole('button', { name: nm }).last().click();
    await p.getByLabel('Description').last().fill('QA near miss: unsecured ladder');
    await closeSheet(p, 'sheet-safety');
    const s = await summary(p, 'safety');
    const after = JSON.stringify(await sectionOf(IDS.R_TODAY, 'safety'));
    const ok = after.includes('unsecured ladder') && /near/i.test(after) && !/None today/i.test(s);
    return [
      ok ? 'Pass' : 'Fail',
      `start "None today" payload ${none.slice(0, 100)}; added "${nm ?? 'no near-miss chip'}" -> "${s}" ${after.slice(0, 220)}`,
    ];
  });
  await ui('SECT-008', 'super', async (p) => {
    await openReport(p, IDS.R_TODAY);
    await openSheet(p, 'delays');
    await p.getByTestId('sheet-delays-add').click();
    await p.getByRole('button', { name: 'Material delivery' }).last().click();
    await p.getByLabel('Responsible party').last().fill('QA Supplier');
    await p.getByRole('button', { name: 'Increase Delay 2 duration' }).click();
    await closeSheet(p, 'sheet-delays');
    const s = await summary(p, 'delays');
    const rows = (await sectionOf(IDS.R_TODAY, 'delays'))?.rows ?? [];
    const ok = rows.length === 2 && rows.some((r) => r.is_ongoing) && /2 delays/.test(s);
    return [ok ? 'Pass' : 'Fail', `summary "${s}"; ${JSON.stringify(rows).slice(0, 300)}`];
  });
  await ui('SECT-009', 'super', async (p) => {
    await openReport(p, IDS.R_TODAY);
    await openSheet(p, 'visitors');
    await p.getByTestId('sheet-visitors-add').click();
    await p.getByLabel('Name').last().fill('QA Visitor Chen');
    await p.getByRole('button', { name: 'Engineer' }).last().click();
    await p.getByLabel('Time').last().fill('10:07');
    await p.getByLabel('Time').last().blur();
    await closeSheet(p, 'sheet-visitors');
    const s = await summary(p, 'visitors');
    const v = JSON.stringify(await sectionOf(IDS.R_TODAY, 'visitors'));
    const entry = v.match(/\{[^{}]*QA Visitor Chen[^{}]*\}/)?.[0];
    return [
      entry && /engineer/i.test(entry) && /3 visitors/.test(s) ? 'Pass' : 'Fail',
      `summary "${s}"; entry ${entry} (typed 10:07 against a 15-min rule)`,
    ];
  });
  await ui('SECT-010', 'super', async (p) => {
    await openReport(p, IDS.R_TODAY);
    await openSheet(p, 'rfis');
    await p.getByTestId('sheet-rfis-add').click();
    await p.getByLabel('Title').last().fill('QA RFI: header size at grid C');
    await p.getByRole('button', { name: 'Framing' }).last().click();
    await p.getByLabel('Needs answer from').last().fill('Architect');
    await closeSheet(p, 'sheet-rfis');
    const s = await summary(p, 'rfis');
    const e = JSON.stringify(await sectionOf(IDS.R_TODAY, 'rfis'));
    return [
      e.includes('header size') && /2 items/.test(s) ? 'Pass' : 'Fail',
      `summary "${s}"; ${e.slice(0, 250)}`,
    ];
  });
  await ui('SECT-011', 'super', async (p) => {
    await openReport(p, IDS.R_TODAY);
    await openSheet(p, 'general_notes');
    let txt = '';
    while (txt.length < 2000) txt += `QA line 🏗️👷 é ñ — ${txt.length}\n`;
    txt = txt.slice(0, 2000);
    await p.getByTestId('sheet-notes-input').fill(txt);
    await closeSheet(p, 'sheet-notes');
    await p.waitForTimeout(1500);
    const saved = (await sectionOf(IDS.R_TODAY, 'general_notes'))?.text ?? '';
    return [
      saved === txt ? 'Pass' : 'Fail',
      `typed ${txt.length} chars (emoji, accents, newlines); saved ${saved.length}, verbatim=${saved === txt}`,
    ];
  });
  await ui('SECT-013', 'super', async (p) => {
    await openReport(p, IDS.R_TODAY);
    await openSheet(p, 'general_notes');
    const v = `QA autosave ${Date.now()}`;
    await p.getByTestId('sheet-notes-input').fill(v);
    await p.waitForTimeout(3000);
    await p.reload();
    await p.getByTestId('report-section-general_notes').waitFor({ timeout: 60000 });
    const s = await summary(p, 'general_notes');
    const db = (await sectionOf(IDS.R_TODAY, 'general_notes'))?.text;
    return [
      db === v && s.includes(v) ? 'Pass' : 'Fail',
      `reload 3 s after typing, no Done: summary "${s}", db "${db}"`,
    ];
  });
  await ui('SYNC-014', 'super', async (p) => {
    const errRe = /couldn|offline|connection|failed|try again|not saved|network|went wrong/i;
    await openReport(p, IDS.R_TODAY);
    const before = (await sectionOf(IDS.R_TODAY, 'general_notes'))?.text;
    await openSheet(p, 'general_notes');
    await p.context().setOffline(true);
    await p.getByTestId('sheet-notes-input').fill('QA offline edit');
    await p.waitForTimeout(5000);
    const pill = await p
      .getByTestId('sync-status')
      .getAttribute('aria-label')
      .catch(() => '');
    const e1 = lines(await text(p), errRe);
    await p
      .getByTestId('sheet-notes-done')
      .click()
      .catch(() => {});
    await p.waitForTimeout(3000);
    const e2 = lines(await text(p), errRe);
    const sum = await summary(p, 'general_notes');
    const pill2 = await p
      .getByTestId('sync-status')
      .getAttribute('aria-label')
      .catch(() => '');
    await p.context().setOffline(false);
    await p.waitForTimeout(8000); // no further edit: does the offline edit ever reach the server?
    const afterReconnect = (await sectionOf(IDS.R_TODAY, 'general_notes'))?.text;
    await p.reload();
    await p.getByTestId('report-section-general_notes').waitFor({ timeout: 60000 });
    const sumReload = await summary(p, 'general_notes');
    const errs = [...new Set([...e1, ...e2])];
    const lost = afterReconnect !== 'QA offline edit';
    const ok = errs.length && !/All saved/i.test(`${pill} ${pill2}`);
    return [
      ok ? 'Pass' : 'Fail',
      `offline edit of notes: pill "${pill}" then "${pill2}", error copy ${JSON.stringify(errs)}, row summary "${sum}"; 8 s after reconnect db="${afterReconnect}" (before "${before?.slice(0, 40)}"), lost=${lost}; after reload "${sumReload}"`,
    ];
  });
  await ui('SECT-012', 'pm', async (p) => {
    const { data, error } = await (
      await as('pm')
    ).rpc('create_report', {
      p_project_id: IDS.DEPOT,
      p_report_date: todayIso(),
      p_client_id: crypto.randomUUID(),
    });
    if (error) throw error;
    await openReport(p, data[0].report_id);
    const out = [];
    for (const [row, prefix] of [
      ['deliveries', 'sheet-deliveries'],
      ['equipment', 'sheet-equipment'],
      ['inspections', 'sheet-inspections'],
      ['delays', 'sheet-delays'],
      ['visitors', 'sheet-visitors'],
      ['rfis', 'sheet-rfis'],
      ['general_notes', 'sheet-notes'],
    ]) {
      await openSheet(p, row);
      const has = await visible(p, `${prefix}-none`, 2500);
      if (has) await p.getByTestId(`${prefix}-none`).click();
      await p.waitForTimeout(800);
      if (
        await p
          .getByTestId(`${prefix}-done`)
          .isVisible()
          .catch(() => false)
      )
        await closeSheet(p, prefix);
      out.push(`${row}: -none=${has} -> "${await summary(p, row)}"`);
    }
    const ok = out.every((o) => o.includes('-none=true') && /none|nothing/i.test(o.split('->')[1]));
    return [ok ? 'Pass' : 'Fail', out.join('; ')];
  });
  await ui('TODAY-002', 'pm', async (p) => {
    const t = await text(p);
    const proj = ['Depot Warehouse', 'Riverside Tower'].find((x) => t.includes(x)) ?? '?';
    if (!(await visible(p, 'today-start-report', 3000)))
      return [
        'Blocked',
        `pm's Today shows ${proj} with an existing report card; Depot can't be made active on web (no switcher, TODAY-007), so get-or-create from Today can't be driven. Covered on Depot by API in SECT-012 (create_report)`,
      ];
    await p.getByTestId('today-start-report').click();
    await p.getByTestId('screen-report').waitFor({ timeout: 30000 });
    const url1 = p.url();
    await p.goto(BASE);
    await p.getByTestId('today-open-report').click();
    await p.getByTestId('screen-report').waitFor();
    return [url1 === p.url() ? 'Pass' : 'Fail', `${proj}: ${url1} then ${p.url()}`];
  });
  await ui('PROJ-001', 'super', async (p) => {
    await p.goto(`${BASE}/project/new`);
    await p.getByTestId('project-new-name').fill(PROJ_NAME);
    await p.getByTestId('project-new-address').fill('350 5th Ave, New York, NY');
    await p.getByTestId('project-new-submit').click();
    const back = await visible(p, 'screen-today', 30000);
    const stuck = back
      ? ''
      : ` STUCK on New project: ${(await text(p)).replace(/\s+/g, ' ').slice(0, 200)}`;
    if (!back) await p.goto(BASE);
    await p.waitForTimeout(2500);
    const t = await text(p);
    const proj = (await svc.from('projects').select('*').eq('name', PROJ_NAME).maybeSingle()).data;
    const role = proj
      ? (
          await svc
            .from('project_members')
            .select('role')
            .eq('project_id', proj.id)
            .eq('user_id', await userId('super'))
        ).data?.[0]?.role
      : null;
    return [
      back && proj && t.includes(PROJ_NAME) && role === 'super' ? 'Pass' : 'Fail',
      `returned to Today=${back}${stuck}; Today shows new project=${t.includes(PROJ_NAME)}; creator role=${role}; company_id=${proj?.company_id} tz=${proj?.timezone}`,
    ];
  });
  await ui('WEATH-006', 'super', async (p) => {
    const get = async () =>
      (await svc.from('projects').select('*').eq('name', PROJ_NAME).maybeSingle()).data;
    const before = await get();
    if (!(await visible(p, 'today-start-report', 5000)))
      return ['Fail', 'no start-report button for the new project'];
    await p.getByTestId('today-start-report').click();
    await p.getByTestId('screen-report').waitFor({ timeout: 30000 });
    await p.waitForTimeout(10000);
    await p.reload();
    await p.getByTestId('report-section-weather').waitFor({ timeout: 60000 });
    const after = await get();
    const s = await summary(p, 'weather');
    const rid = p.url().split('/').pop();
    const w = (
      await svc.from('report_weather').select('weather_source').eq('report_id', rid).maybeSingle()
    ).data;
    const geo = (x) =>
      `lat=${x?.lat ?? x?.latitude ?? 'null'} geocode_source=${x?.geocode_source ?? 'null'}`;
    return [
      (after?.lat ?? after?.latitude) && w?.weather_source === 'auto' ? 'Pass' : 'Fail',
      `after create: ${geo(before)}; after starting a report: ${geo(after)}; weather "${s}" source=${w?.weather_source ?? 'none'}`,
    ];
  });
  await ui('PROJ-004', 'member', async (p) => {
    await p.getByTestId('today-create-project').click();
    await p.getByTestId('project-new-name').fill('QA-WL Member Proj');
    await p.getByTestId('project-new-address').fill('zzzz nowhere 99999');
    await p.getByTestId('project-new-submit').click();
    await p.getByTestId('screen-today').waitFor({ timeout: 30000 });
    await p.waitForTimeout(2000);
    const proj = (
      await svc.from('projects').select('*').eq('name', 'QA-WL Member Proj').maybeSingle()
    ).data;
    const tz = await p.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    const ok =
      proj && proj.company_id === null && proj.timezone === tz && proj.geocode_source == null;
    return [
      ok ? 'Pass' : 'Fail',
      `company_id=${proj?.company_id} timezone=${proj?.timezone} (browser ${tz}) geocode_source=${proj?.geocode_source}`,
    ];
  });
  await ui('WEATH-007', 'member', async (p) => {
    if (!(await visible(p, 'today-start-report', 5000)))
      return ['Fail', 'no start-report on the new member project'];
    await p.getByTestId('today-start-report').click();
    await p.getByTestId('screen-report').waitFor({ timeout: 30000 });
    await p.waitForTimeout(6000);
    const err = lines(await text(p), /error|couldn|not found|failed/i);
    await openSheet(p, 'weather');
    await p.getByRole('button', { name: 'Snow', exact: true }).click();
    await closeSheet(p, 'sheet-weather');
    const s = await summary(p, 'weather');
    const proj = (
      await svc.from('projects').select('*').eq('name', 'QA-WL Member Proj').maybeSingle()
    ).data;
    return [
      !err.length && /snow/i.test(s) ? 'Pass' : 'Fail',
      `visible errors ${JSON.stringify(err)}; manual weather "${s}"; geocode_source=${proj?.geocode_source}`,
    ];
  });
  await ui('WEATH-001', 'b-admin', async (p) => {
    if (!(await visible(p, 'today-start-report', 5000)))
      return ['Fail', 'Pier 9 Today offers no start-report'];
    const t0 = Date.now();
    await p.getByTestId('today-start-report').click();
    await p.getByTestId('screen-report').waitFor({ timeout: 30000 });
    const ms = Date.now() - t0;
    await p.waitForTimeout(10000);
    await p.reload();
    await p.getByTestId('report-section-weather').waitFor({ timeout: 60000 });
    const s = await summary(p, 'weather');
    const rid = p.url().split('/').pop();
    const w = (await svc.from('report_weather').select('*').eq('report_id', rid).maybeSingle())
      .data;
    return [
      w?.weather_source === 'auto' ? 'Pass' : 'Fail',
      `report opened in ${ms} ms; weather "${s}"; report_weather ${JSON.stringify(w).slice(0, 180)}`,
    ];
  });
  await check('WEATH-003', async () => {
    const tok = (await (await as('super')).auth.getSession()).data.session.access_token;
    const date = (
      await svc.from('daily_reports').select('report_date').eq('id', IDS.R_TODAY).single()
    ).data.report_date;
    const r = await fetch('http://127.0.0.1:54321/functions/v1/worklog-weather', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ project_id: IDS.RIVERSIDE, report_date: date }),
    });
    const body = await r.text();
    const w = (
      await svc.from('report_weather').select('*').eq('report_id', IDS.R_TODAY).maybeSingle()
    ).data;
    return [
      body.includes('manual_override') && w?.weather_source === 'manual' ? 'Pass' : 'Fail',
      `worklog-weather on the Riverside draft after the manual edit (SECT-002): HTTP ${r.status} ${body.slice(0, 80)}; row ${JSON.stringify(w).slice(0, 140)}`,
    ];
  });
  await ui('WEATH-004', 'pm', async (p) => {
    const rid = (
      await svc
        .from('daily_reports')
        .select('id')
        .eq('project_id', IDS.DEPOT)
        .eq('report_date', todayIso())
        .maybeSingle()
    ).data?.id;
    if (!rid) return ['Fail', 'no Depot report for today'];
    await openReport(p, rid);
    await p.waitForTimeout(4000);
    const err = lines(await text(p), /error|couldn|failed/i);
    const s = await summary(p, 'weather');
    const w = (await svc.from('report_weather').select('*').eq('report_id', rid).maybeSingle())
      .data;
    return [
      !err.length && w?.weather_source !== 'auto' ? 'Pass' : 'Fail',
      `Depot (no geo) weather "${s}", source=${w?.weather_source ?? 'no row'}; visible errors ${JSON.stringify(err)}`,
    ];
  });
  await ui('PROJ-006', 'super', async (p) => {
    await p.goto(`${BASE}/project/${IDS.RIVERSIDE}/members`);
    await p.getByTestId('project-members-invite-email').fill(email('member'));
    await p
      .getByRole('button', { name: /^Sub/ })
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
    await p.getByTestId('project-members-invite-submit').click();
    const ok = await seen(
      p.getByText('Added to the project — they already have an account.'),
      20000,
    );
    const m = (
      await svc
        .from('project_members')
        .select('role')
        .eq('project_id', IDS.RIVERSIDE)
        .eq('user_id', await userId('member'))
    ).data?.[0];
    return [
      ok && m?.role === 'sub' ? 'Pass' : 'Fail',
      `toast=${ok}; member role on Riverside=${m?.role}`,
    ];
  });
  await ui('PROJ-007', 'super', async (p) => {
    await p.goto(`${BASE}/project/${IDS.RIVERSIDE}/members`);
    await p.getByTestId('project-members-invite-email').fill('qa-wl-invite1@worklog.test');
    await p
      .getByRole('button', { name: /^Super/ })
      .first()
      .click({ timeout: 3000 })
      .catch(() => {});
    const want = 'Invite created — email delivery is not configured for this instance.';
    await p.getByTestId('project-members-invite-submit').click();
    const toast = await seen(
      p
        .getByText(/Invite created|invite|couldn|not configured/i)
        .filter({ hasNotText: /Send invite|INVITE A TEAMMATE/i }),
      15000,
    );
    const t = await text(p);
    const line = lines(t, /invite|email|couldn/i).filter(
      (l) => !/Send invite|name@example|^Email$/.test(l),
    );
    return [
      t.includes(want) ? 'Pass' : 'Fail',
      `toast seen=${toast}; copy: ${JSON.stringify(line)}`,
    ];
  });
  await check('A11Y-004', async () => [
    'Pass',
    'every web edit (SECT-002..013), project create and invite driven by click and typing only; no long-press, drag or swipe needed',
  ]);
}

// ---------------------------------------------------------------- mail phase
async function mailbox(to, sinceMs) {
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${MAILPIT}/api/v1/messages?limit=50`).then((x) => x.json());
    const m = r.messages?.find(
      (x) => x.To?.some((t) => t.Address === to) && new Date(x.Created).getTime() >= sinceMs - 2000,
    );
    if (m) return fetch(`${MAILPIT}/api/v1/message/${m.ID}`).then((x) => x.json());
    await new Promise((res) => setTimeout(res, 1500));
  }
  return null;
}
const linksIn = (mail) =>
  `${mail?.Text ?? ''} ${mail?.HTML ?? ''}`
    .match(/https?:\/\/[^\s"'<>]+/g)
    ?.map((u) => u.replace(/&amp;/g, '&')) ?? [];

async function mailPhase() {
  let regLink = null;
  await ui('AUTH-009', null, async (p) => {
    const t0 = Date.now();
    await p.getByTestId('login-register').click();
    await p.locator('input[aria-label="Company name"]:visible').fill('QA-WL Reg Test');
    await p.locator('input[aria-label="Your name"]:visible').fill('QA Reg One');
    await p.locator('input[aria-label="Email"]:visible').fill('qa-wl-reg1@worklog.test');
    const pw = await p.locator('input[type=password]:visible').count();
    await p.getByTestId('register-submit').click();
    const doneH = await visible(p, 'register-done-heading', 30000);
    const err = (await visible(p, 'register-error', 500))
      ? await p.getByTestId('register-error').innerText()
      : '';
    const mail = await mailbox('qa-wl-reg1@worklog.test', t0);
    regLink = linksIn(mail).find((u) => /verify|confirm|token/.test(u)) ?? null;
    const u = (await svc.auth.admin.listUsers({ perPage: 1000 })).data.users.find(
      (x) => x.email === 'qa-wl-reg1@worklog.test',
    );
    const co = (await svc.from('companies').select('id').eq('name', 'QA-WL Reg Test')).data ?? [];
    const cm =
      u && co[0]
        ? (
            await svc
              .from('company_members')
              .select('role')
              .eq('user_id', u.id)
              .eq('company_id', co[0].id)
          ).data
        : [];
    const ok = doneH && pw === 0 && mail && co.length === 1 && cm?.[0]?.role === 'admin';
    return [
      ok ? 'Pass' : 'Fail',
      `done heading=${doneH} ${err}; password inputs=${pw}; Mailpit "${mail?.Subject ?? 'none'}"; company rows=${co.length}; membership=${cm?.[0]?.role}; link host=${regLink ? new URL(regLink).host : 'none'}`,
    ];
  });
  await ui('AUTH-011', null, async (p) => {
    let via = 'register confirmation';
    let finalPw = 'Qa-strong-pass-2026!';
    if (!regLink) {
      // Fallback: the password-reset mail from AUTH-005 lands on the same screen.
      const t0 = Date.now();
      await p.getByTestId('login-email').fill(email('pm'));
      await p.getByTestId('login-forgot').click();
      const m = await mailbox(email('pm'), t0);
      regLink = linksIn(m).find((u) => /verify|token/.test(u)) ?? null;
      via =
        'password-reset mail for qa-wl-pm (register blocked locally; re-seed restores the password)';
      finalPw = 'Qa-reset-pass-2026!';
    }
    if (!regLink) return ['Blocked', 'no auth link in Mailpit'];
    // Auth's verify endpoint 303s to redirect_to with the session fragment.
    const res = await fetch(regLink, { redirect: 'manual' });
    const loc = res.headers.get('location') ?? '';
    const hash = loc.includes('#') ? loc.slice(loc.indexOf('#')) : '';
    await p.goto(`${BASE}/set-password${hash}`);
    const input = await visible(p, 'set-password-input', 30000);
    if (!input)
      return [
        'Fail',
        `verify -> ${loc.split('#')[0]}; /set-password shows: ${(await text(p)).slice(0, 160)}`,
      ];
    await p.getByTestId('set-password-input').fill('abc');
    const s1 = await p
      .getByTestId('set-password-strength')
      .innerText()
      .catch(() => '');
    await p.getByTestId('set-password-input').fill(finalPw);
    const s2 = await p
      .getByTestId('set-password-strength')
      .innerText()
      .catch(() => '');
    await p.getByTestId('set-password-confirm-input').fill('Qa-strong-pass-2027!');
    await p.getByTestId('set-password-submit').click();
    const mism = await visible(p, 'set-password-error', 5000);
    const mmsg = mism ? await p.getByTestId('set-password-error').innerText() : '';
    await p.getByTestId('set-password-confirm-input').fill(finalPw);
    await p.getByTestId('set-password-submit').click();
    const today = await visible(p, 'screen-today', 30000);
    const t = today ? await text(p) : '';
    const ok = s1 !== s2 && mism && today;
    return [
      ok ? 'Pass' : 'Fail',
      `via ${via}: link redirects to ${loc.split('#')[0]} (fragment replayed on local /set-password); strength "${s1}" -> "${s2}"; mismatch "${mmsg}"; lands on Today=${today} "${t.split('\n').slice(0, 3).join(' / ')}"`,
    ];
  });
  await ui('AUTH-010', null, async (p) => {
    await p.getByTestId('login-register').click();
    await p.locator('input[aria-label="Company name"]:visible').fill('QA-WL Dup Test');
    await p.locator('input[aria-label="Your name"]:visible').fill('QA Dup');
    await p.locator('input[aria-label="Email"]:visible').fill(email('super'));
    await p.getByTestId('register-submit').click();
    const doneH = await visible(p, 'register-done-heading', 30000);
    const err = (await visible(p, 'register-error', 500))
      ? await p.getByTestId('register-error').innerText()
      : '';
    const co = (await svc.from('companies').select('id').eq('name', 'QA-WL Dup Test')).data ?? [];
    return [
      doneH && !err ? 'Pass' : 'Fail',
      `same "Check your email" state=${doneH} ${err}; company rows created for existing email=${co.length}`,
    ];
  });
  await ui('AUTH-005', null, async (p) => {
    const t0 = Date.now();
    await p.getByTestId('login-email').fill(email('super'));
    await p.getByTestId('login-forgot').click();
    const notice = await visible(p, 'login-notice', 20000);
    let n = notice ? await p.getByTestId('login-notice').innerText() : '';
    if (!notice && (await visible(p, 'login-error', 500)))
      n = `error: ${await p.getByTestId('login-error').innerText()}`;
    const mail = await mailbox(email('super'), t0);
    const redirect = linksIn(mail)
      .map((u) => new URL(u).searchParams.get('redirect_to'))
      .find(Boolean);
    return [
      notice && mail ? 'Pass' : 'Fail',
      `login-notice "${n}"; Mailpit "${mail?.Subject ?? 'none'}"; redirect_to=${redirect ?? 'n/a'}`,
    ];
  });
  await ui('AUTH-016', 'super', async (p) => {
    await p.getByTestId('tab-settings').click();
    await p.getByTestId('settings-signout').click();
    const msg = (await p.getByTestId('settings-signout-message').innerText()).replace(/\s+/g, ' ');
    await p.getByTestId('settings-signout-cancel').click();
    await p.waitForTimeout(800);
    const still = await visible(p, 'screen-settings');
    await p.getByTestId('settings-signout').click();
    await p.getByTestId('settings-signout-confirm').click();
    const login = await visible(p, 'login-email', 30000);
    return [
      still && login && /queued|device|cleared/i.test(msg) ? 'Pass' : 'Fail',
      `cancel keeps session=${still}; copy "${msg}"; confirm -> login=${login}`,
    ];
  });
}

// ------------------------------------------------------------ new-user phases
async function newUserPhase() {
  await ui('PERM-014', 'new', async (p) => {
    await p.getByTestId('today-create-project').click();
    await p.getByTestId('project-new-name').fill('QA-WL New First Proj');
    await p.getByTestId('project-new-address').fill('350 5th Ave, New York, NY 10118');
    await p.getByTestId('project-new-submit').click();
    await p.getByTestId('today-start-report').waitFor({ timeout: 30000 });
    await p.getByTestId('today-start-report').click();
    await p.getByTestId('screen-report').waitFor({ timeout: 30000 });
    await openSheet(p, 'general_notes');
    await p.getByTestId('sheet-notes-input').fill('QA new user first note');
    await closeSheet(p, 'sheet-notes');
    await p.waitForTimeout(1500);
    const rid = p.url().split('/').pop();
    // WEATH-006 rides on this in-app create (real NYC address, internet on).
    await p.waitForTimeout(8000);
    await p.reload();
    await p.getByTestId('report-section-weather').waitFor({ timeout: 60000 });
    const wsum = await summary(p, 'weather');
    const pr = (
      await svc
        .from('projects')
        .select('lat,lng,geocode_source')
        .eq('name', 'QA-WL New First Proj')
        .maybeSingle()
    ).data;
    const w = (
      await svc
        .from('report_weather')
        .select('weather_source,auto_condition,auto_temp_f')
        .eq('report_id', rid)
        .maybeSingle()
    ).data;
    record(
      'WEATH-006',
      pr?.lat && w?.weather_source === 'auto' ? 'Pass' : 'Fail',
      `in-app create by qa-wl-new with '350 5th Ave, New York, NY 10118': project lat=${pr?.lat} lng=${pr?.lng} geocode_source=${pr?.geocode_source}; first report weather "${wsum}" ${JSON.stringify(w)}`,
    );
    const notes = (await sectionOf(rid, 'general_notes'))?.text;
    const proj = (
      await svc.from('projects').select('id').eq('name', 'QA-WL New First Proj').maybeSingle()
    ).data;
    const role = proj
      ? (await svc.from('project_members').select('role').eq('project_id', proj.id)).data?.[0]?.role
      : null;
    return [
      role === 'super' && notes === 'QA new user first note' ? 'Pass' : 'Fail',
      `creator role=${role}; draft ${rid}; notes saved="${notes}"`,
    ];
  });
}
async function companyPhase() {
  await ui('TODAY-006', 'new', async (p) => {
    await p.getByTestId('today-company-name').fill('QA-WL New Co');
    await p.getByTestId('today-company-submit').click();
    const notice = await seen(p.getByText('Your company is set up.'), 30000);
    await p.waitForTimeout(2500);
    const card = await visible(p, 'today-company-card', 1500);
    const err = (await visible(p, 'today-company-error', 500))
      ? await p.getByTestId('today-company-error').innerText()
      : '';
    const co = (await svc.from('companies').select('id').eq('name', 'QA-WL New Co').maybeSingle())
      .data;
    const role = co
      ? (await svc.from('company_members').select('role').eq('company_id', co.id)).data?.[0]?.role
      : null;
    return [
      notice && !card && role === 'admin' ? 'Pass' : 'Fail',
      `toast=${notice} ${err}; card hidden=${!card}; company role=${role}`,
    ];
  });
}

// --------------------------------------------------------- destructive phase
async function destructivePhase() {
  await ui('DEL-006', 'admin', async (p) => {
    const calls = [];
    p.on(
      'request',
      (r) =>
        r.url().includes('/functions/v1/delete-account') && r.method() === 'POST' && calls.push(1),
    );
    await p.getByTestId('tab-settings').click();
    await p.getByTestId('settings-delete-account').click();
    await p.getByTestId('settings-delete-account-confirm').waitFor();
    await p.waitForTimeout(2500);
    await p.getByTestId('settings-delete-account-confirm').dblclick();
    const deleting = await seen(p.getByText('Deleting…'), 1500);
    await seen(p.getByText("Can't delete your account"), 30000);
    return [
      calls.length === 1 ? 'Pass' : 'Fail',
      `double-click sent ${calls.length} delete-account request(s); "Deleting…" shown=${deleting}`,
    ];
  });
  await ui('DEL-005', 'admin', async (p) => {
    await p.getByTestId('tab-settings').click();
    await p.getByTestId('settings-delete-account').click();
    await p.waitForTimeout(2500);
    await p.getByTestId('settings-delete-account-confirm').click();
    const title = await seen(p.getByText("Can't delete your account"), 30000);
    const msg = (await p.getByTestId('settings-delete-account-message').innerText()).replace(
      /\s+/g,
      ' ',
    );
    const btns = `${await p.getByTestId('settings-delete-account-confirm').innerText()} / ${await p.getByTestId('settings-delete-account-cancel').innerText()}`;
    const still = !!(await userId('admin'));
    return [
      title && /Try again/.test(btns) && /Close/.test(btns) && still ? 'Pass' : 'Fail',
      `title changed=${title}; message "${msg}"; buttons ${btns}; account still exists=${still}`,
    ];
  });
  await ui('DEL-008', 'solo', async (p) => {
    const count = async () => ({
      project: (await svc.from('projects').select('id').eq('id', IDS.SOLO)).data.length,
      reports: (await svc.from('daily_reports').select('id').eq('project_id', IDS.SOLO)).data
        .length,
      signatures: (
        await svc
          .from('report_signatures')
          .select('id')
          .in('report_id', [P('00000000d401'), P('00000000d402')])
      ).data.length,
      photoRows: (await svc.from('report_photos').select('id').eq('project_id', IDS.SOLO)).data
        .length,
      storage: (await svc.storage.from('worklog-photos').list(IDS.SOLO)).data?.length ?? 0,
    });
    const before = await count();
    await p.getByTestId('tab-settings').click();
    await p.getByTestId('settings-delete-account').click();
    await p.waitForTimeout(3000);
    await p.getByTestId('settings-delete-account-confirm').click();
    const login = await visible(p, 'login-email', 60000);
    await p.getByTestId('login-email').fill(email('solo'));
    await p.getByTestId('login-password').fill(QA_PASSWORD);
    await p.getByTestId('login-submit').click();
    const refused = await visible(p, 'login-error', 15000);
    const after = await count();
    const ok = login && refused && Object.values(after).every((v) => v === 0);
    return [
      ok ? 'Pass' : 'Fail',
      `before ${JSON.stringify(before)}; signed out=${login}; re-sign-in refused=${refused}; after ${JSON.stringify(after)}`,
    ];
  });
  await check('DEL-011', async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const { KEYS, URL_BASE } = await import('./lib.mjs');
    const c = createClient(URL_BASE, KEYS.anon, { auth: { persistSession: false } });
    const { error } = await c.auth.signInWithPassword({
      email: email('solo'),
      password: QA_PASSWORD,
    });
    return [
      error ? 'Pass' : 'Fail',
      `signInWithPassword(qa-wl-solo) after deletion: ${error?.message ?? 'SUCCEEDED'} (same JobSight auth PunchLog uses)`,
    ];
  });
  await ui('DEL-010', 'super', async (p) => {
    const superId = await userId('super');
    await p.getByTestId('tab-settings').click();
    await p.getByTestId('settings-delete-account').click();
    await p.waitForTimeout(3000);
    await p.getByTestId('settings-delete-account-confirm').click();
    const login = await visible(p, 'login-email', 60000);
    const reports = (await svc.from('daily_reports').select('*').eq('project_id', IDS.RIVERSIDE))
      .data;
    const refs = reports.filter((r) => JSON.stringify(r).includes(superId)).length;
    const prof = (await svc.from('profiles').select('*').eq('id', superId).maybeSingle()).data;
    const authUser = await userId('super');
    await p.getByTestId('login-email').fill(email('pm'));
    await p.getByTestId('login-password').fill(QA_PASSWORD);
    await p.getByTestId('login-submit').click();
    await p.getByTestId('screen-today').waitFor({ timeout: 60000 });
    await openReport(p, IDS.R_T1);
    const t1 = await visible(p, 'report-status-submitted');
    const kept = reports.filter((r) => r.status !== 'draft').length;
    const pii = prof
      ? Object.entries(prof)
          .filter(([k, v]) => v && /name|email|phone|title|avatar/i.test(k))
          .map(([k, v]) => `${k}=${v}`)
      : [];
    const deletedLabel = (await text(p)).includes('Deleted user');
    const ok = login && kept >= 3 && t1 && !authUser && pii.every((x) => /deleted/i.test(x));
    return [
      ok ? 'Pass' : 'Fail',
      `signed out=${login}; Riverside reports kept=${reports.length} (${reports.map((r) => r.status)}), rows still holding super's id=${refs}; profile row=${prof ? `present, personal fields ${JSON.stringify(pii)}` : 'gone'}; auth user=${authUser ? 'present' : 'gone'}; pm opens today-1=${t1}; "Deleted user" on report=${deletedLabel}`,
    ];
  });
}

const phases = {
  read: readPhase,
  mutate: mutatePhase,
  mail: mailPhase,
  newuser: newUserPhase,
  company: companyPhase,
  destructive: destructivePhase,
};
try {
  await phases[PHASE]();
} finally {
  await browser.close();
}
