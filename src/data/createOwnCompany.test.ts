import {
  checkCompanyName,
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
const ch = (codePoint: number) => String.fromCodePoint(codePoint);

describe('createOwnCompany', () => {
  it('sends the trimmed name and reports a created company', async () => {
    await expect(createOwnCompany('  Acme Builders  ')).resolves.toEqual({ kind: 'created' });
    expect(mockRpc).toHaveBeenCalledWith('create_own_company', { company_name: 'Acme Builders' });
  });

  it('refuses a name the server would refuse before touching the network', async () => {
    for (const name of ['   ', 'x'.repeat(COMPANY_NAME_MAX + 1)]) {
      await expect(createOwnCompany(name)).resolves.toEqual(
        failed(CREATE_COMPANY_COPY.invalidName),
      );
    }
    await expect(createOwnCompany(`Acme${ch(0x202e)}Build`)).resolves.toEqual(
      failed(CREATE_COMPANY_COPY.refusedCharacters),
    );
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

  it('logs the HTTP status when the error carries an empty code', async () => {
    mockRpc.mockResolvedValueOnce({ error: { code: '', message: 'fetch failed' }, status: 503 });
    await createOwnCompany('Acme');
    expect(warnSpy).toHaveBeenCalledWith(expect.any(String), 503);
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

describe('checkCompanyName (mirrors the server NAME RULE)', () => {
  const ok = (name: string) => ({ ok: true, name });
  const bad = (reason: 'length' | 'characters') => ({ ok: false, reason });

  it('trims JS whitespace plus U+200B from both ends', () => {
    const edges = [0x00a0, 0x1680, 0x2000, 0x200a, 0x200b, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000];
    for (const cp of [...edges, 0xfeff]) {
      expect(checkCompanyName(`${ch(cp)}Acme${ch(cp)}`)).toEqual(ok('Acme'));
    }
  });

  it('refuses an empty or whitespace-only name as a length problem', () => {
    expect(checkCompanyName('')).toEqual(bad('length'));
    expect(checkCompanyName(` ${ch(0x200b)}${ch(0x00a0)} `)).toEqual(bad('length'));
  });

  it('counts characters, not UTF-16 units, so 120 emoji fit and 121 do not', () => {
    const emoji = ch(0x1f3d7); // one code point, two UTF-16 units
    expect(checkCompanyName(emoji.repeat(COMPANY_NAME_MAX))).toEqual(
      ok(emoji.repeat(COMPANY_NAME_MAX)),
    );
    expect(checkCompanyName(emoji.repeat(COMPANY_NAME_MAX + 1))).toEqual(bad('length'));
    expect(checkCompanyName('x'.repeat(COMPANY_NAME_MAX))).toEqual(
      ok('x'.repeat(COMPANY_NAME_MAX)),
    );
  });

  it('refuses every character in the server refuse-anywhere class', () => {
    const refused = [
      0x0000, 0x0009, 0x000a, 0x001f, 0x007f, 0x0085, 0x009f, 0x00ad, 0x034f, 0x061c, 0x115f,
      0x1160, 0x17b4, 0x17b5, 0x180e, 0x180f, 0x200b, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a,
      0x202e, 0x2060, 0x2061, 0x2064, 0x2066, 0x2069, 0x206f, 0x3164, 0xfeff, 0xffa0, 0xfff0,
      0xfff8, 0x1bca0, 0x1bca3, 0x1d173, 0x1d17a,
    ];
    for (const cp of refused) {
      expect(checkCompanyName(`Ac${ch(cp)}me`)).toEqual(bad('characters'));
    }
  });

  it('refuses a name made only of invisible characters (refuse-anywhere or blank-only)', () => {
    expect(checkCompanyName(ch(0x2800))).toEqual(bad('characters'));
    expect(checkCompanyName(`${ch(0xfe0f)}${ch(0xfe00)}`)).toEqual(bad('characters'));
    expect(checkCompanyName(`${ch(0x2800)} ${ch(0x2800)}`)).toEqual(bad('characters'));
    expect(checkCompanyName(ch(0x200d))).toEqual(bad('characters'));
    expect(checkCompanyName(ch(0x180b))).toEqual(bad('characters'));
    expect(checkCompanyName(ch(0xe0020))).toEqual(bad('characters'));
    expect(checkCompanyName(ch(0xe0100))).toEqual(bad('characters'));
  });

  it('refuses a name containing a supplementary-plane format control anywhere', () => {
    expect(checkCompanyName(`Ac${ch(0x1d173)}me`)).toEqual(bad('characters'));
    expect(checkCompanyName(`Ac${ch(0x1bca0)}me`)).toEqual(bad('characters'));
  });

  it('allows a variation selector, ZWJ or ZWNJ inside a real name', () => {
    const coffee = `${ch(0x2615)}${ch(0xfe0f)}`;
    expect(checkCompanyName(`${coffee} Cafe Builders`)).toEqual(ok(`${coffee} Cafe Builders`));

    // ZWJ emoji: construction worker + ZWJ + female sign + variation selector.
    const zwjEmoji = `${ch(0x1f477)}${ch(0x200d)}${ch(0x2640)}${ch(0xfe0f)}`;
    expect(checkCompanyName(`Acme ${zwjEmoji}`)).toEqual(ok(`Acme ${zwjEmoji}`));

    // ZWNJ Persian: "mikhwaham" with a non-joining join.
    const zwnjPersian = `\u0645\u06cc${ch(0x200c)}\u062e\u0648\u0627\u0647\u0645`;
    expect(checkCompanyName(zwnjPersian)).toEqual(ok(zwnjPersian));

    // England flag + subdivision tag sequence, alongside an ordinary word.
    const englandFlag = [0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f]
      .map(ch)
      .join('');
    expect(checkCompanyName(`${englandFlag} Crew`)).toEqual(ok(`${englandFlag} Crew`));
  });

  it('refuses a name consisting only of a lone surrogate, as a length problem', () => {
    expect(checkCompanyName(ch(0x1f3d7)[0])).toEqual(bad('length'));
    expect(checkCompanyName(`Ac${ch(0x1f3d7)[0]}me`)).toEqual(bad('length'));
  });

  it('accepts ordinary letters, digits, punctuation, accents and CJK', () => {
    expect(checkCompanyName("O'Brien & Sons, Béton-Armé Co. #2")).toEqual(
      ok("O'Brien & Sons, Béton-Armé Co. #2"),
    );
    expect(checkCompanyName('\u682a\u5f0f\u4f1a\u793e')).toEqual(ok('\u682a\u5f0f\u4f1a\u793e'));
  });
});
