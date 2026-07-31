/**
 * SyncStatusBanner: state derivation precedence, AC-O3 copy + pluralization,
 * machine-readable testIDs (the rendered suffix must equal bannerStateOf's
 * output — a state-name typo fails here, not on a device), a11y label = copy,
 * and the connected wrapper re-rendering off the app-wide hub.
 */
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { createPlatformRepository } from '../data/platformRepo';
import { RepositoryProvider } from '../data/RepositoryProvider';
import { IDLE_SYNC_STATE } from '../sync/engineApi';
import { syncStatusHub } from '../sync/statusHub';
import type { HubSyncState } from '../sync/statusHub';
import { ThemeProvider } from '../theme';
import {
  ConnectedSyncStatusBanner,
  SyncStatusBanner,
  bannerLabelOf,
  bannerStateOf,
} from './SyncStatusBanner';

// RepositoryProvider (pulled in by ConnectedSyncStatusBanner's `degraded`
// read) imports useAuth + platformRepo (native) + supabaseRepo at module
// scope for its account-switch rebuild. The `degraded` reactivity test below
// deliberately exercises the REAL provider (no `repository` override) so it
// observes actual provider state, not the module-level `didFallBackToOnlineOnly`
// flag — so platformRepo must be mockable per-test, and supabaseRepo/auth
// stay stubbed the same way RepositoryProvider.rekey.test.tsx /
// useReparentRedirect.test.tsx do, so the real Supabase client (which throws
// without env vars) is never reached.
jest.mock('../auth', () => ({ useAuth: () => ({ userId: 'u1' }) }));
jest.mock('../data/platformRepo', () => ({
  createPlatformRepository: jest.fn(() => Promise.resolve({ repo: {}, engine: null })),
}));
jest.mock('../data/supabaseRepo', () => ({ supabaseRepository: {} }));
// HydrationGate reads useTheme directly (not via the ThemeProvider tree) in
// its own module scope in some tests; here it's rendered under a real
// ThemeProvider so no stub is needed.

const mockCreatePlatformRepository = createPlatformRepository as jest.MockedFunction<
  typeof createPlatformRepository
>;

function wrapper({ children }: { readonly children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

const state = (over: Partial<HubSyncState> = {}): HubSyncState => ({
  ...IDLE_SYNC_STATE,
  countError: false,
  ...over,
});

/** Pulls the flattened `color` out of a rendered node's RN style array. */
function flattenColor(node: { props: { style?: unknown } }): unknown {
  const style = node.props.style;
  const styles = Array.isArray(style) ? style : [style];
  for (const s of styles) {
    if (s && typeof s === 'object' && 'color' in s) return (s as { color: unknown }).color;
  }
  return undefined;
}

describe('bannerStateOf precedence', () => {
  test('parked outranks everything', () => {
    expect(bannerStateOf(state({ parked: 1, syncing: true, countError: true, pending: 5 }))).toBe(
      'attention',
    );
  });

  test('syncing outranks countError and pending', () => {
    expect(bannerStateOf(state({ syncing: true, countError: true, pending: 5 }))).toBe('syncing');
  });

  test('countError outranks pending', () => {
    expect(bannerStateOf(state({ countError: true, pending: 5 }))).toBe('attention');
  });

  test('countError outranks lastError', () => {
    expect(bannerStateOf(state({ countError: true, lastError: 'boom' }))).toBe('attention');
  });

  test('lastError outranks pending but not syncing or countError', () => {
    expect(bannerStateOf(state({ lastError: 'boom', pending: 5 }))).toBe('attention');
    expect(bannerStateOf(state({ lastError: 'boom', syncing: true }))).toBe('syncing');
  });

  test('parked outranks lastError', () => {
    expect(bannerStateOf(state({ parked: 1, lastError: 'boom' }))).toBe('attention');
  });

  test('pending yields queued; idle yields synced', () => {
    expect(bannerStateOf(state({ pending: 2 }))).toBe('queued');
    expect(bannerStateOf(state())).toBe('synced');
  });

  // ── Task 11: degraded + offline rows, slotted parked > degraded > offline >
  // syncing > countError > lastError > pending > synced. Every case above
  // still passes `degraded` as false (the default) or omits it — none of the
  // new rows may flip a pre-existing pinned result.

  test('degraded outranks offline, syncing, countError, lastError, and pending', () => {
    expect(
      bannerStateOf(
        state({ online: false, syncing: true, countError: true, lastError: 'boom', pending: 5 }),
        true,
      ),
    ).toBe('degraded');
  });

  test('parked outranks degraded', () => {
    expect(bannerStateOf(state({ parked: 1 }), true)).toBe('attention');
  });

  test('offline (!online && pending > 0) outranks syncing, countError, lastError, and pending', () => {
    expect(
      bannerStateOf(
        state({ online: false, pending: 4, syncing: true, countError: true, lastError: 'boom' }),
      ),
    ).toBe('offline');
  });

  test('degraded outranks offline', () => {
    expect(bannerStateOf(state({ online: false, pending: 4 }), true)).toBe('degraded');
  });

  test('parked outranks offline', () => {
    expect(bannerStateOf(state({ online: false, pending: 4, parked: 1 }))).toBe('attention');
  });

  test('offline with zero pending falls through to synced (never-alarm: nothing queued, all saved)', () => {
    expect(bannerStateOf(state({ online: false, pending: 0 }))).toBe('synced');
  });

  test('online (the default/idle value) never yields offline even with pending', () => {
    expect(bannerStateOf(state({ pending: 3 }))).toBe('queued');
  });
});

describe('bannerLabelOf copy', () => {
  test('pluralizes queued at n=1 and n=2', () => {
    expect(bannerLabelOf('queued', state({ pending: 1 }))).toBe('1 change waiting to send');
    expect(bannerLabelOf('queued', state({ pending: 2 }))).toBe('2 changes waiting to send');
  });

  test('pluralizes attention at n=1 and n=2', () => {
    expect(bannerLabelOf('attention', state({ parked: 1 }))).toBe('1 change needs attention');
    expect(bannerLabelOf('attention', state({ parked: 2 }))).toBe('2 changes need attention');
  });

  test('countError attention has its own copy; synced and syncing match AC-O3', () => {
    expect(bannerLabelOf('attention', state({ countError: true }))).toBe("Can't check sync status");
    expect(bannerLabelOf('synced', state())).toBe('All saved to the cloud');
    expect(bannerLabelOf('syncing', state({ syncing: true }))).toBe('Sending…');
  });

  test('lastError attention has its own copy, distinct from countError', () => {
    expect(bannerLabelOf('attention', state({ lastError: 'boom' }))).toBe(
      'Sync problem — tap to review',
    );
  });

  test('degraded copy is exact', () => {
    expect(bannerLabelOf('degraded', state())).toBe(
      'Offline features unavailable — using online mode',
    );
  });

  test('offline copy carries the queued count, pluralized at n=1 and n=2', () => {
    expect(bannerLabelOf('offline', state({ online: false, pending: 1 }))).toBe(
      '1 change waiting to send — offline',
    );
    expect(bannerLabelOf('offline', state({ online: false, pending: 2 }))).toBe(
      '2 changes waiting to send — offline',
    );
  });
});

describe('SyncStatusBanner rendering', () => {
  const cases: readonly (readonly [HubSyncState, string])[] = [
    [state(), 'All saved to the cloud'],
    [state({ pending: 3 }), '3 changes waiting to send'],
    [state({ syncing: true }), 'Sending…'],
    [state({ parked: 2 }), '2 changes need attention'],
    [state({ countError: true }), "Can't check sync status"],
    [state({ lastError: 'boom' }), 'Sync problem — tap to review'],
    [state({ online: false, pending: 2 }), '2 changes waiting to send — offline'],
    [state({ online: false, pending: 0 }), 'All saved to the cloud'],
  ];

  test.each(cases)('renders label + machine-readable testID for %#', (s, label) => {
    render(<SyncStatusBanner syncState={s} />, { wrapper });

    // The suffix equals bannerStateOf's output — never a hand-typed name.
    expect(screen.getByTestId(`sync-status-${bannerStateOf(s)}`)).toBeTruthy();
    expect(screen.getByText(label)).toBeTruthy();
  });

  test('degraded prop renders the degraded row with muted (not attention/error) styling', () => {
    render(<SyncStatusBanner syncState={state()} degraded />, { wrapper });

    expect(screen.getByTestId('sync-status-degraded')).toBeTruthy();
    expect(screen.getByText('Offline features unavailable — using online mode')).toBeTruthy();
  });

  test('outer node carries the static testID and a11y label equal to the visible copy', () => {
    render(<SyncStatusBanner syncState={state({ pending: 1 })} />, { wrapper });

    const outer = screen.getByTestId('sync-status');
    expect(outer.props.accessibilityLabel).toBe('1 change waiting to send');
    // Live region sits on the stable outer node, not the remounting state node.
    expect(outer.props.accessibilityLiveRegion).toBe('polite');
  });

  test('offline row uses the same muted (never-alarm) color as synced, not the attention color', () => {
    const { unmount } = render(<SyncStatusBanner syncState={state({ countError: true })} />, {
      wrapper,
    });
    const attentionColor = flattenColor(screen.getByTestId('sync-status-attention'));
    unmount();

    render(<SyncStatusBanner syncState={state({ online: false, pending: 3 })} />, { wrapper });
    const offlineColor = flattenColor(screen.getByTestId('sync-status-offline'));

    expect(offlineColor).not.toBe(attentionColor);
  });

  test('is pressable via an injected onPress, and inert without one', () => {
    const onPress = jest.fn();
    const { rerender } = render(<SyncStatusBanner syncState={state()} onPress={onPress} />, {
      wrapper,
    });
    fireEvent.press(screen.getByTestId('sync-status'));
    expect(onPress).toHaveBeenCalledTimes(1);

    rerender(<SyncStatusBanner syncState={state()} />);
    // No crash pressing it with no handler attached.
    fireEvent.press(screen.getByTestId('sync-status'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('ConnectedSyncStatusBanner (useSyncStatus harness)', () => {
  afterEach(() => {
    act(() => {
      syncStatusHub.setCounter(null);
    });
  });

  test('re-renders off the app-wide hub when a recount lands', async () => {
    render(<ConnectedSyncStatusBanner />, { wrapper });
    expect(screen.getByTestId('sync-status-synced')).toBeTruthy();

    await act(async () => {
      syncStatusHub.setCounter(async () => ({ pending: 4, parked: 0 }));
      await syncStatusHub.refresh();
    });

    expect(screen.getByTestId('sync-status-queued')).toBeTruthy();
    expect(screen.getByText('4 changes waiting to send')).toBeTruthy();
  });
});

describe('ConnectedSyncStatusBanner degraded reactivity (real RepositoryProvider)', () => {
  afterEach(() => {
    mockCreatePlatformRepository.mockReset();
    mockCreatePlatformRepository.mockImplementation(() =>
      Promise.resolve({ repo: {}, engine: null } as never),
    );
  });

  test('flips to degraded once the provider CATCHES a platform-repo failure — reactive provider state, not the module flag', async () => {
    mockCreatePlatformRepository.mockRejectedValueOnce(new Error('device DB open failed'));

    render(
      <ThemeProvider>
        <RepositoryProvider>
          <ConnectedSyncStatusBanner />
        </RepositoryProvider>
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('sync-status-degraded')).toBeTruthy());
    expect(screen.getByText('Offline features unavailable — using online mode')).toBeTruthy();
  });

  test('a successful platform-repo build never shows degraded', async () => {
    render(
      <ThemeProvider>
        <RepositoryProvider>
          <ConnectedSyncStatusBanner />
        </RepositoryProvider>
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('sync-status-synced')).toBeTruthy());
    expect(screen.queryByTestId('sync-status-degraded')).toBeNull();
  });
});
