/**
 * `SupabaseRepository` is the whole data seam for the web build and the native
 * fallback when the device database can't open, so every method here is a live
 * production path. It used to be tested only through `updateSection`, on the
 * claim that "the rest is exercised indirectly elsewhere" — it is not: every
 * other reference to this module stubs it. That left the read path at ~7%,
 * where deleting `createReport`'s no-rows guard or any `if (error) fail(...)`
 * kept the suite green (#21).
 *
 * The fake below is a chainable thenable: PostgREST builders are awaited at the
 * end of a chain, so recording the chain and resolving a per-table result lets
 * these tests assert the actual query shape (columns, filters, ordering) rather
 * than just that something was called.
 */
import { supabaseRepository } from './supabaseRepo';

type QueryResult = { data: unknown; error: { message: string } | null };

const OK: QueryResult = { data: null, error: null };

/** Result each table's query resolves with; unset tables resolve empty-and-fine. */
const tableResults = new Map<string, QueryResult>();
/** Chain recorded per `from(table)` call, e.g. [['select', [...]], ['eq', [...]]]. */
type Chain = { readonly table: string; readonly ops: [string, unknown[]][] };
let chains: Chain[] = [];

function chainFor(table: string): Chain {
  const found = chains.find((c) => c.table === table);
  if (!found) throw new Error(`no query issued against "${table}"`);
  return found;
}
/** Args of the first `op` call in that table's chain. */
function argsOf(table: string, op: string): unknown[] {
  const entry = chainFor(table).ops.find(([name]) => name === op);
  if (!entry) throw new Error(`"${table}" chain never called ${op}()`);
  return entry[1];
}

const mockFrom = jest.fn((table: string) => {
  const ops: [string, unknown[]][] = [];
  chains.push({ table, ops });
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'maybeSingle']) {
    builder[method] = (...args: unknown[]) => {
      ops.push([method, args]);
      return builder;
    };
  }
  // Awaiting anywhere in the chain settles it — that is how PostgREST builders
  // behave, and it keeps these tests from caring where the await lands.
  builder.then = (onFulfilled: (v: QueryResult) => unknown, onRejected: (e: unknown) => unknown) =>
    Promise.resolve(tableResults.get(table) ?? OK).then(onFulfilled, onRejected);
  return builder;
});

const mockRpc = jest.fn((..._args: unknown[]): Promise<QueryResult> => Promise.resolve(OK));

jest.mock('../supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (table: string) => mockFrom(table),
  },
}));
jest.mock('../lib/uuid', () => ({ uuidv4: () => 'generated-client-id' }));

let warnSpy: jest.SpyInstance;

beforeEach(() => {
  chains = [];
  tableResults.clear();
  mockFrom.mockClear();
  mockRpc.mockClear();
  mockRpc.mockImplementation(() => Promise.resolve(OK));
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

/** The generic message every failure is masked to — raw PostgREST leaks schema. */
const GENERIC = 'Unable to load data. Please try again.';

describe('SupabaseRepository read path', () => {
  it('listProjects selects the project columns ordered by name', async () => {
    tableResults.set('projects', {
      data: [{ id: 'p1', name: 'Alpha' }],
      error: null,
    });

    const rows = await supabaseRepository.listProjects();

    expect(rows).toEqual([{ id: 'p1', name: 'Alpha' }]);
    // The column list is the web build's contract with the server schema —
    // a dropped column here is a blank field in the UI, not a crash.
    expect(argsOf('projects', 'select')[0]).toBe('id, name, address, timezone, lat, lng');
    expect(argsOf('projects', 'order')).toEqual(['name', { ascending: true }]);
  });

  it('listProjects returns an empty list when PostgREST returns null data', async () => {
    tableResults.set('projects', { data: null, error: null });

    // `data ?? []` matters: callers map over this, and a null would throw in
    // the render path rather than showing an empty project list.
    await expect(supabaseRepository.listProjects()).resolves.toEqual([]);
  });

  it('getReportByDate filters on both project and date and returns at most one row', async () => {
    tableResults.set('daily_reports', {
      data: { id: 'r1', project_id: 'p1', report_date: '2026-08-03', status: 'draft' },
      error: null,
    });

    const row = await supabaseRepository.getReportByDate('p1', '2026-08-03');

    expect(row).toEqual({
      id: 'r1',
      project_id: 'p1',
      report_date: '2026-08-03',
      status: 'draft',
    });
    // Both filters are load-bearing: dropping either returns another project's
    // report or another day's, which the caller would treat as today's.
    expect(chainFor('daily_reports').ops.filter(([name]) => name === 'eq')).toEqual([
      ['eq', ['project_id', 'p1']],
      ['eq', ['report_date', '2026-08-03']],
    ]);
    expect(chainFor('daily_reports').ops.some(([name]) => name === 'maybeSingle')).toBe(true);
  });

  it('getReportByDate resolves null when no report exists for that day', async () => {
    tableResults.set('daily_reports', { data: null, error: null });

    await expect(supabaseRepository.getReportByDate('p1', '2026-08-03')).resolves.toBeNull();
  });

  it('getProject looks the project up by id', async () => {
    tableResults.set('projects', { data: { id: 'p1', name: 'Alpha' }, error: null });

    const row = await supabaseRepository.getProject('p1');

    expect(row).toEqual({ id: 'p1', name: 'Alpha' });
    expect(argsOf('projects', 'eq')).toEqual(['id', 'p1']);
  });

  it('getReport looks the report up by id', async () => {
    tableResults.set('daily_reports', { data: { id: 'r1', status: 'draft' }, error: null });

    const row = await supabaseRepository.getReport('r1');

    expect(row).toEqual({ id: 'r1', status: 'draft' });
    expect(argsOf('daily_reports', 'eq')).toEqual(['id', 'r1']);
  });

  it('listSections scopes to the report and orders by section', async () => {
    tableResults.set('report_sections', {
      data: [{ report_id: 'r1', section: 'crew', payload: {}, is_complete: false }],
      error: null,
    });

    const rows = await supabaseRepository.listSections('r1');

    expect(rows).toHaveLength(1);
    expect(argsOf('report_sections', 'eq')).toEqual(['report_id', 'r1']);
    // Stable ordering keeps the report screen's sheet order deterministic.
    expect(argsOf('report_sections', 'order')).toEqual(['section', { ascending: true }]);
  });

  it('listSections returns an empty list when PostgREST returns null data', async () => {
    tableResults.set('report_sections', { data: null, error: null });

    await expect(supabaseRepository.listSections('r1')).resolves.toEqual([]);
  });

  it('getWeather reads the override and auto columns for the report', async () => {
    tableResults.set('report_weather', {
      data: { report_id: 'r1', weather_source: 'auto', auto_condition: 'Sunny', auto_temp_f: 72 },
      error: null,
    });

    const row = await supabaseRepository.getWeather('r1');

    expect(row).toEqual({
      report_id: 'r1',
      weather_source: 'auto',
      auto_condition: 'Sunny',
      auto_temp_f: 72,
    });
    // Both the auto and override columns must be selected — reading only one
    // silently drops the user's manual correction.
    expect(argsOf('report_weather', 'select')[0]).toContain('override_condition');
    expect(argsOf('report_weather', 'select')[0]).toContain('auto_condition');
  });

  it('getWeather resolves null when the report has no weather row', async () => {
    tableResults.set('report_weather', { data: null, error: null });

    await expect(supabaseRepository.getWeather('r1')).resolves.toBeNull();
  });

  it('listMutations is empty and issues no query — web is online-only', async () => {
    await expect(supabaseRepository.listMutations()).resolves.toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('SupabaseRepository.listMembers', () => {
  it('merges the title from report_member_prefs and sorts by name', async () => {
    tableResults.set('project_members', {
      data: [
        { user_id: 'u2', role: 'sub', profiles: { full_name: 'Zoe Sub', email: 'zoe@x.test' } },
        { user_id: 'u1', role: 'super', profiles: { full_name: 'Adam Super', email: null } },
      ],
      error: null,
    });
    tableResults.set('report_member_prefs', {
      data: [{ user_id: 'u1', title: 'Superintendent' }],
      error: null,
    });

    const members = await supabaseRepository.listMembers('p1');

    // Sorted by name, title merged onto the matching user only, and a member
    // with no pref row gets null rather than inheriting someone else's title.
    expect(members).toEqual([
      {
        user_id: 'u1',
        full_name: 'Adam Super',
        email: null,
        role: 'super',
        title: 'Superintendent',
      },
      { user_id: 'u2', full_name: 'Zoe Sub', email: 'zoe@x.test', role: 'sub', title: null },
    ]);
    expect(argsOf('project_members', 'eq')).toEqual(['project_id', 'p1']);
    expect(argsOf('report_member_prefs', 'eq')).toEqual(['project_id', 'p1']);
  });

  it('tolerates a member whose profile embed is missing', async () => {
    tableResults.set('project_members', {
      data: [{ user_id: 'u1', role: 'sub', profiles: null }],
      error: null,
    });

    const members = await supabaseRepository.listMembers('p1');

    // RLS can hide the joined profile row; the member must still render rather
    // than crashing the crew picker on a null dereference.
    expect(members).toEqual([
      { user_id: 'u1', full_name: '', email: null, role: 'sub', title: null },
    ]);
  });

  it('returns an empty roster when both reads come back null', async () => {
    await expect(supabaseRepository.listMembers('p1')).resolves.toEqual([]);
  });

  it('masks a members query error', async () => {
    tableResults.set('project_members', { data: null, error: { message: 'relation missing' } });

    await expect(supabaseRepository.listMembers('p1')).rejects.toThrow(GENERIC);
    expect(warnSpy).toHaveBeenCalledWith(
      '[supabaseRepo] listMembers failed:',
      expect.objectContaining({ message: 'relation missing' }),
    );
  });

  it('masks a prefs query error separately from the members query', async () => {
    tableResults.set('project_members', { data: [], error: null });
    tableResults.set('report_member_prefs', { data: null, error: { message: 'prefs denied' } });

    await expect(supabaseRepository.listMembers('p1')).rejects.toThrow(GENERIC);
    // The distinct context string is what makes a production log actionable.
    expect(warnSpy).toHaveBeenCalledWith(
      '[supabaseRepo] listMembers(prefs) failed:',
      expect.objectContaining({ message: 'prefs denied' }),
    );
  });
});

describe('SupabaseRepository.createReport', () => {
  it('calls the get-or-create RPC with a generated client id and returns the report', async () => {
    mockRpc.mockImplementation(() => Promise.resolve({ data: [{ report_id: 'r1' }], error: null }));
    tableResults.set('daily_reports', {
      data: { id: 'r1', project_id: 'p1', report_date: '2026-08-03', status: 'draft' },
      error: null,
    });

    const report = await supabaseRepository.createReport('p1', '2026-08-03');

    expect(report).toEqual({
      id: 'r1',
      project_id: 'p1',
      report_date: '2026-08-03',
      status: 'draft',
    });
    // p_client_id is what makes the RPC idempotent under retry — without it a
    // double-tap creates two reports for one day.
    expect(mockRpc).toHaveBeenCalledWith('create_report', {
      p_project_id: 'p1',
      p_report_date: '2026-08-03',
      p_client_id: 'generated-client-id',
    });
  });

  it('throws when the RPC returns no rows', async () => {
    mockRpc.mockImplementation(() => Promise.resolve({ data: [], error: null }));

    // Without this guard the missing id flows into getReport as `undefined`
    // and the caller navigates to a report route that does not exist.
    await expect(supabaseRepository.createReport('p1', '2026-08-03')).rejects.toThrow(GENERIC);
    expect(warnSpy).toHaveBeenCalledWith('[supabaseRepo] createReport failed:', {
      message: 'create_report returned no report id',
    });
  });

  it('throws when the created report cannot be read back', async () => {
    mockRpc.mockImplementation(() => Promise.resolve({ data: [{ report_id: 'r1' }], error: null }));
    tableResults.set('daily_reports', { data: null, error: null });

    await expect(supabaseRepository.createReport('p1', '2026-08-03')).rejects.toThrow(GENERIC);
    expect(warnSpy).toHaveBeenCalledWith('[supabaseRepo] createReport failed:', {
      message: 'created report not found',
    });
  });

  it('masks an RPC error', async () => {
    mockRpc.mockImplementation(() =>
      Promise.resolve({ data: null, error: { message: 'permission denied for create_report' } }),
    );

    await expect(supabaseRepository.createReport('p1', '2026-08-03')).rejects.toThrow(GENERIC);
  });
});

describe('SupabaseRepository error masking', () => {
  // Every read funnels through `fail()`. These assert the two halves of that
  // contract on a representative read: the UI sees a generic string, and the
  // raw PostgREST message survives in the log.
  it.each([
    ['listProjects', 'projects', () => supabaseRepository.listProjects()],
    ['getProject', 'projects', () => supabaseRepository.getProject('p1')],
    ['getReport', 'daily_reports', () => supabaseRepository.getReport('r1')],
    [
      'getReportByDate',
      'daily_reports',
      () => supabaseRepository.getReportByDate('p1', '2026-08-03'),
    ],
    ['listSections', 'report_sections', () => supabaseRepository.listSections('r1')],
    ['getWeather', 'report_weather', () => supabaseRepository.getWeather('r1')],
  ])('%s masks a query error but logs the raw one', async (context, table, call) => {
    tableResults.set(table, { data: null, error: { message: 'column x does not exist' } });

    await expect(call()).rejects.toThrow(GENERIC);
    expect(warnSpy).toHaveBeenCalledWith(
      `[supabaseRepo] ${context} failed:`,
      expect.objectContaining({ message: 'column x does not exist' }),
    );
  });
});

describe('SupabaseRepository.updateSection', () => {
  it('sends weather content translated to snake_case temp_f via the shared wire helper', async () => {
    await supabaseRepository.updateSection(
      'report-1',
      'weather',
      { condition: 'Sunny', tempF: 72 },
      false,
    );

    expect(mockRpc).toHaveBeenCalledWith('update_section', {
      p_report_id: 'report-1',
      p_section: 'weather',
      p_payload: { condition: 'Sunny', temp_f: 72 },
      p_is_complete: false,
    });
  });

  it('passes non-weather section content through unchanged', async () => {
    await supabaseRepository.updateSection('report-1', 'crew', { headcount: 3 }, true);

    expect(mockRpc).toHaveBeenCalledWith('update_section', {
      p_report_id: 'report-1',
      p_section: 'crew',
      p_payload: { headcount: 3 },
      p_is_complete: true,
    });
  });

  it('surfaces an RPC error as the generic thrown message', async () => {
    mockRpc.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: { message: 'boom' } }),
    );

    await expect(
      supabaseRepository.updateSection('report-1', 'crew', { headcount: 3 }, true),
    ).rejects.toThrow(GENERIC);
  });
});

describe('SupabaseRepository.setActiveProject', () => {
  it('is a no-op on web — online-only, no local pull cursor to bias', async () => {
    await expect(supabaseRepository.setActiveProject('p1')).resolves.toBeUndefined();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe('SupabaseRepository.submitReport', () => {
  it('calls submit_report with the hex-encoded signature', async () => {
    await supabaseRepository.submitReport('report-1', {
      signerName: 'Sam Super',
      signerTitle: 'PM',
      signaturePngBase64: 'UE5H',
    });

    expect(mockRpc).toHaveBeenCalledWith('submit_report', {
      p_report_id: 'report-1',
      p_signer_title: 'PM',
      p_signature_png: '\\x504e47',
    });
  });

  it('surfaces an RPC error as the generic thrown message', async () => {
    mockRpc.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: { message: 'boom' } }),
    );

    await expect(
      supabaseRepository.submitReport('report-1', {
        signerName: 'Sam Super',
        signerTitle: null,
        signaturePngBase64: 'UE5H',
      }),
    ).rejects.toThrow(GENERIC);
  });
});

describe('SupabaseRepository.lockReport', () => {
  it('calls lock_report with the report id', async () => {
    await supabaseRepository.lockReport('report-1');

    expect(mockRpc).toHaveBeenCalledWith('lock_report', { p_report_id: 'report-1' });
  });

  it('surfaces an RPC error as the generic thrown message', async () => {
    mockRpc.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: { message: 'boom' } }),
    );

    await expect(supabaseRepository.lockReport('report-1')).rejects.toThrow(GENERIC);
  });
});
