import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('../supabase/client', () => ({ supabase: {} }));
const mockUseAuth = jest.fn();
jest.mock('./AuthProvider', () => ({ useAuth: () => mockUseAuth() }));
const mockLoad = jest.fn();
const mockNames = jest.fn();
const mockNoCo = jest.fn();
jest.mock('./soloCompany', () => ({
  ...jest.requireActual('./soloCompany'),
  loadSoloCompanyImpact: (...a: unknown[]) => mockLoad(...a),
  loadCompanyNames: (...a: unknown[]) => mockNames(...a),
  loadNoCompanyImpact: (...a: unknown[]) => mockNoCo(...a),
}));

/* eslint-disable import/first */
import { useDeleteAccountWarning } from './useDeleteAccountWarning';
/* eslint-enable import/first */

const auth = (role: 'admin' | 'member') => ({
  userId: 'me',
  companyMemberships: [{ company_id: 'co', role }],
  memberships: [],
  projectCompanies: { p1: 'co', p2: 'co', other: 'zz' },
});

const noCoAuth = (role: 'super' | 'sub', companyMemberships: unknown[] = []) => ({
  userId: 'me',
  companyMemberships,
  memberships: [{ project_id: 'n1', role }],
  projectCompanies: { n1: null, n2: null },
});

beforeEach(() => {
  mockLoad.mockReset();
  mockNames.mockReset();
  mockNoCo.mockReset();
  mockNames.mockResolvedValue({ co: 'Harbor' });
  mockUseAuth.mockReturnValue(auth('admin'));
});

it('shows nothing to a non-admin and runs no query', () => {
  mockUseAuth.mockReturnValue(auth('member'));
  const { result } = renderHook(() => useDeleteAccountWarning(true));
  expect(result.current).toBe('');
  expect(mockLoad).not.toHaveBeenCalled();
  expect(mockNames).not.toHaveBeenCalled();
});

it('shows the conditional warning at once, then counts for a solo admin', async () => {
  let resolve: (v: unknown) => void = () => {};
  mockLoad.mockReturnValue(new Promise((r) => (resolve = r)));
  const { result } = renderHook(() => useDeleteAccountWarning(true));
  expect(result.current).toMatch(/^If you're the only person in /);
  expect(result.current).toContain('locked and signed reports');
  expect(mockLoad).toHaveBeenCalledWith('me', 'co', ['p1', 'p2']);
  await act(async () => resolve({ solo: true, reports: 40, sealedReports: 12 }));
  await waitFor(() =>
    expect(result.current).toContain('(2 projects, 40 daily reports, 12 of them locked or signed)'),
  );
  expect(result.current).toContain("You're the only person in Harbor,");
});

it('drops the warning when other people use the company', async () => {
  mockLoad.mockResolvedValue({ solo: false, reports: null, sealedReports: null });
  const { result } = renderHook(() => useDeleteAccountWarning(true));
  await waitFor(() => expect(result.current).toBe(''));
});

it('stays conditional when the check fails', async () => {
  mockLoad.mockRejectedValue(new Error('offline'));
  mockNames.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useDeleteAccountWarning(true));
  await act(async () => {});
  expect(result.current).toMatch(/^If you're the only person in your company/);
});

it('does not query while the sheet is closed', () => {
  renderHook(() => useDeleteAccountWarning(false));
  expect(mockLoad).not.toHaveBeenCalled();
});

describe('no-company projects', () => {
  it('warns a user with no company at all, conditional first then definitive', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockNoCo.mockReturnValue(new Promise((r) => (resolve = r)));
    mockUseAuth.mockReturnValue(noCoAuth('super'));
    const { result } = renderHook(() => useDeleteAccountWarning(true));
    expect(result.current).toMatch(
      /^If you're the only person on a project that isn't part of a company/,
    );
    expect(mockNoCo).toHaveBeenCalledWith('me', ['n1', 'n2'], new Set(['n1']));
    expect(mockLoad).not.toHaveBeenCalled();
    await act(async () => resolve({ projects: 2, reports: 40, sealedReports: 12 }));
    await waitFor(() =>
      expect(result.current).toMatch(/^You're the only person on 2 projects that aren't/),
    );
    expect(result.current).toContain('(40 daily reports, 12 of them locked or signed)');
  });

  it('shows nothing once others turn out to be on every no-company project', async () => {
    mockNoCo.mockResolvedValue({ projects: 0, reports: null, sealedReports: null });
    mockUseAuth.mockReturnValue(noCoAuth('super'));
    const { result } = renderHook(() => useDeleteAccountWarning(true));
    await waitFor(() => expect(result.current).toBe(''));
  });

  it('stays conditional when the check fails', async () => {
    mockNoCo.mockRejectedValue(new Error('offline'));
    mockUseAuth.mockReturnValue(noCoAuth('sub'));
    const { result } = renderHook(() => useDeleteAccountWarning(true));
    await act(async () => {});
    expect(result.current).toMatch(/^If you're the only person on a project/);
  });

  it('gives a solo admin with no company projects both sentences, no zero counts', async () => {
    mockUseAuth.mockReturnValue({
      ...noCoAuth('super', [{ company_id: 'co', role: 'admin' }]),
      projectCompanies: { n1: null },
    });
    mockLoad.mockResolvedValue({ solo: true, reports: 0, sealedReports: 0, projects: 0 });
    mockNoCo.mockResolvedValue({ projects: 1, reports: 3, sealedReports: 0 });
    const { result } = renderHook(() => useDeleteAccountWarning(true));
    await waitFor(() =>
      expect(result.current).toContain("You're the only person on 1 project that isn't"),
    );
    expect(result.current).toContain("You're the only person in Harbor,");
    expect(result.current).not.toContain('(0 projects');
  });

  it('runs no no-company query while closed', () => {
    mockUseAuth.mockReturnValue(noCoAuth('super'));
    renderHook(() => useDeleteAccountWarning(false));
    expect(mockNoCo).not.toHaveBeenCalled();
  });
});
