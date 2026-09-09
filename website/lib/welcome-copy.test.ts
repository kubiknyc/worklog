/**
 * Pins the /welcome success copy to the audience it is shown to.
 *
 * /welcome serves three kinds of reader: a founder confirming a company signup,
 * an invited subcontractor, and anyone following a password-reset link. Only
 * the founder has a company. Telling an invited sub "your company is ready —
 * create your first project and invite your team" describes an account they do
 * not have and cannot act on, which reads as the link having gone somewhere
 * wrong. That is the same category of failure as a dead button: the page
 * technically worked and the user still concludes it didn't.
 *
 * Asserting against the source (the pattern established by PunchLog's
 * lib/legal-copy.test.ts) rather than rendering, because `website/` has no
 * jsdom or component-test setup — vitest here only collects `lib/**\/*.test.ts`.
 * The tradeoff is brittleness: extracting these strings into constants will
 * break this file while the page is unchanged. Update it deliberately when
 * that happens.
 *
 * Adapted from PunchLog's website (PLW/lib/welcome-copy.test.ts): this repo's
 * website doesn't have /forgot-password, /register, or /download routes
 * (out of scope — those flows live in the native app), so the assertions
 * below pin the app-directed copy this port uses instead of PLW's website
 * links.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vitest";

const page = readFileSync(join(process.cwd(), "app/welcome/page.tsx"), "utf8");

test("the company copy is still shown, and only for a signup link", () => {
  expect(page).toContain("your company is ready");
  // The guard, not just the string: if this branch is ever widened to all
  // readers, the invitee sees somebody else's account described back to them.
  expect(page).toContain('linkType === "signup"');
});

test("a non-signup reader is pointed back at the app, not a dead website route", () => {
  expect(page).toContain("Open the WorkLog app");
  // /download, /register, and /forgot-password don't exist on this site
  // (out of scope — see the plan's Global Constraints); every registrant who
  // reaches /welcome came from the app, so recovery copy must not link to
  // pages that would 404.
  expect(page).not.toContain('href="/download"');
  expect(page).not.toContain('href="/register"');
  expect(page).not.toContain('href="/forgot-password"');
});

test("the invitee copy never claims they have a company", () => {
  // Split on the signup guard and check the fallback halves only — the company
  // sentence is legitimate above it.
  const fallbackHalves = page.split('linkType === "signup"').slice(1);
  expect(fallbackHalves.length).toBeGreaterThan(0);
  for (const half of fallbackHalves) {
    const elseBranch = half.split(") : (")[1] ?? "";
    expect(elseBranch).not.toContain("your company is ready");
    expect(elseBranch).not.toContain("create your first project");
  }
});

// "PunchLog" itself may still appear inside the file's provenance comment
// (Global Constraints explicitly allow that) — this only guards the rendered
// copy, which is everything outside the header /** ... */ block.
test("branding in the rendered copy is WorkLog, no leftover PunchLog/punchlist strings", () => {
  const body = page.slice(page.indexOf("*/") + 2);
  expect(body).not.toContain("PunchLog");
  expect(body).not.toContain("punchlist");
  expect(body).toContain("WorkLog");
});

// Informed consent: nobody is made the administrator of a company they were
// never shown. Both halves of that promise are one RPC each, so pin both names
// — losing the discard call would silently leave the marker parked.
test("the register flow asks before it creates, and can decline", () => {
  expect(page).toContain("claim_pending_company");
  expect(page).toContain("discard_pending_company");
  expect(page).toContain("Yes, set it up");
  expect(page).toContain("No, that&apos;s not my company");
});

// A signup-link reader who declined the parked company, or whose claim went
// stale, still lands on the "done" card. Without a guard, that card would
// tell them their company is ready when none was ever created — a promise
// they can't act on. Pin both: the guard on the existing sentence, and the
// honest fallback that replaces it.
test("the done card's company-ready copy is guarded against a declined or stale claim", () => {
  expect(page).toContain('linkType === "signup" && !declinedCompany && !claimStale');
  expect(page).toContain("You can register your company from the WorkLog app whenever");
});

// The company name arrives in a URL fragment anyone can craft, so it may only
// ever be React text. An innerHTML escape hatch here would be a phishing hole
// under the real logo — the same guard hasHashError exists for.
test("the company name is rendered as text, never as markup", () => {
  expect(page).toContain("{phase.company}");
  expect(page).not.toContain("dangerouslySetInnerHTML");
});
