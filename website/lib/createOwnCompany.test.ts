import { expect, test } from "vitest";

import {
  classifyCreateCompanyFailure,
  cleanCompanyName,
  COMPANY_NAME_MAX,
  CREATE_COMPANY_MESSAGES,
  readErrorCode,
} from "./createOwnCompany";

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

test("every outcome has plain copy that names no internal code", () => {
  for (const message of Object.values(CREATE_COMPANY_MESSAGES)) {
    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toMatch(/PL00\d|42501|create_own_company|PunchLog/);
  }
});

test("names are trimmed and held to the server's 1..120 rule", () => {
  expect(cleanCompanyName("  Acme Builders  ")).toBe("Acme Builders");
  expect(cleanCompanyName("   ")).toBeNull();
  expect(cleanCompanyName("")).toBeNull();
  expect(cleanCompanyName("x".repeat(COMPANY_NAME_MAX))).toHaveLength(COMPANY_NAME_MAX);
  expect(cleanCompanyName("x".repeat(COMPANY_NAME_MAX + 1))).toBeNull();
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
