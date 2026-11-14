// One-off probe for SECT-015: are submitted/locked sheets actually read-only?
import { chromium } from 'playwright';
import { email, IDS, QA_PASSWORD, service } from './lib.mjs';
const BASE = 'http://localhost:8081';
const svc = service();
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 430, height: 932 } });
await p.goto(BASE + '/login');
await p.getByTestId('login-email').fill(email('super'), { timeout: 120000 });
await p.getByTestId('login-password').fill(QA_PASSWORD);
await p.getByTestId('login-submit').click();
await p.getByTestId('screen-today').waitFor({ timeout: 60000 });
for (const rid of [IDS.R_T1, IDS.R_T2]) {
  await p.goto(`${BASE}/report/${rid}`);
  await p.locator('[data-testid^="report-status-"]').first().waitFor({ timeout: 60000 });
  const rows = await p
    .locator('[data-testid^="report-section-"]')
    .evaluateAll((els) => els.map((e) => e.dataset.testid));
  for (const r of rows) {
    await p.getByTestId(r).click();
    await p.waitForTimeout(700);
    const ro = await p
      .getByTestId('sheet-readonly')
      .isVisible()
      .catch(() => false);
    const ed = await p
      .locator(
        '[data-testid$="-add"]:visible, [data-testid$="-none"]:visible, textarea:visible:not([readonly]), input:visible:not([readonly])',
      )
      .count();
    const btns = await p
      .locator(
        '[role=button]:visible[aria-label^="Increase"], [role=button]:visible[aria-label^="Remove"]',
      )
      .count();
    console.log(
      `${rid.slice(-4)} ${r}: readonly-notice=${ro} enabled-editors=${ed} steppers/remove=${btns}`,
    );
    await p.locator('[data-testid$="-done"]:visible').first().click();
    await p.waitForTimeout(500);
  }
}
// try an edit on locked crew
await p.goto(`${BASE}/report/${IDS.R_T2}`);
await p.getByTestId('report-section-crew_work').waitFor({ timeout: 60000 });
const before = JSON.stringify(
  (
    await svc
      .from('report_sections')
      .select('payload')
      .eq('report_id', IDS.R_T2)
      .eq('section', 'crew')
      .single()
  ).data,
);
await p.getByTestId('report-section-crew_work').click();
await p.waitForTimeout(700);
await p
  .getByRole('button', { name: 'Increase Framing worker count' })
  .click({ timeout: 3000 })
  .catch((e) => console.log('click inc:', e.message.split('\n')[0]));
await p
  .getByLabel('Area')
  .first()
  .fill('QA TAMPER', { timeout: 3000 })
  .catch((e) => console.log('fill area:', e.message.split('\n')[0]));
await p.waitForTimeout(3000);
const shown = await p
  .getByLabel('Area')
  .first()
  .inputValue()
  .catch(() => '?');
const body = (await p.locator('body').innerText())
  .split('\n')
  .filter((l) => /couldn|error|locked|fail|amend/i.test(l));
await p.screenshot({ path: 'results/SECT-015-probe.png' });
await p.locator('[data-testid$="-done"]:visible').first().click();
await p.waitForTimeout(2500);
const summ = await p.getByTestId('report-section-crew_work').innerText();
const after = JSON.stringify(
  (
    await svc
      .from('report_sections')
      .select('payload')
      .eq('report_id', IDS.R_T2)
      .eq('section', 'crew')
      .single()
  ).data,
);
console.log(
  `after edit attempt: Area field shows "${shown}"; messages ${JSON.stringify(body)}; summary "${summ.replace(/\s+/g, ' ')}"; db unchanged=${before === after}`,
);
await b.close();
