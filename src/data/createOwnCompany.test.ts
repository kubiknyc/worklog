import {
  cleanCompanyName,
  COMPANY_NAME_MAX,
  CREATE_COMPANY_COPY,
  createCompanyFailure,
  createOwnCompany,
} from './createOwnCompany';

type RpcResult = {
  error: { message: string; code?: string; name?: string } | null;
  status: number;
};

const mockRpc = jest.fn((..._args: unknown[]): Promise<RpcResult> =>
  Promise.resolve({ error: null, status: 200 }),
);

jest.mock('../supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args) },
}));

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  mockRpc.mockClear();
  mockRpc.mockImplementation(() => Promise.resolve({ error: null, status: 200 }));
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => warnSpy.mockRestore());

const failed = (message: string) => ({ kind: 'failed', message });

describe('createOwnCompany', () => {
  it('sends the trimmed name and reports a created company', async () => {
    await expect(createOwnCompany('  Acme Builders  ')).resolves.toEqual({ kind: 'created' });
    expect(mockRpc).toHaveBeenCalledWith('create_own_company', { company_name: 'Acme Builders' });
  });

  it('refuses a name the server would refuse before touching the network', async () => {
    for (const name of ['   ', 'x'.repeat(COMPANY_NAME_MAX + 1), 'Acme\u202EBuild']) {
      await expect(createOwnCompany(name)).resolves.toEqual(
        failed(CREATE_COMPANY_COPY.invalidName),
      );
    }
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('returns PL002 as its own kind so the caller can re-check affiliation', async () => {
    mockRpc.mockResolvedValueOnce({
      error: { code: 'PL002', message: 'already_affiliated' },
      status: 400,
    });
    await expect(createOwnCompany('Acme')).resolves.toEqual({
      kind: 'alreadyAffiliated',
      message: CREATE_COMPANY_COPY.alreadyAffiliated,
    });
  });

  it('logs only the error code, never the server message', async () => {
    mockRpc.mockResolvedValueOnce({
      error: { code: 'PL003', message: 'invalid_company_name: Acme secret' },
      status: 400,
    });
    await createOwnCompany('Acme');
    expect(warnSpy).toHaveBeenCalledWith(expect.any(String), 'PL003');
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('secret');
  });

  it('turns a thrown transport failure into offline copy, logging only its name', async () => {
    mockRpc.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(createOwnCompany('Acme')).resolves.toEqual(failed(CREATE_COMPANY_COPY.offline));
    expect(warnSpy).toHaveBeenCalledWith(expect.any(String), 'TypeError');
  });

  it('turns any other throw into generic copy', async () => {
    mockRpc.mockRejectedValueOnce(new Error('boom'));
    await expect(createOwnCompany('Acme')).resolves.toEqual(failed(CREATE_COMPANY_COPY.failed));
  });
});

describe('createCompanyFailure', () => {
  it('reads an expired session from the status or the code', () => {
    expect(createCompanyFailure({}, 401)).toEqual(failed(CREATE_COMPANY_COPY.expired));
    expect(createCompanyFailure({}, 403)).toEqual(failed(CREATE_COMPANY_COPY.expired));
    expect(createCompanyFailure({ code: '42501' }, 400)).toEqual(
      failed(CREATE_COMPANY_COPY.expired),
    );
  });

  it('maps 429 to rate-limited copy', () => {
    expect(createCompanyFailure({}, 429)).toEqual(failed(CREATE_COMPANY_COPY.rateLimited));
  });

  it('gives each refusal code its own copy', () => {
    expect(createCompanyFailure({ code: 'PL001' }, 400)).toEqual(
      failed(CREATE_COMPANY_COPY.notConfirmed),
    );
    expect(createCompanyFailure({ code: 'PL002' }, 400)).toEqual({
      kind: 'alreadyAffiliated',
      message: CREATE_COMPANY_COPY.alreadyAffiliated,
    });
    expect(createCompanyFailure({ code: 'PL003' }, 400)).toEqual(
      failed(CREATE_COMPANY_COPY.invalidName),
    );
  });

  it('falls back to generic copy, or offline copy for a transport failure', () => {
    expect(createCompanyFailure({ code: 'PGRST202' }, 404)).toEqual(
      failed(CREATE_COMPANY_COPY.failed),
    );
    expect(createCompanyFailure({ code: '22023' }, 400)).toEqual(
      failed(CREATE_COMPANY_COPY.failed),
    );
    const transport = { name: 'TypeError', message: 'Failed to fetch' } as { code?: string };
    expect(createCompanyFailure(transport, 0)).toEqual(failed(CREATE_COMPANY_COPY.offline));
  });
});

describe('cleanCompanyName (mirrors the server NAME RULE)', () => {
  it('trims JS whitespace plus U+200B from both ends', () => {
    expect(cleanCompanyName('\u00A0\u3000Acme\uFEFF\u200B ')).toBe('Acme');
    expect(cleanCompanyName('\u2028Acme\u2029')).toBe('Acme');
  });

  it('refuses an empty or whitespace-only name', () => {
    expect(cleanCompanyName('')).toBeNull();
    expect(cleanCompanyName(' \u200B\u00A0 ')).toBeNull();
  });

  it('counts characters, not UTF-16 units, so 120 emoji fit and 121 do not', () => {
    const emoji = '\u{1F3D7}'; // one code point, two UTF-16 units
    expect(cleanCompanyName(emoji.repeat(COMPANY_NAME_MAX))).toBe(emoji.repeat(COMPANY_NAME_MAX));
    expect(cleanCompanyName(emoji.repeat(COMPANY_NAME_MAX + 1))).toBeNull();
    expect(cleanCompanyName('x'.repeat(COMPANY_NAME_MAX))).toHaveLength(COMPANY_NAME_MAX);
  });

  it('refuses control, zero-width, bidi and separator characters inside the name', () => {
    const refused = [
      '\u0000',
      '\u001F',
      '\u007F',
      '\u009F',
      '\u200B',
      '\u200D',
      '\u200E',
      '\u200F',
      '\u2060',
      '\uFEFF',
      '\u202A',
      '\u202E',
      '\u2066',
      '\u2069',
      '\u061C',
      '\u2028',
      '\u2029',
      '\n',
    ];
    for (const ch of refused) {
      expect(cleanCompanyName(`Ac${ch}me`)).toBeNull();
    }
  });

  it('accepts ordinary letters, digits, punctuation and accents', () => {
    expect(cleanCompanyName("O'Brien & Sons, Béton-Arme Co. #2")).toBe(
      "O'Brien & Sons, Béton-Arme Co. #2",
    );
  });
});
