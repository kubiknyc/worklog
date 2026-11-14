// One-off: dump interactive controls of every section sheet on the Riverside draft.
import { chromium } from 'playwright';
import { QA_PASSWORD } from '../seed/seed-local.mjs';
const BASE = 'http://localhost:8081';
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 430, height: 932 } });
await p.goto(BASE + '/login');
await p.getByTestId('login-email').fill('qa-wl-super@worklog.test', { timeout: 300000 });
await p.getByTestId('login-password').fill(QA_PASSWORD);
await p.getByTestId('login-submit').click();
await p.getByTestId('screen-today').waitFor({ timeout: 120000 });
await p.goto(BASE + '/report/0b000000-0000-4000-8000-00000000d101');
await p.getByTestId('report-status-draft').waitFor({ timeout: 60000 });
const rows = await p
  .locator('[data-testid^="report-section-"]')
  .evaluateAll((els) =>
    els.map((e) => e.dataset.testid + ' :: ' + e.innerText.replace(/\s+/g, ' ')),
  );
console.log(rows.join('\n'));
for (const r of rows.map((x) => x.split(' :: ')[0])) {
  await p.getByTestId(r).click();
  await p.waitForTimeout(800);
  const dump = await p.evaluate(() =>
    [
      ...document.querySelectorAll(
        '[role=button],button,input,textarea,[role=switch],[role=checkbox],[role=radio],[data-testid^="sheet-"]',
      ),
    ]
      .filter((e) => e.offsetParent !== null)
      .map(
        (e) =>
          `${e.tagName.toLowerCase()}${e.dataset.testid ? '#' + e.dataset.testid : ''}[${e.getAttribute('aria-label') ?? e.getAttribute('placeholder') ?? ''}]${e.getAttribute('aria-checked') ?? e.getAttribute('aria-selected') ?? ''}`,
      )
      .join(' | '),
  );
  console.log('\n=== ' + r + '\n' + dump.slice(0, 1800));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
  if (
    await p
      .locator('[data-testid$="-done"]')
      .first()
      .isVisible()
      .catch(() => false)
  )
    await p.locator('[data-testid$="-done"]').first().click();
  await p.waitForTimeout(500);
}
await b.close();
