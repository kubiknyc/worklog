#!/usr/bin/env node
// Web smoke against the LOCAL stack: sign in as qa-wl-super through the real
// UI, see today's seeded draft on Today, open it. Expects Expo web already
// running against the local stack (qa/README.md §4).
//
//   cd qa/web && npm install && node smoke-local.mjs [screenshot.png]
//
// Env: QA_WEB_URL (default http://localhost:8081),
//      QA_BROWSER_CHANNEL (default 'chrome' = installed Chrome; '' = Playwright's Chromium).

import { chromium } from 'playwright';
import { QA_PASSWORD } from '../seed/seed-local.mjs';

const BASE = process.env.QA_WEB_URL ?? 'http://localhost:8081';
const CHANNEL = process.env.QA_BROWSER_CHANNEL ?? 'chrome';
const SHOT = process.argv[2];
const PROJECT = 'QA-WL Riverside Tower';

const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
try {
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  await page.goto(BASE, { timeout: 300_000 });
  await page.getByTestId('login-email').fill('qa-wl-super@worklog.test', { timeout: 300_000 }); // cold bundle
  await page.getByTestId('login-password').fill(QA_PASSWORD);
  await page.getByTestId('login-submit').click();

  await page.getByTestId('today-status-draft').waitFor({ timeout: 120_000 });
  await page.getByText(PROJECT).first().waitFor({ timeout: 30_000 });
  await page.getByTestId('today-open-report').click();
  await page.getByTestId('report-status-draft').waitFor({ timeout: 60_000 });

  if (SHOT) await page.screenshot({ path: SHOT, fullPage: true });
  console.log(`PASS qa-wl-super signed in on web, sees today's draft on "${PROJECT}" and opens it`);
} catch (err) {
  console.error(`FAIL ${err.message.split('\n')[0]}`);
  if (SHOT) await browser.contexts()[0]?.pages()[0]?.screenshot({ path: SHOT }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
