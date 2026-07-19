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

const NATIVE_ONLY_MODULES = ['expo-sqlite'];
const SCAN_ROOTS = ['src', 'app'];
const SOURCE_RE = /\.(ts|tsx)$/;
const NATIVE_RE = /\.native\.(ts|tsx)$/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return SOURCE_RE.test(entry.name) ? [full] : [];
  });
}

describe('platform split', () => {
  it('no non-.native file statically imports a native-only module', () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      const abs = path.join(process.cwd(), root);
      if (!fs.existsSync(abs)) continue;
      for (const file of walk(abs)) {
        if (NATIVE_RE.test(file)) continue;
        const text = fs.readFileSync(file, 'utf8');
        for (const mod of NATIVE_ONLY_MODULES) {
          const importRe = new RegExp(`(from\\s+|require\\()['"]${mod}`, 'm');
          if (importRe.test(text)) offenders.push(`${path.relative(process.cwd(), file)} imports ${mod}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
