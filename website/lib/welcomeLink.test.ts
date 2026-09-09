// Ported verbatim from PunchLog's website (PLW/lib/welcomeLink.test.ts) — pure
// URL-fragment parsing tests with no product-name references to rebrand.
import { expect, test } from "vitest";

import {
  classifySaveFailure,
  hasHashError,
  readAccessToken,
  readLinkType,
  readRegisterFlow,
  readTokenHash,
  readVerifyType,
} from "./welcomeLink";

// /welcome is the only web path to a credential — a web registrant may never
// install the app.

test("reads the access token from a confirm-link fragment", () => {
  expect(readAccessToken("#access_token=at123&refresh_token=rt456&type=signup")).toBe("at123");
});

test("tolerates a fragment with no leading hash", () => {
  expect(readAccessToken("access_token=at123")).toBe("at123");
});

test("returns null when there is no token to spend", () => {
  expect(readAccessToken("")).toBeNull();
  expect(readAccessToken("#")).toBeNull();
  expect(readAccessToken("#error_description=expired")).toBeNull();
  expect(readAccessToken("#access_token=")).toBeNull();
});

test("detects a GoTrue error fragment", () => {
  expect(hasHashError("#error_description=Token+has+expired")).toBe(true);
  expect(hasHashError("#access_token=at123")).toBe(false);
  expect(hasHashError("")).toBe(false);
});

// `error` without `error_description` used to render the "You're confirmed"
// success card. The native mirror (src/auth/authLink.ts) checks both keys;
// this one must not be weaker.
test("detects an error fragment carrying no description", () => {
  expect(hasHashError("#error=access_denied")).toBe(true);
  expect(hasHashError("#error=access_denied&error_code=otp_expired")).toBe(true);
});

// /welcome now serves three audiences. Only a company signup may be told "your
// company is ready" — an invited subcontractor has no company of their own and
// cannot create projects, so that copy reads as somebody else's account.
test("reads the link type GoTrue puts in the fragment", () => {
  expect(readLinkType("#access_token=at123&type=invite")).toBe("invite");
  expect(readLinkType("#access_token=at123&type=recovery")).toBe("recovery");
  expect(readLinkType("#access_token=at123&type=signup")).toBe("signup");
});

// The neutral branch is the DEFAULT, not an enumerated case. An existing-user
// invite arrives as type=magiclink, which is not in the union — collapsing it
// to 'other' is what makes that path render correct copy without naming it.
test("collapses anything unrecognised to other", () => {
  expect(readLinkType("#access_token=at123&type=magiclink")).toBe("other");
  expect(readLinkType("#access_token=at123")).toBe("other");
  expect(readLinkType("")).toBe("other");
  expect(readLinkType("#")).toBe("other");
});

test("tolerates a fragment with no leading hash, like readAccessToken", () => {
  expect(readLinkType("access_token=at123&type=invite")).toBe("invite");
});

// Phishing guard: the page must never render error_description, which anyone
// can craft. Only the boolean crosses the boundary.
test("hasHashError yields a boolean, never attacker-controlled text", () => {
  const result = hasHashError("#error_description=<img src=x onerror=alert(1)>");
  expect(typeof result).toBe("boolean");
});

// New confirm-link shape: mail scanners GET every link, so GoTrue now emails
// a fragment token_hash instead of a query-string token — spent only on tap.
test("reads the token_hash from a confirm-link fragment", () => {
  expect(readTokenHash("#token_hash=abc123&type=signup")).toBe("abc123");
});

test("url-decodes the token_hash", () => {
  expect(readTokenHash("#token_hash=abc%2Bdef&type=signup")).toBe("abc+def");
});

test("returns null when there is no token_hash to spend", () => {
  expect(readTokenHash("")).toBeNull();
  expect(readTokenHash("#")).toBeNull();
  expect(readTokenHash("#type=signup")).toBeNull();
  expect(readTokenHash("#token_hash=")).toBeNull();
});

test("reads each verify type GoTrue's token_hash flow can send", () => {
  expect(readVerifyType("#token_hash=abc&type=signup")).toBe("signup");
  expect(readVerifyType("#token_hash=abc&type=invite")).toBe("invite");
  expect(readVerifyType("#token_hash=abc&type=magiclink")).toBe("magiclink");
  expect(readVerifyType("#token_hash=abc&type=recovery")).toBe("recovery");
  expect(readVerifyType("#token_hash=abc&type=email")).toBe("email");
});

test("readVerifyType collapses anything unrecognised to null", () => {
  expect(readVerifyType("#token_hash=abc&type=email_change")).toBeNull();
  expect(readVerifyType("#token_hash=abc")).toBeNull();
  expect(readVerifyType("")).toBeNull();
  expect(readVerifyType("#")).toBeNull();
});

test("401 and 403 mean the one-shot link is spent", () => {
  expect(classifySaveFailure(401)).toEqual({ kind: "expired" });
  expect(classifySaveFailure(403)).toEqual({ kind: "expired" });
});

test("422 surfaces the server's reason for refusing the password", () => {
  expect(classifySaveFailure(422, "Password is too weak")).toEqual({
    kind: "rejected",
    message: "Password is too weak",
  });
  expect(classifySaveFailure(422)).toEqual({ kind: "rejected", message: null });
});

test("429 is rate limiting, not an expired link", () => {
  expect(classifySaveFailure(429)).toEqual({ kind: "rateLimited" });
});

test("5xx is a retryable failure, not an expired link", () => {
  expect(classifySaveFailure(500)).toEqual({ kind: "failed" });
  expect(classifySaveFailure(503)).toEqual({ kind: "failed" });
});

// The regression that sent users with a rejected password or a transient
// outage to "your link expired — start over".
test("only genuine auth failures are ever classified as expired", () => {
  for (const status of [400, 422, 429, 500, 502, 503]) {
    expect(classifySaveFailure(status).kind).not.toBe("expired");
  }
});

// Register confirm links are tagged `&flow=register` by the register edge
// function; that tag is the only thing telling this page a company is waiting
// to be claimed. An invite or a password reset must never trigger the claim,
// so the match is exact rather than "the key is present".
test("reads the register flow tag from a confirm-link fragment", () => {
  expect(readRegisterFlow("#token_hash=abc&type=signup&flow=register")).toBe(true);
});

test("an untagged link is not a register link", () => {
  expect(readRegisterFlow("#token_hash=abc&type=invite")).toBe(false);
  expect(readRegisterFlow("#token_hash=abc&type=recovery")).toBe(false);
});

test("any other flow value is not a register link", () => {
  expect(readRegisterFlow("#token_hash=abc&type=signup&flow=invite")).toBe(false);
  expect(readRegisterFlow("#token_hash=abc&type=signup&flow=")).toBe(false);
  expect(readRegisterFlow("#token_hash=abc&type=signup&flow=REGISTER")).toBe(false);
});

test("an empty fragment is not a register link", () => {
  expect(readRegisterFlow("")).toBe(false);
  expect(readRegisterFlow("#")).toBe(false);
});

test("readRegisterFlow tolerates a fragment with no leading hash", () => {
  expect(readRegisterFlow("token_hash=abc&type=signup&flow=register")).toBe(true);
});
