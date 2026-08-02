/**
 * EAS profile / demo-login coherence guard (#16).
 *
 * Demo logins are gated on `__DEV__ && EXPO_PUBLIC_DEMO_LOGINS !== 'off'`
 * (`app/(auth)/login.tsx`). The `__DEV__` half is deliberate — it lets Metro
 * dead-code-eliminate the demo password literal and account list out of
 * production bundles regardless of env configuration, so it must NOT be
 * relaxed.
 *
 * The consequence is that a profile can look correct and still be impossible:
 * `e2e-test` set `EXPO_PUBLIC_DEMO_LOGINS=on` but omitted `developmentClient`,
 * so `__DEV__` was false, the `&&` short-circuited, and both Maestro flows could
 * never pass. Nothing failed locally — the cost landed twenty minutes into a
 * cloud build, the most expensive place to learn it.
 *
 * This turns that silent impossibility into a `npm run verify` failure.
 */
import * as fs from 'fs';
import * as path from 'path';

interface BuildProfile {
  readonly developmentClient?: boolean;
  readonly env?: Record<string, string>;
}

const root = process.cwd();
const easJson = JSON.parse(fs.readFileSync(path.join(root, 'eas.json'), 'utf8')) as {
  build: Record<string, BuildProfile>;
};

const LOGIN_SCREEN = path.join('app', '(auth)', 'login.tsx');

describe('eas build profiles', () => {
  it('parses eas.json and finds profiles to check', () => {
    // Anti-vacuity: an empty or restructured build block must fail loudly
    // rather than let every assertion below iterate nothing.
    expect(Object.keys(easJson.build).length).toBeGreaterThan(2);
  });

  it('the demo-login gate still depends on __DEV__ and the env var', () => {
    // If this drifts, the coherence rule below is checking a gate that no
    // longer exists — the guard would keep passing while protecting nothing.
    const source = fs.readFileSync(path.join(root, LOGIN_SCREEN), 'utf8');
    expect(source).toContain('__DEV__');
    expect(source).toContain('EXPO_PUBLIC_DEMO_LOGINS');
  });

  it('every profile enabling demo logins also builds a dev client', () => {
    const incoherent: string[] = [];

    for (const [name, profile] of Object.entries(easJson.build)) {
      if (profile.env?.EXPO_PUBLIC_DEMO_LOGINS !== 'on') continue;
      if (profile.developmentClient === true) continue;
      incoherent.push(
        `eas.json build.${name} sets EXPO_PUBLIC_DEMO_LOGINS=on but not ` +
          `developmentClient:true — __DEV__ is false in that build, so the gate in ` +
          `${LOGIN_SCREEN} short-circuits and demo logins never render.`,
      );
    }

    expect(incoherent).toEqual([]);
  });

  it('no shipping profile leaves demo logins on', () => {
    for (const name of ['preview', 'production']) {
      expect(easJson.build[name]?.env?.EXPO_PUBLIC_DEMO_LOGINS).toBe('off');
    }
  });
});
