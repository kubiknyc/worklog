import { expect, test } from "vitest";

import {
  classifyCreateCompanyFailure,
  cleanCompanyName,
  COMPANY_NAME_MAX,
  CREATE_COMPANY_DECLINED,
  CREATE_COMPANY_DONE,
  CREATE_COMPANY_MESSAGES,
  endsCreateCompany,
  readErrorCode,
  type CreateCompanyOutcome,
} from "./createOwnCompany";

const ch = (codePoint: number) => String.fromCodePoint(codePoint);

test("a gone session is expired, by HTTP status or by code", () => {
  expect(classifyCreateCompanyFailure(401, null)).toBe("expired");
  expect(classifyCreateCompanyFailure(403, null)).toBe("expired");
  expect(classifyCreateCompanyFailure(400, "42501")).toBe("expired");
});

test("each server refusal code gets its own outcome", () => {
  expect(classifyCreateCompanyFailure(400, "PL001")).toBe("notConfirmed");
  expect(classifyCreateCompanyFailure(400, "PL002")).toBe("alreadyAffiliated");
  expect(classifyCreateCompanyFailure(400, "PL003")).toBe("invalidName");
});

test("rate limiting is its own outcome", () => {
  expect(classifyCreateCompanyFailure(429, null)).toBe("rateLimited");
});

test("anything else is a generic failure, including a missing function", () => {
  expect(classifyCreateCompanyFailure(404, "PGRST202")).toBe("failed");
  expect(classifyCreateCompanyFailure(500, null)).toBe("failed");
  // 22023 is the named claim's mismatch, not anything this RPC raises.
  expect(classifyCreateCompanyFailure(400, "22023")).toBe("failed");
  expect(classifyCreateCompanyFailure(400, null)).toBe("failed");
});

test("only outcomes a retry cannot fix end the form", () => {
  const ending: CreateCompanyOutcome[] = ["expired", "notConfirmed", "alreadyAffiliated"];
  const live: CreateCompanyOutcome[] = ["invalidName", "rateLimited", "failed"];
  for (const outcome of ending) expect(endsCreateCompany(outcome)).toBe(true);
  for (const outcome of live) expect(endsCreateCompany(outcome)).toBe(false);
});

test("every outcome has plain copy that names no internal code", () => {
  const all = [...Object.values(CREATE_COMPANY_MESSAGES), CREATE_COMPANY_DONE, CREATE_COMPANY_DECLINED];
  for (const message of all) {
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toMatch(/PL00\d|42501|create_own_company|PunchLog/);
  }
});

test("the expired copy does not promise the app can finish the company", () => {
  expect(CREATE_COMPANY_MESSAGES.expired).toBe(
    "This page timed out before your company was set up. Open the WorkLog app and sign in.",
  );
});

test("names are trimmed like the server trims: JS whitespace plus U+200B", () => {
  expect(cleanCompanyName("  Acme Builders  ")).toBe("Acme Builders");
  const edges = [0x00a0, 0x1680, 0x2000, 0x200a, 0x200b, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff];
  for (const cp of edges) {
    expect(cleanCompanyName(`${ch(cp)}Acme${ch(cp)}`)).toBe("Acme");
  }
  expect(cleanCompanyName("   ")).toBeNull();
  expect(cleanCompanyName(`${ch(0x200b)}${ch(0x00a0)}`)).toBeNull();
  expect(cleanCompanyName("")).toBeNull();
});

test("length counts characters, not UTF-16 units: 120 emoji fit, 121 do not", () => {
  const emoji = ch(0x1f3d7); // one code point, two UTF-16 units
  expect(cleanCompanyName(emoji.repeat(COMPANY_NAME_MAX))).toBe(emoji.repeat(COMPANY_NAME_MAX));
  expect(cleanCompanyName(emoji.repeat(COMPANY_NAME_MAX + 1))).toBeNull();
  expect(cleanCompanyName("x".repeat(COMPANY_NAME_MAX))).toHaveLength(COMPANY_NAME_MAX);
  expect(cleanCompanyName("x".repeat(COMPANY_NAME_MAX + 1))).toBeNull();
});

test("control, zero-width, bidi and separator characters are refused inside a name", () => {
  const refused = [
    0x0000, 0x0009, 0x000a, 0x001f, 0x007f, 0x0085, 0x009f, 0x200b, 0x200c, 0x200d, 0x200e,
    0x200f, 0x2060, 0xfeff, 0x202a, 0x202e, 0x2066, 0x2069, 0x061c, 0x2028, 0x2029,
  ];
  for (const cp of refused) {
    expect(cleanCompanyName(`Ac${ch(cp)}me`)).toBeNull();
  }
});

test("ordinary letters, digits, punctuation and accents pass", () => {
  expect(cleanCompanyName("O'Brien & Sons, Béton-Armé Co. #2")).toBe(
    "O'Brien & Sons, Béton-Armé Co. #2",
  );
});

test("only the code is read from an error body, never the message", async () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 400 });
  expect(await readErrorCode(json({ code: "PL002", message: "already_affiliated" }))).toBe(
    "PL002",
  );
  expect(await readErrorCode(json({ message: "no code here" }))).toBeNull();
  expect(await readErrorCode(json({ code: 42 }))).toBeNull();
  expect(await readErrorCode(json(null))).toBeNull();
  expect(await readErrorCode(new Response("<html>bad gateway</html>", { status: 502 }))).toBeNull();
});
