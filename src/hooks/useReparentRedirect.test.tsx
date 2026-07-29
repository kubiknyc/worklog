/**
 * useReparentRedirect: fires only on a `reparents` CHANGE (never on mount),
 * re-resolves `(projectId, reportDate)` through the repo, does nothing on a
 * null resolve (pinned — a transient miss must never navigate), and only
 * `router.replace`s when the resolved id differs from `routeId`.
 */
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));

// RepositoryProvider imports useAuth, platformRepo (native) and supabaseRepo
// at module scope for its account-switch rebuild — none of which this hook
// test exercises (the `repository` override short-circuits that effect), but
// the imports still execute at require-time and platformRepo.native pulls in
// the real Supabase client, which throws without env vars. Mirrors
// RepositoryProvider.rekey.test.tsx's stubs.
jest.mock('../auth', () => ({ useAuth: () => ({ userId: 'u1' }) }));
jest.mock('../data/platformRepo', () => ({
  createPlatformRepository: jest.fn(() => Promise.resolve({ repo: {}, engine: null })),
}));
jest.mock('../data/supabaseRepo', () => ({ supabaseRepository: {} }));

// eslint-disable-next-line import/first
import { RepositoryProvider } from '../data/RepositoryProvider';
// eslint-disable-next-line import/first
import type { DailyReportRow, Repository } from '../data/types';
// eslint-disable-next-line import/first
import { IDLE_SYNC_STATE } from '../sync/engineApi';
// eslint-disable-next-line import/first
import type { SyncEngineApi, SyncState } from '../sync/engineApi';
// eslint-disable-next-line import/first
import { syncStatusHub } from '../sync/statusHub';
// eslint-disable-next-line import/first
import { useReparentRedirect } from './useReparentRedirect';

function fakeEngine(initial: SyncState) {
  let state = initial;
  const listeners = new Set<(s: SyncState) => void>();
  const api: Pick<SyncEngineApi, 'getState' | 'subscribe'> = {
    getState: () => state,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return {
    api,
    publish(next: SyncState) {
      state = next;
      for (const fn of listeners) fn(next);
    },
  };
}

function makeRepo(overrides: Partial<Repository> = {}): Repository {
  const notImplemented = () => Promise.reject(new Error('not implemented in fake'));
  return {
    listProjects: notImplemented,
    getReportByDate: overrides.getReportByDate ?? (() => Promise.resolve(null)),
    getProject: notImplemented,
    getReport: notImplemented,
    listSections: notImplemented,
    getWeather: notImplemented,
    listMembers: notImplemented,
    listMutations: notImplemented,
    createReport: notImplemented,
    updateSection: notImplemented,
    ...overrides,
  } as Repository;
}

function wrapperFor(repository: Repository) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return <RepositoryProvider repository={repository}>{children}</RepositoryProvider>;
  };
}

afterEach(() => {
  jest.clearAllMocks();
  act(() => {
    syncStatusHub.setCounter(null);
  });
});

describe('useReparentRedirect', () => {
  test('does nothing on mount even with loaded identity set', async () => {
    const getReportByDate = jest.fn().mockResolvedValue(null);
    const repo = makeRepo({ getReportByDate });

    renderHook(
      () => useReparentRedirect('report-1', { projectId: 'p1', reportDate: '2026-07-29' }),
      { wrapper: wrapperFor(repo) },
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(getReportByDate).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  test('a transient null resolve never navigates', async () => {
    const getReportByDate = jest.fn().mockResolvedValue(null);
    const repo = makeRepo({ getReportByDate });
    const engine = fakeEngine(IDLE_SYNC_STATE);
    const detach = syncStatusHub.attachEngine(engine.api);

    renderHook(
      () => useReparentRedirect('report-1', { projectId: 'p1', reportDate: '2026-07-29' }),
      { wrapper: wrapperFor(repo) },
    );

    act(() => {
      engine.publish({ ...IDLE_SYNC_STATE, reparents: 1 });
    });

    await waitFor(() => expect(getReportByDate).toHaveBeenCalledWith('p1', '2026-07-29'));
    expect(mockReplace).not.toHaveBeenCalled();
    act(() => detach());
  });

  test('does not re-resolve when loaded is null, even on a reparents bump', async () => {
    const getReportByDate = jest.fn().mockResolvedValue(null);
    const repo = makeRepo({ getReportByDate });
    const engine = fakeEngine(IDLE_SYNC_STATE);
    const detach = syncStatusHub.attachEngine(engine.api);

    renderHook(() => useReparentRedirect('report-1', null), { wrapper: wrapperFor(repo) });

    act(() => {
      engine.publish({ ...IDLE_SYNC_STATE, reparents: 1 });
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(getReportByDate).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    act(() => detach());
  });

  test('resolved id equal to routeId does not navigate', async () => {
    const row: DailyReportRow = {
      id: 'report-1',
      project_id: 'p1',
      report_date: '2026-07-29',
      status: 'draft',
    };
    const getReportByDate = jest.fn().mockResolvedValue(row);
    const repo = makeRepo({ getReportByDate });
    const engine = fakeEngine(IDLE_SYNC_STATE);
    const detach = syncStatusHub.attachEngine(engine.api);

    renderHook(
      () => useReparentRedirect('report-1', { projectId: 'p1', reportDate: '2026-07-29' }),
      { wrapper: wrapperFor(repo) },
    );

    act(() => {
      engine.publish({ ...IDLE_SYNC_STATE, reparents: 1 });
    });

    await waitFor(() => expect(getReportByDate).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockReplace).not.toHaveBeenCalled();
    act(() => detach());
  });

  test('resolved id different from routeId replaces to the winner report', async () => {
    const row: DailyReportRow = {
      id: 'report-winner',
      project_id: 'p1',
      report_date: '2026-07-29',
      status: 'draft',
    };
    const getReportByDate = jest.fn().mockResolvedValue(row);
    const repo = makeRepo({ getReportByDate });
    const engine = fakeEngine(IDLE_SYNC_STATE);
    const detach = syncStatusHub.attachEngine(engine.api);

    renderHook(
      () => useReparentRedirect('report-loser', { projectId: 'p1', reportDate: '2026-07-29' }),
      { wrapper: wrapperFor(repo) },
    );

    act(() => {
      engine.publish({ ...IDLE_SYNC_STATE, reparents: 1 });
    });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/report/report-winner'));
    act(() => detach());
  });

  test('a reparents bump that lands before `loaded` resolves is not dropped — it retries once loaded lands', async () => {
    const row: DailyReportRow = {
      id: 'report-winner',
      project_id: 'p1',
      report_date: '2026-07-29',
      status: 'draft',
    };
    const getReportByDate = jest.fn().mockResolvedValue(row);
    const repo = makeRepo({ getReportByDate });
    const engine = fakeEngine(IDLE_SYNC_STATE);
    const detach = syncStatusHub.attachEngine(engine.api);

    const { rerender } = renderHook(
      ({ loaded }: { loaded: { projectId: string; reportDate: string } | null }) =>
        useReparentRedirect('report-loser', loaded),
      { wrapper: wrapperFor(repo), initialProps: { loaded: null } },
    );

    // The bump lands while `loaded` is still null — e.g. right after
    // createReport navigates into /report/[id], before the report data has
    // resolved. This must NOT be silently consumed.
    act(() => {
      engine.publish({ ...IDLE_SYNC_STATE, reparents: 1 });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(getReportByDate).not.toHaveBeenCalled();

    // `loaded` resolves afterward — the still-unconsumed bump must now retry.
    rerender({ loaded: { projectId: 'p1', reportDate: '2026-07-29' } });

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/report/report-winner'));
    act(() => detach());
  });
});
