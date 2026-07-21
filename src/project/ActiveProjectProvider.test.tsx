/**
 * ActiveProjectProvider — hydrates the persisted per-user choice, resolves it
 * against live memberships, persists switches write-through under the
 * user-scoped key.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import type { Membership } from '../auth/roles';

// `mock`-prefixed so Jest allows referencing them inside the factory.
let mockUserId: string | null = 'u1';
let mockMemberships: readonly Membership[] = [];

jest.mock('../auth', () => ({
  useAuth: () => ({ userId: mockUserId, memberships: mockMemberships }),
}));

// eslint-disable-next-line import/first
import { ActiveProjectProvider, useActiveProject } from './ActiveProjectProvider';

const m = (id: string): Membership => ({ project_id: id, role: 'super' });

const wrapper = ({ children }: { children: ReactNode }) => (
  <ActiveProjectProvider>{children}</ActiveProjectProvider>
);

beforeEach(async () => {
  mockUserId = 'u1';
  mockMemberships = [m('p-b'), m('p-a')];
  await AsyncStorage.clear();
});

test('hydrates a valid persisted choice and flips ready', async () => {
  await AsyncStorage.setItem('activeProject:u1', 'p-b');
  const { result } = renderHook(() => useActiveProject(), { wrapper });
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.activeProjectId).toBe('p-b');
});

test('falls back to the deterministic default when nothing is persisted', async () => {
  const { result } = renderHook(() => useActiveProject(), { wrapper });
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.activeProjectId).toBe('p-a'); // lowest id, not memberships[0]
});

test('discards a persisted id that is no longer a membership', async () => {
  await AsyncStorage.setItem('activeProject:u1', 'p-gone');
  const { result } = renderHook(() => useActiveProject(), { wrapper });
  await waitFor(() => expect(result.current.ready).toBe(true));
  expect(result.current.activeProjectId).toBe('p-a');
});

test('setActiveProject switches immediately and persists user-scoped', async () => {
  const { result } = renderHook(() => useActiveProject(), { wrapper });
  await waitFor(() => expect(result.current.ready).toBe(true));

  act(() => result.current.setActiveProject('p-b'));
  expect(result.current.activeProjectId).toBe('p-b');
  await waitFor(async () => expect(await AsyncStorage.getItem('activeProject:u1')).toBe('p-b'));
});

test('a manual switch during hydration is not clobbered by the stale read', async () => {
  // Deferred getItem: capture the resolver so we can complete the hydration
  // read AFTER a manual switch has already happened (same user).
  let resolveRead!: (value: string | null) => void;
  const spy = jest.spyOn(AsyncStorage, 'getItem').mockImplementation(
    () =>
      new Promise<string | null>((resolve) => {
        resolveRead = resolve;
      }),
  );
  try {
    const { result } = renderHook(() => useActiveProject(), { wrapper });

    // Hydration read is in flight; user switches manually. (activeProjectId
    // is still null here by design — it is ready-gated until hydration ends.)
    act(() => result.current.setActiveProject('p-b'));

    // The stale read now resolves with a DIFFERENT stored value.
    await act(async () => {
      resolveRead('p-a');
    });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.activeProjectId).toBe('p-b'); // manual write wins
  } finally {
    spy.mockRestore();
  }
});

test('signed out: ready with a null project', async () => {
  mockUserId = null;
  mockMemberships = [];
  const { result } = renderHook(() => useActiveProject(), { wrapper });
  expect(result.current.ready).toBe(true);
  expect(result.current.activeProjectId).toBeNull();
});

test('useActiveProject throws outside the provider', () => {
  expect(() => renderHook(() => useActiveProject())).toThrow(
    /must be used within an ActiveProjectProvider/,
  );
});
