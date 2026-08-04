import { scrubBreadcrumb, scrubEventExtras } from './observabilityScrub';

describe('scrubBreadcrumb', () => {
  it.each([
    ['console', 'the PostgrestError details string this codebase logs'],
    ['xhr', 'Supabase REST URLs with filter values in the query string'],
    ['fetch', 'same as xhr on the web build'],
    ['navigation', 'a screen-by-screen trail of the session'],
    ['touch', 'a component path per tap'],
    ['ui.click', 'the native-side equivalent of touch'],
    ['http', 'a category no denylist would have known to name'],
  ])('drops the %s category (%s)', (category) => {
    expect(scrubBreadcrumb({ category })).toBeNull();
  });

  it('drops a breadcrumb with no category at all', () => {
    expect(scrubBreadcrumb({})).toBeNull();
    expect(scrubBreadcrumb({ category: undefined })).toBeNull();
  });

  it.each(['sentry.event', 'sentry.transaction'])('keeps the %s category', (category) => {
    expect(scrubBreadcrumb({ category })).toEqual({ category });
  });

  it('returns the breadcrumb it was given, not a copy', () => {
    // The SDK is free to hold a reference; cloning here would silently drop any
    // field the caller set after construction.
    const breadcrumb = { category: 'sentry.event', message: 'kept' };
    expect(scrubBreadcrumb(breadcrumb)).toBe(breadcrumb);
  });

  it('is an allowlist, so an unknown future category defaults to dropped', () => {
    expect(scrubBreadcrumb({ category: 'some.category.invented.in.sdk.v9' })).toBeNull();
  });
});

describe('scrubEventExtras', () => {
  it('removes __serialized__ and keeps everything else in extra', () => {
    const event = {
      extra: {
        __serialized__: { details: 'Key (email)=(someone@example.com) already exists' },
        attempts: 5,
      },
    };
    expect(scrubEventExtras(event)).toEqual({ extra: { attempts: 5 } });
  });

  it('does not mutate the event it was given', () => {
    const event = { extra: { __serialized__: { details: 'leaky' }, attempts: 5 } };
    scrubEventExtras(event);
    expect(event.extra.__serialized__).toEqual({ details: 'leaky' });
  });

  it('leaves an event with no extra untouched', () => {
    // Annotated, not inferred: `{ extra?: … }` is a weak type, so an argument
    // with no key in common with it trips TS2559 (`no properties in common`)
    // even though the property is optional. The annotation states the intent —
    // an event that legitimately carries no `extra` at all.
    const event: { message: string; extra?: Record<string, unknown> } = {
      message: 'sync.stalled',
    };
    expect(scrubEventExtras(event)).toBe(event);
  });

  it('leaves an extra that carries no __serialized__ untouched', () => {
    const event = { extra: { depth: 12, oldestAgeMs: 900_000 } };
    expect(scrubEventExtras(event)).toBe(event);
  });

  it('preserves sibling keys when extra holds only __serialized__', () => {
    expect(scrubEventExtras({ extra: { __serialized__: { a: 1 } } })).toEqual({ extra: {} });
  });

  it('keeps the tags reportSyncIncident sets, which live outside extra', () => {
    const event = {
      tags: { mutationKind: 'report.update', errorCode: '23505' },
      extra: { __serialized__: { details: 'leaky' }, attempts: 3 },
    };
    expect(scrubEventExtras(event)).toEqual({
      tags: { mutationKind: 'report.update', errorCode: '23505' },
      extra: { attempts: 3 },
    });
  });
});
