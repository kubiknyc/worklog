import {
  COMPANY_NAME_MAX,
  CREATE_COMPANY_COPY,
  createCompanyFailureCopy,
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

describe('createOwnCompany', () => {
  it('sends the trimmed name and reports success', async () => {
    await expect(createOwnCompany('  Acme Builders  ')).resolves.toEqual({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith('create_own_company', { company_name: 'Acme Builders' });
  });

  it('refuses a blank or over-long name before touching the network', async () => {
    for (const name of ['   ', 'x'.repeat(COMPANY_NAME_MAX + 1)]) {
      await expect(createOwnCompany(name)).resolves.toEqual({
        ok: false,
        message: CREATE_COMPANY_COPY.invalidName,
      });
    }
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('maps a server refusal by code and never shows the server message', async () => {
    mockRpc.mockResolvedValueOnce({
      error: { code: 'PL002', message: 'already_affiliated' },
      status: 400,
    });
    const result = await createOwnCompany('Acme');
    expect(result).toEqual({ ok: false, message: CREATE_COMPANY_COPY.alreadyAffiliated });
  });

  it('turns a thrown transport failure into offline copy', async () => {
    mockRpc.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(createOwnCompany('Acme')).resolves.toEqual({
      ok: false,
      message: CREATE_COMPANY_COPY.offline,
    });
  });

  it('turns any other throw into generic copy', async () => {
    mockRpc.mockRejectedValueOnce(new Error('boom'));
    await expect(createOwnCompany('Acme')).resolves.toEqual({
      ok: false,
      message: CREATE_COMPANY_COPY.failed,
    });
  });
});

describe('createCompanyFailureCopy', () => {
  it('reads an expired session from the status or the code', () => {
    expect(createCompanyFailureCopy({}, 401)).toBe(CREATE_COMPANY_COPY.expired);
    expect(createCompanyFailureCopy({}, 403)).toBe(CREATE_COMPANY_COPY.expired);
    expect(createCompanyFailureCopy({ code: '42501' }, 400)).toBe(CREATE_COMPANY_COPY.expired);
  });

  it('gives each refusal code its own copy', () => {
    expect(createCompanyFailureCopy({ code: 'PL001' }, 400)).toBe(CREATE_COMPANY_COPY.notConfirmed);
    expect(createCompanyFailureCopy({ code: 'PL002' }, 400)).toBe(
      CREATE_COMPANY_COPY.alreadyAffiliated,
    );
    expect(createCompanyFailureCopy({ code: 'PL003' }, 400)).toBe(CREATE_COMPANY_COPY.invalidName);
  });

  it('falls back to generic copy, or offline copy for a transport failure', () => {
    expect(createCompanyFailureCopy({ code: 'PGRST202' }, 404)).toBe(CREATE_COMPANY_COPY.failed);
    expect(createCompanyFailureCopy({ code: '22023' }, 400)).toBe(CREATE_COMPANY_COPY.failed);
    expect(createCompanyFailureCopy({}, 500)).toBe(CREATE_COMPANY_COPY.failed);
    const transport = { name: 'TypeError', message: 'Failed to fetch' } as { code?: string };
    expect(createCompanyFailureCopy(transport, 0)).toBe(CREATE_COMPANY_COPY.offline);
  });
});
