/**
 * SyncQueueScreen: never-alarm row copy (raw lastError is never rendered),
 * the object-shape `isLikelyOffline` call, retry-visible-when-parked, discard
 * confirm copy (create_report states the subtree removal), the discard
 * guard-win notice on a 0-affected result, and the web empty-queue copy.
 */
import type { ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { Mutation } from '../sync/types';
import { ThemeProvider } from '../theme';
import { SyncQueueScreen, confirmMessageOf, kindLabelOf, rowDetailOf } from './SyncQueueScreen';

function wrapper({ children }: { readonly children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

function mutation(over: Partial<Mutation> = {}): Mutation {
  return {
    clientId: 'm-1',
    payload: { kind: 'update_section', data: {} as never },
    createdAt: '2026-07-29T00:00:00.000Z',
    attempts: 0,
    status: 'pending',
    lastError: null,
    revision: 0,
    ...over,
  };
}

const noop = () => {};
const noopDiscard = () => Promise.resolve(0);

describe('kindLabelOf', () => {
  test('maps every mutation kind to plain language', () => {
    expect(kindLabelOf('create_report')).toBe('New report');
    expect(kindLabelOf('update_section')).toBe('Section update');
    expect(kindLabelOf('submit_report')).toBe('Report submitted');
    expect(kindLabelOf('lock_report')).toBe('Report locked');
    expect(kindLabelOf('create_amendment')).toBe('Amendment');
    expect(kindLabelOf('add_photo')).toBe('Photo');
    expect(kindLabelOf('update_photo_meta')).toBe('Photo details');
    expect(kindLabelOf('remove_photo')).toBe('Photo removed');
  });
});

describe('rowDetailOf never-alarm mapping', () => {
  test('parked always reads "needs your attention", regardless of lastError', () => {
    expect(rowDetailOf(mutation({ status: 'parked', lastError: 'TypeError: Network request failed' }))).toBe(
      "Couldn't send — needs your attention",
    );
  });

  test('a pending row with an offline-shaped lastError reads "Waiting for connection"', () => {
    expect(
      rowDetailOf(mutation({ status: 'pending', lastError: 'TypeError: Network request failed' })),
    ).toBe('Waiting for connection');
    expect(rowDetailOf(mutation({ status: 'pending', lastError: 'Failed to fetch' }))).toBe(
      'Waiting for connection',
    );
  });

  test('a pending row with another error reads "Will retry automatically"', () => {
    expect(rowDetailOf(mutation({ status: 'pending', lastError: '23505 duplicate key' }))).toBe(
      'Will retry automatically',
    );
  });

  test('a pending row with no error reads "Waiting to send"', () => {
    expect(rowDetailOf(mutation({ status: 'pending', lastError: null }))).toBe('Waiting to send');
  });
});

describe('confirmMessageOf', () => {
  test('create_report states the queued subtree is removed', () => {
    expect(confirmMessageOf('create_report')).toBe(
      'This removes the report and its changes from this device.',
    );
  });

  test('every other kind states the change stays on-device only', () => {
    for (const kind of [
      'update_section',
      'submit_report',
      'lock_report',
      'create_amendment',
      'add_photo',
      'update_photo_meta',
      'remove_photo',
    ] as const) {
      expect(confirmMessageOf(kind)).toBe('This change stays on this device only.');
    }
  });
});

describe('SyncQueueScreen rendering', () => {
  test('renders the screen root testID', () => {
    render(
      <SyncQueueScreen rows={[]} isWeb={false} onRetry={noop} onDiscard={noopDiscard} onNotice={noop} />,
      { wrapper },
    );
    expect(screen.getByTestId('sync-queue-screen')).toBeTruthy();
  });

  test('native empty queue shows the empty state, not the web copy', () => {
    render(
      <SyncQueueScreen rows={[]} isWeb={false} onRetry={noop} onDiscard={noopDiscard} onNotice={noop} />,
      { wrapper },
    );
    expect(screen.getByText('Nothing queued')).toBeTruthy();
    expect(screen.queryByText('Sync runs automatically while online')).toBeNull();
  });

  test('web empty queue shows "Sync runs automatically while online"', () => {
    render(
      <SyncQueueScreen rows={[]} isWeb onRetry={noop} onDiscard={noopDiscard} onNotice={noop} />,
      { wrapper },
    );
    expect(screen.getByText('Sync runs automatically while online')).toBeTruthy();
  });

  test('renders one row per mutation with its clientId testID and never the raw lastError', () => {
    const rawError = 'TypeError: Network request failed';
    const rows = [
      mutation({ clientId: 'a', status: 'pending', lastError: rawError }),
      mutation({ clientId: 'b', status: 'parked', lastError: rawError }),
    ];
    render(
      <SyncQueueScreen rows={rows} isWeb={false} onRetry={noop} onDiscard={noopDiscard} onNotice={noop} />,
      { wrapper },
    );
    expect(screen.getByTestId('sync-queue-row-a')).toBeTruthy();
    expect(screen.getByTestId('sync-queue-row-b')).toBeTruthy();
    expect(screen.queryByText(rawError)).toBeNull();
  });

  test('retry button is hidden with no parked rows and visible with at least one', () => {
    const { rerender } = render(
      <SyncQueueScreen
        rows={[mutation({ status: 'pending' })]}
        isWeb={false}
        onRetry={noop}
        onDiscard={noopDiscard}
        onNotice={noop}
      />,
      { wrapper },
    );
    expect(screen.queryByTestId('sync-queue-retry')).toBeNull();

    rerender(
      <SyncQueueScreen
        rows={[mutation({ status: 'parked' })]}
        isWeb={false}
        onRetry={noop}
        onDiscard={noopDiscard}
        onNotice={noop}
      />,
    );
    expect(screen.getByTestId('sync-queue-retry')).toBeTruthy();
  });

  test('pressing retry calls onRetry', () => {
    const onRetry = jest.fn();
    render(
      <SyncQueueScreen
        rows={[mutation({ status: 'parked' })]}
        isWeb={false}
        onRetry={onRetry}
        onDiscard={noopDiscard}
        onNotice={noop}
      />,
      { wrapper },
    );
    fireEvent.press(screen.getByTestId('sync-queue-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('only parked rows expose a Discard button', () => {
    const rows = [mutation({ clientId: 'a', status: 'pending' }), mutation({ clientId: 'b', status: 'parked' })];
    render(
      <SyncQueueScreen rows={rows} isWeb={false} onRetry={noop} onDiscard={noopDiscard} onNotice={noop} />,
      { wrapper },
    );
    expect(screen.queryByTestId('sync-queue-discard-a')).toBeNull();
    expect(screen.getByTestId('sync-queue-discard-b')).toBeTruthy();
  });

  test('discard flow: confirming calls onDiscard(clientId) and a 0-affected result shows the guard-win notice', async () => {
    const onDiscard = jest.fn().mockResolvedValue(0);
    const onNotice = jest.fn();
    render(
      <SyncQueueScreen
        rows={[mutation({ clientId: 'p1', status: 'parked' })]}
        isWeb={false}
        onRetry={noop}
        onDiscard={onDiscard}
        onNotice={onNotice}
      />,
      { wrapper },
    );

    fireEvent.press(screen.getByTestId('sync-queue-discard-p1'));
    expect(screen.getByText('This change stays on this device only.')).toBeTruthy();

    // Two "Discard" texts are on screen once the confirm sheet opens: the
    // row's own Discard pressable, and the confirm sheet's confirm button —
    // the confirm sheet's is declared last, so it renders last.
    await act(async () => {
      const discardTexts = screen.getAllByText('Discard');
      fireEvent.press(discardTexts[discardTexts.length - 1]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onDiscard).toHaveBeenCalledWith('p1');
    expect(onNotice).toHaveBeenCalledWith(
      'This change was just updated — it no longer needs attention',
    );
  });

  test('a create_report discard confirm states the queued subtree is removed', () => {
    render(
      <SyncQueueScreen
        rows={[
          mutation({
            clientId: 'cr1',
            status: 'parked',
            payload: { kind: 'create_report', data: {} as never },
          }),
        ]}
        isWeb={false}
        onRetry={noop}
        onDiscard={noopDiscard}
        onNotice={noop}
      />,
      { wrapper },
    );
    fireEvent.press(screen.getByTestId('sync-queue-discard-cr1'));
    expect(
      screen.getByText('This removes the report and its changes from this device.'),
    ).toBeTruthy();
  });

  test('a successful discard (affected > 0) does not show the guard-win notice', async () => {
    const onDiscard = jest.fn().mockResolvedValue(1);
    const onNotice = jest.fn();
    render(
      <SyncQueueScreen
        rows={[mutation({ clientId: 'p1', status: 'parked' })]}
        isWeb={false}
        onRetry={noop}
        onDiscard={onDiscard}
        onNotice={onNotice}
      />,
      { wrapper },
    );

    fireEvent.press(screen.getByTestId('sync-queue-discard-p1'));
    await act(async () => {
      const discardTexts = screen.getAllByText('Discard');
      fireEvent.press(discardTexts[discardTexts.length - 1]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onDiscard).toHaveBeenCalledWith('p1');
    expect(onNotice).not.toHaveBeenCalled();
  });
});
