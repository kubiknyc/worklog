/**
 * Regression: the native repository must be rebuilt when the signed-in user
 * changes (Codex PR#1 P1). createPlatformRepository() is where
 * reconcileDbOwnership() wipes a previous owner's cached rows, so an
 * in-process sign-out -> different-user sign-in that does NOT rebuild leaks
 * one user's local reports to the next. A token refresh (same userId) must
 * NOT rebuild.
 */
import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { createPlatformRepository } from './platformRepo';
import { RepositoryProvider } from './RepositoryProvider';

jest.mock('./platformRepo', () => ({
  createPlatformRepository: jest.fn(() => Promise.resolve({ repo: {}, counter: null })),
}));

const mockCreate = createPlatformRepository as jest.MockedFunction<typeof createPlatformRepository>;

// Avoid pulling the real Supabase client (throws without EXPO_PUBLIC_* env).
jest.mock('./supabaseRepo', () => ({ supabaseRepository: {} }));

// HydrationGate reads useTheme; stub it so no ThemeProvider is needed.
jest.mock('../theme', () => ({ useTheme: () => ({ colors: { bg: '#000', muted: '#888' } }) }));

let mockCurrentUserId: string | null = null;
jest.mock('../auth', () => ({ useAuth: () => ({ userId: mockCurrentUserId }) }));

beforeEach(() => {
  mockCreate.mockClear();
  mockCurrentUserId = null;
});

function Tree() {
  return (
    <RepositoryProvider>
      <Text>child</Text>
    </RepositoryProvider>
  );
}

describe('RepositoryProvider account re-keying (native)', () => {
  it('rebuilds the repository when the signed-in user changes', async () => {
    mockCurrentUserId = 'user-A';
    const { rerender } = render(<Tree />);
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));

    // Same user (token refresh) — must NOT rebuild.
    act(() => {
      mockCurrentUserId = 'user-A';
    });
    rerender(<Tree />);
    await Promise.resolve();
    expect(mockCreate).toHaveBeenCalledTimes(1);

    // Different user signs in without an app restart — MUST rebuild so
    // reconcileDbOwnership runs and wipes user-A's cache.
    act(() => {
      mockCurrentUserId = 'user-B';
    });
    rerender(<Tree />);
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
  });
});
