/**
 * Test helpers for the section sheets (#21).
 *
 * Two problems these solve, both of which made green test runs untrustworthy:
 *
 * 1. **Real timers under a 1000ms `waitFor`.** The autosave debounce is 400ms
 *    (`SECTION_DRAFT_DEBOUNCE_MS`), and RTL-RN's `asyncUtilTimeout` default is
 *    1000ms. That left ~550ms for the debounce, a re-render, and a two-link
 *    promise chain — across dozens of suites in parallel workers. The result was
 *    nondeterministic CI red with no code change behind it. Driving the clock
 *    instead of racing it makes the wait exact.
 *
 * 2. **`expect.anything()` payload assertions.** Nine of ten sheet tests
 *    asserted only the report id, section and completeness flag, so a stale
 *    closure writing an empty list — the user's entry silently never persisting
 *    — stayed green. Exact payloads need deterministic ids, so each sheet test
 *    stubs `../../lib/uuid` with a counter (inline, because `jest.mock`
 *    factories are hoisted above imports and must not close over module scope).
 */
import { act } from '@testing-library/react-native';

import { SECTION_DRAFT_DEBOUNCE_MS } from './useSectionDraft';

/**
 * Advance past the autosave debounce and drain the promise chain the timer
 * callback starts (`issueWrite` chains through a Promise, which fake timers do
 * not flush on their own).
 *
 * Requires `jest.useFakeTimers()` — call `withFakeTimers` to get both.
 */
export async function flushSectionDraft(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(SECTION_DRAFT_DEBOUNCE_MS);
  });
}

/**
 * Run a test body on fake timers, restoring real ones even if it throws.
 *
 * Restoring matters: a suite that leaves fake timers installed makes every
 * later test in the file wait on a clock nobody advances.
 */
export async function withFakeTimers(body: () => Promise<void>): Promise<void> {
  jest.useFakeTimers();
  try {
    await body();
  } finally {
    jest.useRealTimers();
  }
}
