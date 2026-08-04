/**
 * `inviteMember` was at 0% (#24) — a real online-only write path carrying a lot
 * of judgement: which server messages are safe to show a user, which are
 * internal codes that must be replaced, and when a 2xx should still be reported
 * as a failure. None of that was pinned, so any of it could be deleted without
 * a test noticing.
 *
 * The `inviteUrl` handling matters most: it is a magic link, returned only for
 * a NEW account on an instance with no mailer. The tests below pin that it is
 * passed through verbatim when present and `null` otherwise — never invented,
 * never defaulted to a string.
 */
import { inviteMember } from './inviteMember';

type InvokeResult = { data: unknown; error: unknown };

const mockInvoke = jest.fn((..._args: unknown[]): Promise<InvokeResult> =>
  Promise.resolve({ data: { ok: true }, error: null }),
);

jest.mock('../supabase/client', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mockInvoke(...args) } },
}));

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const GENERIC = "Couldn't send the invite. Please check your connection and try again.";

/** A FunctionsHttpError-shaped failure: the raw Response hangs off `context`. */
function httpError(body: unknown): { context: Response } {
  return { context: new Response(JSON.stringify(body), { status: 400 }) };
}

beforeEach(() => {
  mockInvoke.mockClear();
  mockInvoke.mockImplementation(() => Promise.resolve({ data: { ok: true }, error: null }));
});

/** Body of the single `functions.invoke` call. */
function sentBody(): Record<string, unknown> {
  return (mockInvoke.mock.calls[0]?.[1] as { body: Record<string, unknown> }).body;
}

describe('inviteMember request shape', () => {
  it('trims the email and always tags the app', async () => {
    await inviteMember({ email: '  Sam@example.test  ', projectId: PROJECT_ID, role: 'sub' });

    expect(mockInvoke).toHaveBeenCalledWith('invite-user', expect.anything());
    expect(sentBody()).toEqual({
      email: 'Sam@example.test',
      projectId: PROJECT_ID,
      role: 'sub',
      // Pending backend change: without this the invite deep-links into
      // PunchLog. Dropping it is silent — the function ignores unknown fields.
      app: 'worklog',
    });
  });

  it('omits fullName and trade entirely when blank rather than sending empty strings', async () => {
    await inviteMember({
      email: 'sam@example.test',
      projectId: PROJECT_ID,
      role: 'super',
      fullName: '   ',
      trade: '',
    });

    // The server validates presence, not emptiness — an empty string would be
    // stored as the person's name.
    expect(sentBody()).not.toHaveProperty('fullName');
    expect(sentBody()).not.toHaveProperty('trade');
  });

  it('sends fullName and trade trimmed when supplied', async () => {
    await inviteMember({
      email: 'sam@example.test',
      projectId: PROJECT_ID,
      role: 'sub',
      fullName: '  Sam Sub  ',
      trade: '  Electrical  ',
    });

    expect(sentBody().fullName).toBe('Sam Sub');
    expect(sentBody().trade).toBe('Electrical');
  });
});

describe('inviteMember success', () => {
  it('reports emailSent and existingUser as booleans', async () => {
    mockInvoke.mockImplementation(() =>
      Promise.resolve({ data: { ok: true, emailSent: true, existingUser: true }, error: null }),
    );

    await expect(
      inviteMember({ email: 'sam@example.test', projectId: PROJECT_ID, role: 'sub' }),
    ).resolves.toEqual({ ok: true, emailSent: true, existingUser: true, inviteUrl: null });
  });

  it('treats missing flags as false rather than undefined', async () => {
    mockInvoke.mockImplementation(() => Promise.resolve({ data: { ok: true }, error: null }));

    // `emailSent: undefined` would render as a blank in the "invite sent" copy;
    // the caller is entitled to a real boolean.
    await expect(
      inviteMember({ email: 'sam@example.test', projectId: PROJECT_ID, role: 'sub' }),
    ).resolves.toEqual({ ok: true, emailSent: false, existingUser: false, inviteUrl: null });
  });

  it('passes a manual-share inviteUrl through verbatim', async () => {
    mockInvoke.mockImplementation(() =>
      Promise.resolve({
        data: {
          ok: true,
          emailSent: false,
          existingUser: false,
          inviteUrl: 'https://x.test/i/abc',
        },
        error: null,
      }),
    );

    await expect(
      inviteMember({ email: 'sam@example.test', projectId: PROJECT_ID, role: 'sub' }),
    ).resolves.toEqual({
      ok: true,
      emailSent: false,
      existingUser: false,
      inviteUrl: 'https://x.test/i/abc',
    });
  });

  it('nulls a non-string inviteUrl instead of leaking it into the copy affordance', async () => {
    mockInvoke.mockImplementation(() =>
      Promise.resolve({ data: { ok: true, inviteUrl: 42 }, error: null }),
    );

    await expect(
      inviteMember({ email: 'sam@example.test', projectId: PROJECT_ID, role: 'sub' }),
    ).resolves.toEqual({ ok: true, emailSent: false, existingUser: false, inviteUrl: null });
  });
});

describe('inviteMember failure', () => {
  it('treats a 2xx whose body is not ok:true as a failure', async () => {
    mockInvoke.mockImplementation(() =>
      Promise.resolve({ data: { emailSent: true }, error: null }),
    );

    // Contract drift must not be reported as a send that may never have
    // happened — the user would stop waiting for an invite that never arrives.
    await expect(
      inviteMember({ email: 'sam@example.test', projectId: PROJECT_ID, role: 'sub' }),
    ).resolves.toEqual({ ok: false, message: GENERIC });
  });

  it('treats a null body as a failure', async () => {
    mockInvoke.mockImplementation(() => Promise.resolve({ data: null, error: null }));

    await expect(
      inviteMember({ email: 'sam@example.test', projectId: PROJECT_ID, role: 'sub' }),
    ).resolves.toEqual({ ok: false, message: GENERIC });
  });

  it('surfaces a plain-language server message from the `error` key', async () => {
    mockInvoke.mockImplementation(() =>
      Promise.resolve({
        data: null,
        error: httpError({ error: 'That address is already on this project.' }),
      }),
    );

    await expect(
      inviteMember({ email: 'sam@example.test', projectId: PROJECT_ID, role: 'sub' }),
    ).resolves.toEqual({ ok: false, message: 'That address is already on this project.' });
  });

  it('accepts `message` as well as `error`, so a body-key rename keeps working', async () => {
    mockInvoke.mockImplementation(() =>
      Promise.resolve({ data: null, error: httpError({ message: 'Project not found.' }) }),
    );

    await expect(
      inviteMember({ email: 'sam@example.test', projectId: PROJECT_ID, role: 'sub' }),
    ).resolves.toEqual({ ok: false, message: 'Project not found.' });
  });

  it.each([['unauthorized'], ['invite failed'], ['invalid JSON body']])(
    'replaces the internal code %p with the generic line',
    async (code) => {
      mockInvoke.mockImplementation(() =>
        Promise.resolve({ data: null, error: httpError({ error: code }) }),
      );

      // These are internal codes, not copy. Showing them verbatim tells a
      // superintendent nothing and leaks how the function fails.
      await expect(
        inviteMember({ email: 'sam@example.test', projectId: PROJECT_ID, role: 'sub' }),
      ).resolves.toEqual({ ok: false, message: GENERIC });
    },
  );

  it('falls back to the generic line for an empty server message', async () => {
    mockInvoke.mockImplementation(() =>
      Promise.resolve({ data: null, error: httpError({ error: '' }) }),
    );

    await expect(
      inviteMember({ email: 'sam@example.test', projectId: PROJECT_ID, role: 'sub' }),
    ).resolves.toEqual({ ok: false, message: GENERIC });
  });

  it('falls back to the generic line for a non-string server message', async () => {
    mockInvoke.mockImplementation(() =>
      Promise.resolve({ data: null, error: httpError({ error: { nested: true } }) }),
    );

    await expect(
      inviteMember({ email: 'sam@example.test', projectId: PROJECT_ID, role: 'sub' }),
    ).resolves.toEqual({ ok: false, message: GENERIC });
  });

  it('falls back to the generic line when the error carries no Response context', async () => {
    // A transport failure never reaches the function, so there is no body to
    // read — the network error itself must not become user-facing copy.
    mockInvoke.mockImplementation(() =>
      Promise.resolve({ data: null, error: new Error('Network request failed') }),
    );

    await expect(
      inviteMember({ email: 'sam@example.test', projectId: PROJECT_ID, role: 'sub' }),
    ).resolves.toEqual({ ok: false, message: GENERIC });
  });

  it('falls back to the generic line when the error body is not JSON', async () => {
    mockInvoke.mockImplementation(() =>
      Promise.resolve({
        data: null,
        error: { context: new Response('<html>502 Bad Gateway</html>', { status: 502 }) },
      }),
    );

    // A proxy HTML error page must not be rendered into a toast.
    await expect(
      inviteMember({ email: 'sam@example.test', projectId: PROJECT_ID, role: 'sub' }),
    ).resolves.toEqual({ ok: false, message: GENERIC });
  });
});
