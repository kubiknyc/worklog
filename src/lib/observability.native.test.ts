/**
 * `observability.native.ts` was untested and invisible (#24 item 7): it is a
 * `.native.ts` file, so the `!src/**` negation kept it out of the coverage
 * denominator too. `engine.native.test.ts` mocks it out, which is correct for
 * that suite and means nothing anywhere exercised it.
 *
 * What is actually at stake is not "does Sentry get called". It is the
 * PRIVACY contract in the module header: no report body ever carries user
 * content — no note text, no photo bytes, no crew names. The signatures take
 * primitives so the caller decides what is safe to send, but a signature is not
 * an assertion. The `toHaveBeenCalledWith` calls below are exact, not partial:
 * adding a `mutation` or `payload` key to a capture breaks them, which is the
 * only way that regression is caught before it exfiltrates job-site data.
 *
 * The DSN is read at module load, so each scenario reloads the module.
 */
const mockInit = jest.fn();
const mockCaptureMessage = jest.fn();

jest.mock('@sentry/react-native', () => ({
  init: (...args: unknown[]) => mockInit(...args),
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
}));

/** Obviously-fake DSN — never a real project key. */
const DSN = 'https://examplekey@o0.ingest.example.test/0';

type Observability = typeof import('./observability.native');

/** Reload the module with (or without) a DSN in the environment. */
function load(dsn: string | undefined): Observability {
  jest.resetModules();
  if (dsn === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  else process.env.EXPO_PUBLIC_SENTRY_DSN = dsn;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./observability.native') as Observability;
}

const DETAIL = { kind: 'update_section', attempts: 5, errorCode: '42501', errorStatus: 403 };

const originalDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

beforeEach(() => {
  mockInit.mockClear();
  mockCaptureMessage.mockClear();
});

afterAll(() => {
  if (originalDsn === undefined) delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  else process.env.EXPO_PUBLIC_SENTRY_DSN = originalDsn;
});

describe('without a DSN', () => {
  it('initialises nothing', () => {
    load(undefined).initObservability();

    // Local dev, jest, and any build without the env set must not open a
    // transport at all — not merely drop events at the far end.
    expect(mockInit).not.toHaveBeenCalled();
  });

  it('sends nothing, even for incidents', () => {
    const o = load(undefined);
    o.initObservability();

    o.reportSyncIncident('evicted', DETAIL);
    o.reportQueueStalled(12, 90_000);

    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('sends nothing when init was never called at all', () => {
    const o = load(DSN);

    // `enabled` is set by initObservability, not by the DSN being present. A
    // report before the root layout runs must be a no-op, not a crash.
    o.reportSyncIncident('parked', DETAIL);

    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });
});

describe('initialisation with a DSN', () => {
  it('configures the SDK for breadcrumbs over traces, with PII off', () => {
    load(DSN).initObservability();

    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(mockInit.mock.calls[0][0]).toMatchObject({
      dsn: DSN,
      // The question is always "what did the queue do before it parked", never
      // "how long did it take".
      tracesSampleRate: 0,
      sendDefaultPii: false,
      maxBreadcrumbs: 30,
    });
  });

  it('wires both scrub hooks rather than leaving default breadcrumbs on', () => {
    load(DSN).initObservability();
    // Required AFTER load(): it calls resetModules, so a scrub required earlier
    // is a different instance than the one the reloaded module closed over, and
    // the identity check below would fail for a reason that isn't the bug.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const scrub = require('./observabilityScrub');
    const options = mockInit.mock.calls[0][0];

    // Default console and xhr breadcrumbs carry PostgrestError details and
    // Supabase filter values — exactly what the primitives-only signatures are
    // written to keep out of a report.
    expect(options.beforeBreadcrumb).toBe(scrub.scrubBreadcrumb);
    expect(options.beforeSend).toBe(scrub.scrubEventExtras);
  });

  it('disables native-origin auto-breadcrumbs, which the JS hooks never see', () => {
    load(DSN).initObservability();

    // The RN wrapper strips beforeBreadcrumb/beforeSend from the options handed
    // to the native SDK, so on iOS the default NSURLSession instrumentation
    // would still record Supabase REST URLs, query-string filters and all.
    // These two flags do reach the native layer.
    expect(mockInit.mock.calls[0][0]).toMatchObject({
      enableNetworkBreadcrumbs: false,
      enableAutoBreadcrumbTracking: false,
    });
  });

  it('is safe to call more than once', () => {
    const o = load(DSN);
    o.initObservability();
    o.initObservability();

    expect(mockInit).toHaveBeenCalledTimes(1);
  });
});

describe('incident reports', () => {
  function enabled(): Observability {
    const o = load(DSN);
    o.initObservability();
    mockCaptureMessage.mockClear();
    return o;
  }

  it('sends identifiers and error classes only — never user content', () => {
    enabled().reportSyncIncident('evicted', DETAIL);

    // Exact, not partial. A mutation payload added to `extra` would satisfy a
    // partial matcher, and that payload is note text, crew names, photo bytes.
    expect(mockCaptureMessage).toHaveBeenCalledWith('sync.evicted', {
      level: 'error',
      tags: { mutationKind: 'update_section', errorCode: '42501', errorStatus: '403' },
      extra: { attempts: 5 },
    });
  });

  it('rates an eviction as an error and a park as a warning', () => {
    const o = enabled();

    o.reportSyncIncident('parked', DETAIL);
    o.reportSyncIncident('evicted', DETAIL);

    // Eviction DROPS the local row — the user's record is gone. Parking leaves
    // it on device, recoverable. They must not page the same way.
    expect(mockCaptureMessage.mock.calls.map((c) => [c[0], c[1].level])).toEqual([
      ['sync.parked', 'warning'],
      ['sync.evicted', 'error'],
    ]);
  });

  it('substitutes placeholders for a failure that carried no code or status', () => {
    enabled().reportSyncIncident('parked', { kind: 'create_report', attempts: 1 });

    // Sentry drops undefined tag values silently, which would make these
    // incidents unsearchable rather than visibly code-less.
    expect(mockCaptureMessage).toHaveBeenCalledWith('sync.parked', {
      level: 'warning',
      tags: { mutationKind: 'create_report', errorCode: 'none', errorStatus: '0' },
      extra: { attempts: 1 },
    });
  });
});

describe('stall reports', () => {
  it('reports depth and age, the aggregate signal individual incidents miss', () => {
    const o = load(DSN);
    o.initObservability();
    mockCaptureMessage.mockClear();

    o.reportQueueStalled(12, 90_000);

    expect(mockCaptureMessage).toHaveBeenCalledWith('sync.stalled', {
      level: 'error',
      extra: { depth: 12, oldestAgeMs: 90_000 },
    });
  });
});
