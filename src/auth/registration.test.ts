/**
 * registerCompany — seam behavior around the register-company edge function:
 * the client field, and mapping the {error, field} error contract (carried on
 * FunctionsHttpError.context) into the typed result.
 */
import { registerCompany } from './registration';

const mockInvoke = jest.fn();

// The factory only dereferences mockInvoke when invoke() is called (inside a
// test), so the hoisted mock is safe despite the declaration order.
jest.mock('../supabase/client', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

// Invite-style registration: no password in the contract.
const REQUEST = {
  companyName: 'Keystone Build Group',
  fullName: 'Sam Keystone',
  email: 'sam@example.com',
} as const;

const errorWith = (response: unknown) => ({ data: null, error: { context: response } });

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status });

beforeEach(() => mockInvoke.mockReset());

it("sends the request with client 'app' on native builds", async () => {
  mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
  await registerCompany(REQUEST);
  expect(mockInvoke).toHaveBeenCalledWith('register-company', {
    body: { ...REQUEST, client: 'app' },
  });
});

// Regression guard for the registration-takeover fix: the client must never
// send a password. A password reaching the server would be ignored today, but
// its presence in the request means a UI is still collecting one.
it('never sends a password field', async () => {
  mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
  await registerCompany(REQUEST);
  const [, options] = mockInvoke.mock.calls[0] as [string, { body: Record<string, unknown> }];
  expect(options.body).not.toHaveProperty('password');
  expect(options.body).not.toHaveProperty('confirmPassword');
});

it('maps a 200 to ok', async () => {
  mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });
  expect(await registerCompany(REQUEST)).toEqual({ kind: 'ok' });
});

it('maps a 400 body to invalid with the server message and field', async () => {
  mockInvoke.mockResolvedValue(
    errorWith(jsonResponse({ error: 'a valid email is required', field: 'email' }, 400)),
  );
  expect(await registerCompany(REQUEST)).toEqual({
    kind: 'invalid',
    message: 'a valid email is required',
    field: 'email',
  });
});

it('replaces a field-less 400 message with plain-language copy', async () => {
  // An unknown field means the server message wasn't written for this form —
  // never surface internal wording like "client must be 'app' or 'web'".
  mockInvoke.mockResolvedValue(
    errorWith(jsonResponse({ error: "client must be 'app' or 'web'", field: 'client' }, 400)),
  );
  expect(await registerCompany(REQUEST)).toEqual({
    kind: 'invalid',
    message: 'Check your details and try again.',
  });
});

it('falls back to generic invalid copy when the 400 body is unparseable', async () => {
  mockInvoke.mockResolvedValue(errorWith(new Response('not json', { status: 400 })));
  expect(await registerCompany(REQUEST)).toEqual({
    kind: 'invalid',
    message: 'Check your details and try again.',
    field: undefined,
  });
});

it('maps a 429 to rateLimited', async () => {
  mockInvoke.mockResolvedValue(errorWith(jsonResponse({ error: 'too many attempts' }, 429)));
  expect(await registerCompany(REQUEST)).toEqual({ kind: 'rateLimited' });
});

it('maps server failures (5xx/503) to failed', async () => {
  mockInvoke.mockResolvedValue(
    errorWith(jsonResponse({ error: 'registration is temporarily unavailable' }, 503)),
  );
  expect(await registerCompany(REQUEST)).toEqual({ kind: 'failed' });
});

it('maps an error without a Response context (network failure) to failed', async () => {
  mockInvoke.mockResolvedValue({ data: null, error: { name: 'FunctionsFetchError' } });
  expect(await registerCompany(REQUEST)).toEqual({ kind: 'failed' });
});
