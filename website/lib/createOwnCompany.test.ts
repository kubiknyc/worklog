import { expect, test } from "vitest";

import {
  classifyCreateCompanyFailure,
  cleanCompanyName,
  COMPANY_NAME_MAX,
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
  const all = [...Object.values(CREATE_COMPANY_MESSAGES), CREATE_COMPANY_DONE];
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

test("every character in the server refuse class is refused anywhere in a name", () => {
  // U+180B-180D (Mongolian free variation selectors) and U+200C/U+200D
  // (ZWNJ/ZWJ) moved OUT of REFUSE_ANYWHERE in v3 — they're allowed inside a
  // real name now (a ligature or a ZWJ emoji sequence needs one), and only
  // refused when they're the entire name (BLANK_ONLY_EXTRA, tested below).
  const refused = [
    0x0000, 0x0009, 0x000a, 0x001f, 0x007f, 0x0085, 0x009f, 0x00ad, 0x034f, 0x061c, 0x115f,
    0x1160, 0x17b4, 0x17b5, 0x180e, 0x180f, 0x200b, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a,
    0x202e, 0x2060, 0x2064, 0x2066, 0x2069, 0x206f, 0x3164, 0xfeff, 0xffa0, 0xfff0, 0xfff8,
  ];
  for (const cp of refused) {
    expect(cleanCompanyName(`Ac${ch(cp)}me`)).toBeNull();
  }
  // Two new supplementary-plane format-control ranges.
  expect(cleanCompanyName(`Ac${ch(0x1bca0)}me`)).toBeNull();
  expect(cleanCompanyName(`Ac${ch(0x1bca3)}me`)).toBeNull();
  expect(cleanCompanyName(`Ac${ch(0x1d173)}me`)).toBeNull();
  expect(cleanCompanyName(`Ac${ch(0x1d17a)}me`)).toBeNull();
});

test("a name made only of invisible characters is refused, after trimming", () => {
  expect(cleanCompanyName(ch(0x2800))).toBeNull();
  expect(cleanCompanyName(`${ch(0xfe0f)}${ch(0xfe00)}`)).toBeNull();
  expect(cleanCompanyName(` ${ch(0x2800)} ${ch(0x2800)} `)).toBeNull();
  // Mixed whole-name: Braille blank plus a variation selector, still nothing
  // but BLANK_ONLY_EXTRA characters.
  expect(cleanCompanyName(`${ch(0x2800)}${ch(0xfe0f)}`)).toBeNull();
  // New in v3: ZWJ alone, a Mongolian free variation selector alone, and a
  // tag character alone (the E0000-E0FFF block) are each the whole name.
  expect(cleanCompanyName(ch(0x200d))).toBeNull();
  expect(cleanCompanyName(ch(0x180b))).toBeNull();
  expect(cleanCompanyName(ch(0xe0020))).toBeNull();
  expect(cleanCompanyName(ch(0xe0100))).toBeNull();
});

test("a variation selector inside a real name is allowed", () => {
  const coffee = `${ch(0x2615)}${ch(0xfe0f)}`;
  expect(cleanCompanyName(`${coffee} Cafe Builders`)).toBe(`${coffee} Cafe Builders`);
});

test("accented and CJK names pass unchanged", () => {
  expect(cleanCompanyName("Café Ñandú")).toBe("Café Ñandú");
  expect(cleanCompanyName("株式会社")).toBe("株式会社");
});

test("a ZWJ emoji sequence inside a name is allowed, not just a bare variation selector", () => {
  // U+1F477 (construction worker) U+200D (ZWJ) U+2640 (female sign) U+FE0F
  const zwjEmoji = `${ch(0x1f477)}${ch(0x200d)}${ch(0x2640)}${ch(0xfe0f)}`;
  expect(cleanCompanyName(`Acme ${zwjEmoji}`)).toBe(`Acme ${zwjEmoji}`);
});

test("a ZWNJ inside a real (non-Latin) name is allowed", () => {
  // Persian "می‌خواهم" — contains U+200C (ZWNJ) joining two word parts.
  const name = `می${ch(0x200c)}خواهم`;
  expect(cleanCompanyName(name)).toBe(name);
});

test("an England flag tag-character subdivision sequence inside a name is allowed", () => {
  // U+1F3F4 (black flag) + U+E0067 U+E0062 U+E0065 U+E006E U+E0067 (gbeng) + U+E007F (cancel tag)
  const flag = [0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f].map(ch).join("");
  expect(cleanCompanyName(`${flag} Builders`)).toBe(`${flag} Builders`);
});

test("a lone surrogate is refused, a proper pair is not", () => {
  expect(cleanCompanyName(`Acme${String.fromCharCode(0xd83c)}`)).toBeNull();
  expect(cleanCompanyName(`${String.fromCharCode(0xdfd7)}Acme`)).toBeNull();
  expect(cleanCompanyName(`Ac${String.fromCharCode(0xdfd7)}me`)).toBeNull();
  expect(cleanCompanyName(`Acme ${ch(0x1f3d7)}`)).toBe(`Acme ${ch(0x1f3d7)}`);
});

test("the plain copy says what to do next", () => {
  expect(CREATE_COMPANY_MESSAGES.invalidName).toBe(
    "Enter a company name of up to 120 characters, with no hidden or special characters.",
  );
  expect(CREATE_COMPANY_MESSAGES.notConfirmed).toContain("Open the WorkLog app and sign in.");
  expect(CREATE_COMPANY_MESSAGES.notConfirmed).not.toMatch(/sign-up email/);
  expect(CREATE_COMPANY_MESSAGES.alreadyAffiliated).toContain(
    "ask that company's administrator to add you to a project",
  );
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
