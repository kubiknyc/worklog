// One-off probe: does the Weather row summary refresh after a manual edit?
import { chromium } from 'playwright';
import { email, IDS, QA_PASSWORD } from './lib.mjs';
const BASE = 'http://localhost:8081';
const b = await chromium.launch({ channel: 'chrome' });
const p = await b.newPage({ viewport: { width: 430, height: 932 } });
await p.goto(BASE + '/login');
await p.getByTestId('login-email').fill(email('pm'), { timeout: 120000 });
await p.getByTestId('login-password').fill(QA_PASSWORD);
await p.getByTestId('login-submit').click();
await p.getByTestId('screen-today').waitFor({ timeout: 60000 });
await p.goto(`${BASE}/report/${IDS.R_TODAY}`);
await p.getByTestId('report-section-weather').waitFor({ timeout: 60000 });
const s0 = await p.getByTestId('report-section-weather').innerText();
await p.getByTestId('report-section-weather').click();
await p.getByRole('button', { name: 'Fog', exact: true }).click();
await p.getByTestId('sheet-weather-done').click();
const out = [`before "${s0.replace(/\s+/g, ' ')}"`];
for (const t of [1, 5, 15]) {
  await p.waitForTimeout(t === 1 ? 1000 : t === 5 ? 4000 : 10000);
  out.push(
    `${t}s "${(await p.getByTestId('report-section-weather').innerText()).replace(/\s+/g, ' ')}"`,
  );
}
await p.getByTestId('report-section-crew_work').click();
await p.getByTestId('sheet-crew-work-done').click();
await p.waitForTimeout(2000);
out.push(
  `after opening/closing another sheet "${(await p.getByTestId('report-section-weather').innerText()).replace(/\s+/g, ' ')}"`,
);
await p.reload();
await p.getByTestId('report-section-weather').waitFor({ timeout: 60000 });
out.push(
  `after reload "${(await p.getByTestId('report-section-weather').innerText()).replace(/\s+/g, ' ')}"`,
);
await p.screenshot({ path: 'results/SECT-002-probe.png' });
console.log(out.join(' | '));
await b.close();
