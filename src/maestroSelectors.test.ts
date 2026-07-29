/**
 * Maestro selector guard.
 *
 * Every `id:` a flow in `.maestro/` selects on must exist as a `testID` (or
 * `tabBarButtonTestID`) somewhere in `app/` or `src/`. Without this, renaming a
 * testID breaks the flow silently: nothing here fails, and the failure surfaces
 * twenty minutes into a cloud build against a real device — the slowest and
 * most expensive place to learn about a rename.
 *
 * Same shape as `platformSplit.test.ts`: a cheap source-text assertion standing
 * in for a check that would otherwise need a device.
 *
 * This guard proves the selector EXISTS in source. It cannot prove the element
 * is reachable on screen, or that navigation gets you there — that is what the
 * flow itself is for.
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * testIDs built at runtime from data, so no literal appears in source.
 * Each entry names the file that generates the prefix; the test asserts the
 * prefix is really there, so a rename of the template still fails.
 */
const DYNAMIC_TESTIDS: readonly { readonly prefix: string; readonly source: string }[] = [
  // `login-demo-${acc.role.toLowerCase()}` — one row per DEMO_ACCOUNTS entry.
  { prefix: 'login-demo-', source: path.join('app', '(auth)', 'login.tsx') },
  // `report-section-${row.id}` — one row per REPORT_ROWS entry.
  {
    prefix: 'report-section-',
    source: path.join('src', 'components', 'report', 'ReportDetailSections.tsx'),
  },
  // SectionSheetScaffold derives `${testID}-none` for the affirmation row;
  // `sheet-safety` is the literal prefix passed by SafetySectionSheet.
  {
    prefix: 'sheet-safety',
    source: path.join('src', 'components', 'report', 'SafetySectionSheet.tsx'),
  },
  // `sync-status-${state}` — the sync pill's machine-readable state node.
  {
    prefix: 'sync-status-',
    source: path.join('src', 'components', 'SyncStatusBanner.tsx'),
  },
  // `sync-queue-row-${clientId}` — one row per queued mutation.
  {
    prefix: 'sync-queue-row-',
    source: path.join('src', 'components', 'SyncQueueScreen.tsx'),
  },
  // `sync-queue-discard-${clientId}` — the per-row Discard button on a parked row.
  {
    prefix: 'sync-queue-discard-',
    source: path.join('src', 'components', 'SyncQueueScreen.tsx'),
  },
];

const SCAN_ROOTS = ['src', 'app'];
const SOURCE_RE = /\.(ts|tsx)$/;
const FLOW_DIR = '.maestro';

/** `id: 'foo'` / `id: "foo"` in a Maestro flow, at any nesting depth. */
const FLOW_ID_RE = /^\s*id:\s*['"]([^'"]+)['"]\s*$/gm;

/** `testID="foo"`, `testID={'foo'}`, `tabBarButtonTestID: 'foo'`. */
const SOURCE_TESTID_RE = /(?:tabBarButtonTestID|testID)\s*[:=]\s*\{?\s*['"]([^'"]+)['"]/g;

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return SOURCE_RE.test(entry.name) ? [full] : [];
  });
}

function matchAll(text: string, re: RegExp): string[] {
  // Fresh lastIndex per call — these regexes are module-level and /g.
  const local = new RegExp(re.source, re.flags);
  return [...text.matchAll(local)].map((m) => m[1]);
}

const root = process.cwd();

const flowFiles = fs.existsSync(path.join(root, FLOW_DIR))
  ? fs
      .readdirSync(path.join(root, FLOW_DIR))
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => path.join(FLOW_DIR, f))
  : [];

const declaredTestIds = new Set(
  SCAN_ROOTS.flatMap((r) => walk(path.join(root, r))).flatMap((file) =>
    matchAll(fs.readFileSync(file, 'utf8'), SOURCE_TESTID_RE),
  ),
);

describe('maestro selectors', () => {
  it('finds at least one flow to check', () => {
    // Guards against the whole suite passing vacuously if .maestro moves.
    expect(flowFiles.length).toBeGreaterThan(0);
  });

  it('every dynamic testID prefix still exists in its named source file', () => {
    for (const { prefix, source } of DYNAMIC_TESTIDS) {
      const abs = path.join(root, source);
      expect(fs.existsSync(abs)).toBe(true);
      expect(fs.readFileSync(abs, 'utf8')).toContain(prefix);
    }
  });

  it('every id: a flow selects on is declared as a testID in app/ or src/', () => {
    const missing: string[] = [];

    for (const flow of flowFiles) {
      const text = fs.readFileSync(path.join(root, flow), 'utf8');
      for (const id of matchAll(text, FLOW_ID_RE)) {
        if (declaredTestIds.has(id)) continue;
        if (DYNAMIC_TESTIDS.some(({ prefix }) => id.startsWith(prefix))) continue;
        missing.push(`${flow} selects id:'${id}' — no matching testID in app/ or src/`);
      }
    }

    expect(missing).toEqual([]);
  });
});
