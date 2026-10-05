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

// `linkType === "signup"` now guards two branches, so a generic split would
// leave one half's assertions vacuous. Pin the done card's else branch itself.
test("the invitee copy never claims they have a company", () => {
  const doneCard =
    page.split('phase.kind === "done" ? (')[1]?.split('phase.kind === "confirmed"')[0] ?? "";
  const elseBranch =
    doneCard
      .split('linkType === "signup" && claimedCompany ? (')[1]
      ?.split(") : (")[1]
      ?.split("<CreateCompanyForm")[0] ?? "";
  expect(elseBranch).toContain(
    '"Your password is saved. Open the WorkLog app on your phone and sign in — your projects will be waiting."',
  );
  expect(elseBranch).not.toContain("your company is ready");
  expect(elseBranch).not.toContain("create your first project");
  const confirmedCard = page.split('phase.kind === "confirmed"')[1] ?? "";
  expect(confirmedCard).toContain("Your email is verified. Open the WorkLog app");
  expect(confirmedCard).not.toContain("your company is ready");
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

// The confirm-time trigger that minted the company is retired, so only a
// successful claim creates one. Declined, skipped, out-of-date and nameless
// readers all reach "done" with no company, and must not be told it is ready.
test("only a successful claim earns the company-ready copy", () => {
  expect(page).toContain('linkType === "signup" && claimedCompany ? (');
  // The promise appears exactly once, and the flag is set in exactly one
  // place: the claim's success branch.
  expect(page.split("your company is ready").length).toBe(2);
  expect(page.split("setClaimedCompany(true)").length).toBe(2);
  expect(page).toMatch(/if \(response\.ok\) \{\s*setClaimedCompany\(true\);/);
});

// No reader shown a post-confirm card is ever sent back to register: for a
// declined reader the parked marker is gone and registering again only sends
// an account-exists email; every register-flow reader without a company gets
// the create form instead. (The bad-link card may say it: that reader may
// never have confirmed.)
test("no post-confirm copy tells a reader to register again", () => {
  const afterConfirm = page.split('phase.kind === "consent"')[1] ?? "";
  expect(afterConfirm.length).toBeGreaterThan(0);
  expect(afterConfirm).not.toMatch(/register (again|your (own )?company)/i);
});

const form = readFileSync(join(process.cwd(), "app/welcome/CreateCompanyForm.tsx"), "utf8");

// Every NAMED-register-link reader who reaches done without a company is
// offered the form: declined, skipped after a failed claim, out of date (22023).
test("the create form is gated on a named register link without a claimed company", () => {
  expect(page).toContain("const isNamedRegister = isRegisterFlow && pendingCompany !== null;");
  expect(page).toContain(
    "accessToken: isNamedRegister && !claimedCompany ? phase.accessToken : null,",
  );
  expect(page).toContain(
    "<CreateCompanyForm accessToken={phase.accessToken} onEnded={endCreateCompany} />",
  );
  expect(page).toContain("{phase.accessToken !== null ? (");
  // `kind: "done"` appears three times: the Phase type, the gated setPhase
  // above, and endCreateCompany's null-token setPhase. A fourth would be a new
  // way into done that bypasses the gate.
  expect(page.split('kind: "done"').length).toBe(4);
  expect(page).not.toContain("{declinedCompany ? <CreateCompanyForm");
});

// The token must not outlive the form. Every ended path — created, expired,
// notConfirmed, alreadyAffiliated, "Not now" — goes through onEnded, which
// nulls it; only invalidName, rateLimited and failed keep the form live.
test("every ended create-form path drops the token and closes the form", () => {
  expect(page).toMatch(
    /const endCreateCompany = \(message: string \| null\) => \{\s*setCreateEnded\(message\);\s*setPhase\(\{ kind: "done", accessToken: null \}\);/,
  );
  expect(form).toMatch(/if \(response\.ok\) \{\s*onEnded\(CREATE_COMPANY_DONE\);\s*return;/);
  expect(form).toMatch(
    /if \(endsCreateCompany\(outcome\)\) \{\s*onEnded\(CREATE_COMPANY_MESSAGES\[outcome\]\);\s*return;/,
  );
  // "Not now" closes the form without repeating the done card's sentence.
  expect(form).toContain("onClick={() => onEnded(null)}");
  expect(form).toContain("Not now");
  expect(page).toContain("const endCreateCompany = (message: string | null) => {");
});

// The form's errors stay inline: the page-level expired card would replace
// the success card with password-reset advice after the password is saved.
test("the create form never raises the page-level expired card", () => {
  expect(form).not.toContain("setExpired");
  expect(form).not.toContain("expired(");
  const doneCard = page.split('phase.kind === "done"')[1]?.split('phase.kind === "confirmed"')[0];
  expect(doneCard).toBeDefined();
  expect(doneCard).not.toContain("setExpired");
});

test("the create form reads only the error code and renders only plain copy", () => {
  expect(form).toContain("Run your own company? Set it up here.");
  expect(form).toContain("/rest/v1/rpc/create_own_company");
  expect(form).toContain("CREATE_COMPANY_MESSAGES[outcome]");
  expect(form).toContain(
    "classifyCreateCompanyFailure(response.status, await readErrorCode(response))",
  );
  expect(form).not.toMatch(/\.message\b|\.msg\b|\.text\(\)|innerHTML/);
});

test("the out-of-date claim copy promises no existing company", () => {
  expect(page).toContain(
    "This link is out of date, so there's nothing to set up from it. Skip this step and choose your password — you can set up your company after.",
  );
  expect(page).not.toContain("match the company on your account");
});

// A register link with no company name: the server refuses the zero-argument
// claim (pending_company_name_required), so the page must never send it.
test("a nameless register link sends no claim and only offers the password", () => {
  expect(page).not.toContain('expectedName === null ? "{}"');
  expect(page).not.toContain("expectedName === null");
  expect(page).not.toContain("claimPendingCompany(body.access_token, null)");
  expect(page).toContain(
    "const claimPendingCompany = async (accessToken: string, expectedName: string) => {",
  );
  expect(page).toMatch(
    /setPhase\(\{ kind: "noName", accessToken: body\.access_token \}\);\s*return;/,
  );
  expect(page).toContain("There&apos;s nothing to set up from this link");
  expect(page).toContain("Choose your password");
});

// 22023 is the mismatch only for a named claim; any other 400 is generic and
// keeps its Try again.
test("the name mismatch is keyed on the Postgres code, nowhere else", () => {
  expect(page).toMatch(
    /if \(isClaimNameMismatch\(response\.status, await readErrorCode\(response\)\)\) \{\s*setClaimStale\(true\);/,
  );
  expect(page.split("setClaimStale(true)").length).toBe(2);
  expect(page).not.toContain("response.status === 400");
});

test("the confirmed card makes no company claim", () => {
  const confirmed = page.split('phase.kind === "confirmed"')[1] ?? "";
  expect(confirmed).not.toContain("company is ready");
});

// The company name arrives in a URL fragment anyone can craft, so it may only
// ever be React text. An innerHTML escape hatch here would be a phishing hole
// under the real logo — the same guard hasHashError exists for.
test("the company name is rendered as text, never as markup", () => {
  expect(page).toContain("{phase.company}");
  expect(page).not.toContain("dangerouslySetInnerHTML");
});

// A nameless register link is a pending invitee's resend (worklog-register-
// company only omits the name for an unconfirmed account with no marker). They
// hold a project seat, so the server would refuse them a company: they never
// get the form, and get the invitee done copy.
test("nameless register-link readers never get the create form", () => {
  // The only token-bearing done state is behind isNamedRegister.
  expect(page).not.toMatch(/accessToken: isRegisterFlow &&/);
  expect(page).toMatch(/setPhase\(\{ kind: "noName", accessToken: body\.access_token \}\);/);
  // The done copy's founder branch is keyed on a named link, not the flag alone.
  expect(page).toContain('{isNamedRegister || linkType === "signup"');
  expect(page).not.toContain('{isRegisterFlow || linkType === "signup"');
});

test("the out-of-date claim card has its own heading", () => {
  expect(page).toContain(
    '<h1>{claimStale ? "This link is out of date" : "Setting up your company"}</h1>',
  );
});
