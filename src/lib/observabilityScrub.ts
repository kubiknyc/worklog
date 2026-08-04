/**
 * Pure scrubbers applied to every outbound Sentry payload.
 *
 * `sendDefaultPii: false` governs what the SDK *infers* about the user. It does
 * nothing about breadcrumbs, which the SDK attaches to every event with
 * `console: true` and `xhr: true` on by default. Two of those defaults carry
 * user content off the device:
 *
 * - `console` — this codebase logs PostgrestError objects, and PostgREST puts
 *   the offending value in `.details`: a unique violation reads
 *   `Key (email)=(someone@example.com) already exists`.
 * - `xhr` — Supabase REST filters travel in the query string, so request URLs
 *   embed the values being matched on. For an app whose whole subject is which
 *   crew was on which job site, that is the payload, not metadata.
 *
 * The stakes here are higher than in a normal app. `observability.native.ts`
 * reports on the sync queue — mutations that park or evict — so it fires
 * precisely when the device is holding unsynced field data. A report that
 * carries the row values along with the failure defeats the point of taking
 * primitives-only arguments everywhere else in that module.
 *
 * This lives in its own DSN-free, Sentry-free module for two reasons: it can be
 * unit-tested without a device (`observability.native.ts` is excluded from
 * coverage by the `!src/**\/*.native.ts` rule in package.json), and it stays out
 * of `NATIVE_ONLY_MODULES` in src/platformSplit.test.ts because it imports
 * nothing native. Keep it free of `@sentry/react-native` imports — the types
 * below are structural on purpose.
 */

/**
 * Breadcrumb categories permitted to leave the device.
 *
 * This is an ALLOWLIST, not a denylist. A denylist fails open on every category
 * a future SDK version introduces — and `navigation` in particular would ship a
 * screen-by-screen trail of the user's session, which is not something this app
 * has any reason to collect.
 *
 * The two kept entries are SDK-internal links between an event and the crumb
 * that produced it. They carry no user content.
 */
const ALLOWED_BREADCRUMB_CATEGORIES: ReadonlySet<string> = new Set([
  'sentry.event',
  'sentry.transaction',
]);

/** Returns null to drop the breadcrumb. Wired to `beforeBreadcrumb`. */
export function scrubBreadcrumb<T extends { category?: string }>(breadcrumb: T): T | null {
  const category = breadcrumb.category;
  if (category === undefined || !ALLOWED_BREADCRUMB_CATEGORIES.has(category)) {
    return null;
  }
  return breadcrumb;
}

/**
 * Strip the serialized copy of a non-Error thrown value.
 *
 * `scrubBreadcrumb` guards only one door. When a plain object — a raw
 * PostgrestError, say — reaches `captureException`, @sentry/core's eventBuilder
 * attaches the whole thing as `extra.__serialized__`. So `.details`, the very
 * `Key (email)=(...) already exists` string the breadcrumb allowlist blocks,
 * would ship anyway from the line right below the log call.
 *
 * Explicit tags set by `reportSyncIncident` are unaffected: `errorCode` and
 * `errorStatus` name the failure class, never the row.
 */
export function scrubEventExtras<T extends { extra?: Record<string, unknown> }>(event: T): T {
  if (!event.extra || !('__serialized__' in event.extra)) {
    return event;
  }
  const extra = { ...event.extra };
  delete extra.__serialized__;
  return { ...event, extra };
}
