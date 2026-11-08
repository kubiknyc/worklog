import { act, renderHook, waitFor } from '@testing-library/react-native';

jest.mock('../supabase/client', () => ({ supabase: {} }));
const mockUseAuth = jest.fn();
jest.mock('./AuthProvider', () => ({ useAuth: () => mockUseAuth() }));
const mockLoad = jest.fn();
const mockNames = jest.fn();
jest.mock('./soloCompany', () => ({
  ...jest.requireActual('./soloCompany'),
  loadSoloCompanyImpact: (...a: unknown[]) => mockLoad(...a),
  loadCompanyNames: (...a: unknown[]) => mockNames(...a),
}));

/* eslint-disable import/first */
import { useDeleteAccountWarning } from './useDeleteAccountWarning';
/* eslint-enable import/first */

const auth = (role: 'admin' | 'member') => ({
  userId: 'me',
  companyMemberships: [{ company_id: 'co', role }],
  projectCompanies: { p1: 'co', p2: 'co', other: 'zz' },
});

beforeEach(() => {
  mockLoad.mockReset();
  mockNames.mockReset();
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
