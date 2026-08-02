/**
 * Platform-split guard (work plan §C.3, risk #8): a static import of a
 * native-only module from any file in the web bundle graph breaks `expo export
 * --platform web` — Metro resolves imports regardless of Platform.OS branches.
 * Only `*.native.ts(x)` files (excluded from the web graph by Metro's platform
 * resolution) may import these modules. Extend NATIVE_ONLY_MODULES as native
 * deps are added (expo-camera, expo-print, ... in later milestones).
 */
import * as fs from 'fs';
import * as path from 'path';

const NATIVE_ONLY_MODULES = [
  'expo-sqlite',
  '@sentry/react-native',
  'expo-updates',
  '@react-native-community/netinfo',
  'react-native-signature-canvas',
  'react-native-webview',
];
const SCAN_ROOTS = ['src', 'app'];
const SOURCE_RE = /\.(ts|tsx)$/;
const NATIVE_RE = /\.native\.(ts|tsx)$/;
// Test files never enter the web bundle — `expo export --platform web` does not
// resolve them — and they legitimately contain native module names as fixture
// strings (this file included). Scanning them produces false positives only.
const TEST_RE = /\.test\.(ts|tsx)$/;

/**
 * Every import form Metro resolves — not just the two the original guard knew.
 *
 * The old pattern was `(from\s+|require\()['"]mod`, which sees
 * `import x from 'mod'` and `require('mod')` but is blind to a bare
 * side-effect import (`import 'mod';`) and to a dynamic `import('mod')`. Both
 * pull the module into the web graph exactly as hard, and the side-effect form
 * is the *likeliest* way a polyfill or native SDK gets wired in —
 * `src/supabase/client.ts` already uses it for `react-native-url-polyfill/auto`.
 *
 * The `(?:/[^'"]*)?` tail catches deep imports (`expo-sqlite/next`), which the
 * old prefix match caught only by accident of having no closing quote anchor.
 *
 * Exported so the detector is itself under test: a guard whose matcher is never
 * exercised can pass while the thing it protects is broken (#15).
 */
export function importRegexFor(mod: string): RegExp {
  const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?:\\bfrom\\s+|\\brequire\\s*\\(\\s*|\\bimport\\s*\\(\\s*|\\bimport\\s+)` +
      `['"]${escaped}(?:/[^'"]*)?['"]`,
    'm',
  );
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return SOURCE_RE.test(entry.name) ? [full] : [];
  });
}

describe('platform split', () => {
  // The detector under test. Without these, the suite below can only prove
  // "nothing matched" — which is also what a broken matcher produces (#15).
  describe('importRegexFor catches every form Metro resolves', () => {
    const mod = 'expo-sqlite';

    it.each([
      ['default import', `import db from 'expo-sqlite';`],
      ['named import', `import { openDatabaseSync } from 'expo-sqlite';`],
      ['re-export', `export { x } from 'expo-sqlite';`],
      ['require', `const db = require('expo-sqlite');`],
      ['require with spaces', `const db = require( 'expo-sqlite' );`],
      ['bare side-effect import', `import 'expo-sqlite';`],
      ['dynamic import', `const db = await import('expo-sqlite');`],
      ['deep import', `import x from 'expo-sqlite/next';`],
      ['double quotes', `import db from "expo-sqlite";`],
    ])('matches a %s', (_label, source) => {
      expect(importRegexFor(mod).test(source)).toBe(true);
    });

    it.each([
      ['a substring of a longer package', `import x from 'expo-sqlite-mock';`],
      ['a mention inside a comment string', `// we deliberately avoid expo-sqlite here`],
      ['a same-named local path', `import x from './expo-sqlite';`],
    ])('does not match %s', (_label, source) => {
      expect(importRegexFor(mod).test(source)).toBe(false);
    });

    it('escapes regex metacharacters in the module name', () => {
      // A naive `new RegExp(mod)` would treat `.` as "any char" and match
      // 'expoxsqlite'. Scoped packages carry `/` and `-`, which are inert.
      expect(importRegexFor('a.b').test(`import x from 'axb';`)).toBe(false);
      expect(
        importRegexFor('@react-native-community/netinfo').test(
          `import NetInfo from '@react-native-community/netinfo';`,
        ),
      ).toBe(true);
    });
  });

  it('no non-.native file statically imports a native-only module', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const root of SCAN_ROOTS) {
      const abs = path.join(process.cwd(), root);
      // Anti-vacuity: a missing scan root must fail loudly, not silently skip.
      // The old `continue` meant a moved/renamed directory produced a green
      // suite that checked nothing (#15).
      expect(fs.existsSync(abs)).toBe(true);
      for (const file of walk(abs)) {
        if (NATIVE_RE.test(file) || TEST_RE.test(file)) continue;
        scanned += 1;
        const text = fs.readFileSync(file, 'utf8');
        for (const mod of NATIVE_ONLY_MODULES) {
          if (importRegexFor(mod).test(text))
            offenders.push(`${path.relative(process.cwd(), file)} imports ${mod}`);
        }
      }
    }
    // Pins the denominator: if a resolution change empties the walk, this
    // fails instead of reporting a clean bill of health over zero files.
    expect(scanned).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });
});
