/**
 * SyncStatusBanner: state derivation precedence, AC-O3 copy + pluralization,
 * machine-readable testIDs (the rendered suffix must equal bannerStateOf's
 * output — a state-name typo fails here, not on a device), a11y label = copy,
 * and the connected wrapper re-rendering off the app-wide hub.
 */
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

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

function wrapper({ children }: { readonly children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

const state = (over: Partial<HubSyncState> = {}): HubSyncState => ({
  ...IDLE_SYNC_STATE,
  countError: false,
  ...over,
});

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
});

describe('SyncStatusBanner rendering', () => {
  const cases: readonly (readonly [HubSyncState, string])[] = [
    [state(), 'All saved to the cloud'],
    [state({ pending: 3 }), '3 changes waiting to send'],
    [state({ syncing: true }), 'Sending…'],
    [state({ parked: 2 }), '2 changes need attention'],
    [state({ countError: true }), "Can't check sync status"],
    [state({ lastError: 'boom' }), 'Sync problem — tap to review'],
  ];

  test.each(cases)('renders label + machine-readable testID for %#', (s, label) => {
    render(<SyncStatusBanner syncState={s} />, { wrapper });

    // The suffix equals bannerStateOf's output — never a hand-typed name.
    expect(screen.getByTestId(`sync-status-${bannerStateOf(s)}`)).toBeTruthy();
    expect(screen.getByText(label)).toBeTruthy();
  });

  test('outer node carries the static testID and a11y label equal to the visible copy', () => {
    render(<SyncStatusBanner syncState={state({ pending: 1 })} />, { wrapper });

    const outer = screen.getByTestId('sync-status');
    expect(outer.props.accessibilityLabel).toBe('1 change waiting to send');
    // Live region sits on the stable outer node, not the remounting state node.
    expect(outer.props.accessibilityLiveRegion).toBe('polite');
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
