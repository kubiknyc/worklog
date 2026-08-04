/**
 * Remote error reporting for the sync engine — native implementation.
 *
 * Why this exists: a sync failure in the field is invisible. The user is
 * offline, there is no console, there is no reproduction, and what is at stake
 * is their evidence — photos and observations from a job site they have left.
 * A mutation that parks or evicts is a silent data-loss event unless something
 * carries it off the device.
 *
 * DSN-optional by design. With `EXPO_PUBLIC_SENTRY_DSN` unset — local dev,
 * jest, any build without the env set — every function here is a no-op and
 * nothing is sent. Set the DSN per build profile in `eas.json` once the Sentry
 * project exists.
 *
 * Native-only: `@sentry/react-native` is registered in `NATIVE_ONLY_MODULES`
 * (`src/platformSplit.test.ts`). The web bundle resolves `observability.web.ts`
 * instead, whose functions are inert.
 *
 * This module is the IO shell. It must never be imported by `src/sync/` or
 * `src/db/`: those are pure by design, `mutationQueue.ts` is pinned at 100%
 * coverage, and a side effect in either would break both properties. The sync
 * engine (`engine.native.ts`, M3) is the composition root that calls these.
 */
import * as Sentry from '@sentry/react-native';

import { scrubBreadcrumb, scrubEventExtras } from './observabilityScrub';
import type { SyncIncident, SyncIncidentDetail } from './observabilityTypes';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;

/** True once a DSN was supplied and `initObservability` has run. */
let enabled = false;

/**
 * Initialise remote reporting. Safe to call when no DSN is configured; safe to
 * call more than once. Call once from the root layout, before render.
 */
export function initObservability(): void {
  if (enabled || !DSN) {
    return;
  }
  Sentry.init({
    dsn: DSN,
    // Breadcrumbs matter more than traces here: the question is always "what
    // did the queue do before it parked", not "how long did it take".
    tracesSampleRate: 0,
    sendDefaultPii: false,
    maxBreadcrumbs: 30,
    // See observabilityScrub.ts: the SDK's default console and xhr breadcrumbs
    // would carry PostgrestError details and Supabase filter values off the
    // device, which is exactly the content the primitives-only signatures below
    // are written to keep out of a report.
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend: scrubEventExtras,
    // THE TWO HOOKS ABOVE NEVER RUN ON NATIVE-ORIGIN CRUMBS. The RN wrapper
    // strips `beforeBreadcrumb` and `beforeSend` from the options handed to the
    // native SDK, then concatenates native-origin breadcrumbs onto every event.
    // On iOS the default NSURLSession instrumentation would still record
    // Supabase REST URLs, query-string filter values and all. These two flags
    // do reach the native layer and stop those crumbs being created at all.
    //
    // They are cast because neither key is in ReactNativeOptions, and they are
    // INERT ON ANDROID — the Android module parses options key by key and
    // handles neither, so it keeps sentry-android's auto-breadcrumbs (taps,
    // lifecycle, connectivity). Those are UI/device metadata rather than user
    // content, and Android does not auto-instrument OkHttp so no Supabase URLs
    // are captured — but it is a real gap. Closing it needs io.sentry.
    // breadcrumbs.* manifest meta-data via a config plugin.
    ...({
      enableNetworkBreadcrumbs: false,
      enableAutoBreadcrumbTracking: false,
    } as Record<string, unknown>),
  });
  enabled = true;
}

/**
 * Report a mutation leaving the queue without being applied.
 *
 * `parked` — the retry ceiling was reached, or the server rejected it
 * permanently. The row is still on device but will not be retried.
 * `evicted` — the server refused it as unauthorised (RLS/403). The local row
 * is dropped.
 *
 * Both are data the user believes they recorded. Neither should be silent.
 *
 * Takes primitives rather than a `Mutation` so the caller decides what is safe
 * to send: no report body ever carries user content — no note text, no photo
 * bytes, no crew names. Identifiers and error classes only.
 */
export function reportSyncIncident(incident: SyncIncident, detail: SyncIncidentDetail): void {
  if (!enabled) {
    return;
  }
  Sentry.captureMessage(`sync.${incident}`, {
    level: incident === 'evicted' ? 'error' : 'warning',
    tags: {
      mutationKind: detail.kind,
      errorCode: detail.errorCode ?? 'none',
      errorStatus: String(detail.errorStatus ?? 0),
    },
    extra: { attempts: detail.attempts },
  });
}

/**
 * Report a queue that is not draining — the aggregate signal individual
 * incidents miss. Call from the engine when a drain pass ends with a backlog
 * that did not shrink.
 */
export function reportQueueStalled(depth: number, oldestAgeMs: number): void {
  if (!enabled) {
    return;
  }
  Sentry.captureMessage('sync.stalled', {
    level: 'error',
    extra: { depth, oldestAgeMs },
  });
}
