/**
 * Solo-company detection behind the delete-account warning. A company admin
 * can read the whole roster, every project_members row and every daily report
 * of its projects, so "sole member" is decidable on the client; the server
 * still decides. Unknown must never read as "alone" OR as "safe": errors
 * return null.
 */
jest.mock('../supabase/client', () => {
  const from = jest.fn();
  return { __mocks: { from }, supabase: { from } };
});

/* eslint-disable import/first */
import {
  deleteAccountMessage,
  deleteWarningText,
  loadCompanyNames,
  loadSoloCompanyImpact,
} from './soloCompany';
/* eslint-enable import/first */

const { from: mockFrom } = (
  jest.requireMock('../supabase/client') as { __mocks: { from: jest.Mock } }
).__mocks;

type Res = { count?: number | null; data?: unknown; error: unknown };
/** Every builder method chains; awaiting resolves to the table's result(s). */
function table(res: Res | Res[]) {
  const results = Array.isArray(res) ? [...res] : [res];
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'in']) b[m] = jest.fn(() => b);
  b.then = (done: (r: Res) => unknown) => Promise.resolve(results[0]).then(done);
  return b;
}
function mockTables(t: Record<string, Res>, sealedReports?: Res) {
  let reportCalls = 0;
  mockFrom.mockImplementation((name: string) => {
    if (name === 'daily_reports' && sealedReports) {
      // Promise.all issues the total query first, then the locked/signed one.
      return table(reportCalls++ === 0 ? t[name] : sealedReports);
    }
    return table(t[name]);
  });
}
const ok = (count: number): Res => ({ count, error: null });
const bad: Res = { count: null, error: { message: 'x' } };

beforeEach(() => mockFrom.mockReset());

describe('loadSoloCompanyImpact', () => {
  it('reports solo with report counts when nobody else is involved', async () => {
    mockTables({ company_members: ok(0), project_members: ok(0), daily_reports: ok(40) }, ok(12));
    expect(await loadSoloCompanyImpact('me', 'co', ['p1', 'p2'])).toEqual({
      solo: true,
      reports: 40,
      sealedReports: 12,
    });
  });

  it('is not solo when another company member exists', async () => {
    mockTables({ company_members: ok(1) });
    expect(await loadSoloCompanyImpact('me', 'co', ['p1'])).toEqual({
      solo: false,
      reports: null,
      sealedReports: null,
    });
  });

  it('is not solo when another user is on one of its projects', async () => {
    mockTables({ company_members: ok(0), project_members: ok(2), daily_reports: ok(1) });
    expect((await loadSoloCompanyImpact('me', 'co', ['p1']))?.solo).toBe(false);
  });

  it('returns null (unknown) when the roster cannot be read', async () => {
    mockTables({ company_members: bad });
    expect(await loadSoloCompanyImpact('me', 'co', ['p1'])).toBeNull();
  });

  it('returns null (unknown) when the project roster cannot be read', async () => {
    mockTables({ company_members: ok(0), project_members: bad, daily_reports: ok(1) });
    expect(await loadSoloCompanyImpact('me', 'co', ['p1'])).toBeNull();
  });

  it('keeps solo but drops a count that failed', async () => {
    mockTables({ company_members: ok(0), project_members: ok(0), daily_reports: ok(3) }, bad);
    expect(await loadSoloCompanyImpact('me', 'co', ['p1'])).toEqual({
      solo: true,
      reports: 3,
      sealedReports: null,
    });
  });

  it('fetches the company projects itself when none were passed; solo with none', async () => {
    mockTables({ company_members: ok(0), projects: { data: [], error: null } });
    expect(await loadSoloCompanyImpact('me', 'co', [])).toEqual({
      solo: true,
      reports: 0,
      sealedReports: 0,
      projects: 0,
    });
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  it('checks project members of fetched projects when none were passed', async () => {
    mockTables({
      company_members: ok(0),
      projects: { data: [{ id: 'p1' }], error: null },
      project_members: ok(1),
      daily_reports: ok(1),
    });
    expect((await loadSoloCompanyImpact('me', 'co', []))?.solo).toBe(false);
  });

  it('reports the fetched project count when solo', async () => {
    mockTables(
      {
        company_members: ok(0),
        projects: { data: [{ id: 'p1' }, { id: 'p2' }], error: null },
        project_members: ok(0),
        daily_reports: ok(6),
      },
      ok(2),
    );
    expect(await loadSoloCompanyImpact('me', 'co', [])).toEqual({
      solo: true,
      reports: 6,
      sealedReports: 2,
      projects: 2,
    });
  });

  it('returns null (unknown) when the company projects cannot be read', async () => {
    mockTables({ company_members: ok(0), projects: bad });
    expect(await loadSoloCompanyImpact('me', 'co', [])).toBeNull();
  });
});

describe('loadCompanyNames', () => {
  it('maps ids to names', async () => {
    mockTables({ companies: { data: [{ id: 'co', name: 'Harbor Construction' }], error: null } });
    expect(await loadCompanyNames(['co'])).toEqual({ co: 'Harbor Construction' });
  });

  it('is empty on error', async () => {
    mockTables({ companies: bad });
    expect(await loadCompanyNames(['co'])).toEqual({});
  });
});

describe('deleteWarningText', () => {
  it('names the company, counts and locked/signed reports for a confirmed solo admin', () => {
    const text = deleteWarningText([
      { name: 'Harbor Construction', state: 'solo', projects: 2, reports: 40, sealedReports: 12 },
    ]);
    expect(text).toBe(
      "You're the only person in Harbor Construction, so deleting your account also permanently deletes " +
        'Harbor Construction and everything in it (2 projects, 40 daily reports, 12 of them locked or signed): ' +
        'its projects, daily reports (including locked and signed reports) and photos.',
    );
  });

  it('omits the locked/signed clause when there are none or it is unknown', () => {
    const none = deleteWarningText([
      { name: 'Harbor', state: 'solo', projects: 1, reports: 1, sealedReports: 0 },
    ]);
    expect(none).toContain('(1 project, 1 daily report)');
    const unknown = deleteWarningText([
      { name: 'Harbor', state: 'solo', projects: 1, reports: 5, sealedReports: null },
    ]);
    expect(unknown).toContain('(1 project, 5 daily reports)');
  });

  it('omits counts when they are unavailable but still names locked and signed reports', () => {
    const text = deleteWarningText([
      { name: 'Harbor', state: 'solo', projects: 2, reports: null, sealedReports: null },
    ]);
    expect(text).not.toMatch(/\(\d/);
    expect(text).toContain('including locked and signed reports');
  });

  it('is conditional while the check is pending or failed', () => {
    const text = deleteWarningText([
      { name: 'Harbor', state: 'maybe', projects: 2, reports: null, sealedReports: null },
    ]);
    expect(text).toBe(
      "If you're the only person in Harbor, deleting your account also permanently deletes Harbor " +
        'with all its projects, daily reports (including locked and signed reports) and photos.',
    );
  });

  it('is empty with nothing to warn about', () => {
    expect(deleteWarningText([])).toBe('');
  });
});

describe('deleteAccountMessage', () => {
  const ORIGINAL =
    "This permanently deletes your account and removes your access to this company's reports. It cannot be undone.";

  it('is the original text when there is no company warning', () => {
    expect(deleteAccountMessage('')).toBe(ORIGINAL);
  });

  it('leads with the warning and no longer says the company reports merely become inaccessible', () => {
    const msg = deleteAccountMessage('You are alone in Harbor.');
    expect(msg).toBe(
      'You are alone in Harbor.\n\nThis permanently deletes your account and removes your access. It cannot be undone.',
    );
    expect(msg).not.toContain("company's reports");
  });
});
