// Ported verbatim from PunchLog's website (PLW/lib/passwordStrength.test.ts) —
// zxcvbn strength tests with no product-name references to rebrand.
import { expect, test } from "vitest";

import {
  checkPasswordStrength,
  MIN_PASSWORD_LENGTH,
  MIN_PASSWORD_SCORE,
} from "./passwordStrength";

// /welcome is the ONLY place a web registrant chooses a credential under
// invite-style registration — if this floor is wrong there is no second gate.

test("treats an empty password as unacceptable with no label", async () => {
  const result = await checkPasswordStrength("");
  expect(result.isAcceptable).toBe(false);
  expect(result.label).toBe("");
  expect(result.suggestion).toBeNull();
});

test("rejects a password below the length floor even when it scores well", async () => {
  expect((await checkPasswordStrength("q7#Zx")).isAcceptable).toBe(false);
});

test("rejects trivially guessable passwords at or above the length floor", async () => {
  for (const weak of ["password", "12345678", "qwertyui", "aaaaaaaa"]) {
    const result = await checkPasswordStrength(weak);
    expect(result.isAcceptable).toBe(false);
    expect(result.score).toBeLessThan(MIN_PASSWORD_SCORE);
  }
});

test("accepts a strong passphrase", async () => {
  const result = await checkPasswordStrength("correct-horse-battery-staple-42");
  expect(result.isAcceptable).toBe(true);
  expect(result.score).toBeGreaterThanOrEqual(MIN_PASSWORD_SCORE);
  expect(result.suggestion).toBeNull();
});

test("offers a suggestion only while the password is unacceptable", async () => {
  expect((await checkPasswordStrength("password")).suggestion).toBeTruthy();
  expect((await checkPasswordStrength("correct-horse-battery-staple-42")).suggestion).toBeNull();
});

// The two mirrors must not drift: the app enforces the same floors in
// src/auth/passwordStrength.ts.
test("keeps the floors in sync with the app's mirror", () => {
  expect(MIN_PASSWORD_LENGTH).toBe(8);
  expect(MIN_PASSWORD_SCORE).toBe(2);
});
