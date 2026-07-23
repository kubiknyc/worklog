/**
 * useSectionDraft — autosave semantics: optimistic local state, one debounced
 * write per burst carrying the LAST payload, flush on dismiss and on unmount,
 * markComplete writing the completeness flag through, and nothing written
 * after unmount.
 *
 * `useRepository` is mocked rather than driven through a real
 * RepositoryProvider: the provider module statically pulls in the Supabase
 * client, which throws without EXPO_PUBLIC_* env vars in CI.
 */
import { act, renderHook } from '@testing-library/react-native';

import type { Repository } from '../../data/types';

// `mock`-prefixed so Jest allows referencing it inside the factory.
let mockRepo: Repository;

jest.mock('../../data', () => ({ useRepository: () => mockRepo }));

// eslint-disable-next-line import/first
import { SECTION_DRAFT_DEBOUNCE_MS, useSectionDraft } from './useSectionDraft';

type Content = { readonly count: number };

let updateSection: jest.Mock;

function installRepo(): void {
  updateSection = jest.fn().mockResolvedValue(undefined);
  mockRepo = { updateSection } as unknown as Repository;
}

function setup(initial: Content = { count: 0 }) {
  return renderHook(() => useSectionDraft<Content>('r1', 'crew', initial));
}

/** Advance past the debounce and let the queued write's promise chain settle. */
async function settle(ms = SECTION_DRAFT_DEBOUNCE_MS) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  installRepo();
});
afterEach(() => jest.useRealTimers());

test('setDraft updates local state immediately, before any write', () => {
  const { result } = setup();
  act(() => result.current.setDraft({ count: 3 }));
  expect(result.current.draft).toEqual({ count: 3 });
  expect(updateSection).not.toHaveBeenCalled();
});

test('three rapid edits coalesce into one write carrying the last payload', async () => {
  const { result } = setup();

  act(() => {
    result.current.setDraft({ count: 1 });
    result.current.setDraft({ count: 2 });
    result.current.setDraft({ count: 3 });
  });
  // Still inside the debounce window.
  await settle(SECTION_DRAFT_DEBOUNCE_MS - 1);
  expect(updateSection).not.toHaveBeenCalled();

  await settle(1);
  expect(updateSection).toHaveBeenCalledTimes(1);
  expect(updateSection).toHaveBeenCalledWith('r1', 'crew', { count: 3 }, false);
});

test('flush() writes the pending tail immediately and is idempotent', async () => {
  const { result } = setup();
  act(() => result.current.setDraft({ count: 7 }));

  await act(async () => {
    result.current.flush();
  });
  expect(updateSection).toHaveBeenCalledTimes(1);
  expect(updateSection).toHaveBeenCalledWith('r1', 'crew', { count: 7 }, false);

  // Nothing pending → no second write, and no timer is left to fire either.
  await act(async () => {
    result.current.flush();
  });
  await settle();
  expect(updateSection).toHaveBeenCalledTimes(1);
});

test('unmount flushes the pending tail edit', async () => {
  const { result, unmount } = setup();
  act(() => result.current.setDraft({ count: 9 }));
  expect(updateSection).not.toHaveBeenCalled();

  await act(async () => {
    unmount();
  });
  expect(updateSection).toHaveBeenCalledTimes(1);
  expect(updateSection).toHaveBeenCalledWith('r1', 'crew', { count: 9 }, false);
});

test('no write is issued after unmount when nothing was pending', async () => {
  const { result, unmount } = setup();
  act(() => result.current.setDraft({ count: 4 }));
  await settle();
  expect(updateSection).toHaveBeenCalledTimes(1);

  await act(async () => {
    unmount();
  });
  await settle();
  expect(updateSection).toHaveBeenCalledTimes(1);
});

test('markComplete writes through with the completeness flag', async () => {
  const { result } = setup();
  await act(async () => {
    result.current.markComplete(true);
  });
  expect(updateSection).toHaveBeenCalledTimes(1);
  expect(updateSection).toHaveBeenCalledWith('r1', 'crew', { count: 0 }, true);

  // The flag sticks for subsequent autosaves.
  act(() => result.current.setDraft({ count: 5 }));
  await settle();
  expect(updateSection).toHaveBeenLastCalledWith('r1', 'crew', { count: 5 }, true);
});

test('markComplete cancels a pending debounce instead of double-writing', async () => {
  const { result } = setup();
  act(() => result.current.setDraft({ count: 2 }));
  await act(async () => {
    result.current.markComplete(true);
  });
  await settle();
  expect(updateSection).toHaveBeenCalledTimes(1);
  expect(updateSection).toHaveBeenCalledWith('r1', 'crew', { count: 2 }, true);
});

test('a slow in-flight write cannot clobber a newer one', async () => {
  let releaseFirst!: () => void;
  updateSection.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }),
  );
  const { result } = setup();

  act(() => result.current.setDraft({ count: 1 }));
  await settle(); // first write starts and hangs

  act(() => result.current.setDraft({ count: 2 }));
  await settle(); // second write is queued behind the first

  expect(updateSection).toHaveBeenCalledTimes(1);

  await act(async () => {
    releaseFirst();
  });

  // The second write runs only after the first settled — order is preserved
  // and the newest payload is the one that lands last.
  expect(updateSection).toHaveBeenCalledTimes(2);
  expect(updateSection).toHaveBeenLastCalledWith('r1', 'crew', { count: 2 }, false);
});

test('a failed write is logged, not thrown, and the draft survives', async () => {
  updateSection.mockRejectedValue(new Error('boom'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const { result } = setup();

  act(() => result.current.setDraft({ count: 1 }));
  await settle();

  expect(warn).toHaveBeenCalled();
  expect(result.current.draft).toEqual({ count: 1 });
  warn.mockRestore();
});
