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
interface DynamicTestId {
  readonly prefix: string;
  /** File whose source must contain `sourceLiteral` in real code (comments stripped). */
  readonly source: string;
  /** Literal to look for in `source`. Defaults to `prefix`. */
  readonly sourceLiteral?: string;
  /**
   * For ids whose suffix is appended by a DIFFERENT file than the one holding
   * the prefix. Proving the prefix exists in `source` says nothing about the
   * template that builds the full id — that was #11: `sheet-safety` was
   * satisfied by a static literal in `SafetySectionSheet.tsx` while the
   * `${testID}-none` template it was meant to protect lived in
   * `SectionSheetScaffold.tsx`, so renaming that template left this guard green.
   */
  readonly derivedIn?: { readonly file: string; readonly template: string };
}

const DYNAMIC_TESTIDS: readonly DynamicTestId[] = [
  // `login-demo-${acc.role.toLowerCase()}` — one row per DEMO_ACCOUNTS entry.
  { prefix: 'login-demo-', source: path.join('app', '(auth)', 'login.tsx') },
  // `report-section-${row.id}` — one row per REPORT_ROWS entry.
  {
    prefix: 'report-section-',
    source: path.join('src', 'components', 'report', 'ReportDetailSections.tsx'),
  },
  // `sheet-safety-none` — the ONLY genuinely derived id in this family.
  // `sheet-safety`, `-add` and `-done` are static literals in
  // SafetySectionSheet.tsx and are found by the normal scan, so they need no
  // exemption; the old `sheet-safety` prefix exempted all of them at once (#11).
  // Both halves are now pinned: the prefix in the sheet, and the suffix
  // template in the scaffold that actually builds it.
  {
    prefix: 'sheet-safety-none',
    source: path.join('src', 'components', 'report', 'SafetySectionSheet.tsx'),
    sourceLiteral: 'sheet-safety',
    derivedIn: {
      file: path.join('src', 'components', 'report', 'SectionSheetScaffold.tsx'),
      template: '`${testID}-none`',
    },
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
  // The discard CONFIRMATION (#23). Its ids are `sync-discard-*`, deliberately
  // not nested under the `sync-queue-discard-` prefix above: that entry is a
  // blanket exemption, so anything under it would be invisible to this guard.
  //
  // Each is pinned in both halves, as #11 requires — the prefix literal at the
  // ConfirmSheet call site in SyncQueueScreen, the suffix template in the
  // component that actually appends it.
  {
    prefix: 'sync-discard-confirm',
    source: path.join('src', 'components', 'SyncQueueScreen.tsx'),
    sourceLiteral: 'sync-discard',
    derivedIn: {
      file: path.join('src', 'components', 'ConfirmSheet.tsx'),
      template: '`${testID}-confirm`',
    },
  },
  {
    prefix: 'sync-discard-cancel',
    source: path.join('src', 'components', 'SyncQueueScreen.tsx'),
    sourceLiteral: 'sync-discard',
    derivedIn: {
      file: path.join('src', 'components', 'ConfirmSheet.tsx'),
      template: '`${testID}-cancel`',
    },
  },
  {
    prefix: 'sync-discard-backdrop',
    source: path.join('src', 'components', 'SyncQueueScreen.tsx'),
    sourceLiteral: 'sync-discard',
    derivedIn: {
      file: path.join('src', 'components', 'BottomSheet.tsx'),
      template: '`${testID}-backdrop`',
    },
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

/**
 * Drops `//` and block comments so a prefix mentioned only in prose cannot
 * satisfy the existence check. Quote-aware enough for this codebase: it tracks
 * string and template literals so a `//` inside a URL or a `/* ` inside copy is
 * not mistaken for a comment opener.
 */
function stripComments(text: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    const next = text[i + 1];
    if (quote) {
      if (c === '\\') {
        out += c + (next ?? '');
        i += 1;
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
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

  it('every dynamic testID prefix exists in real CODE, not just a comment', () => {
    for (const { prefix, source, sourceLiteral } of DYNAMIC_TESTIDS) {
      const abs = path.join(root, source);
      expect(fs.existsSync(abs)).toBe(true);
      // Comments stripped first. `sync-status-` appears twice in
      // SyncStatusBanner.tsx — once as prose in the header comment, once as the
      // runtime template. The prose alone used to satisfy this, so deleting the
      // template left the guard green (#15, hole 2).
      const code = stripComments(fs.readFileSync(abs, 'utf8'));
      expect(code).toContain(sourceLiteral ?? prefix);
    }
  });

  it('every derived testID suffix template still exists in the file that builds it', () => {
    const derived = DYNAMIC_TESTIDS.filter((d) => d.derivedIn);
    // Anti-vacuity: if the entries lose their `derivedIn`, this must fail
    // rather than iterate an empty list and report success.
    expect(derived.length).toBeGreaterThan(0);

    for (const { prefix, derivedIn } of derived) {
      const abs = path.join(root, derivedIn!.file);
      expect(fs.existsSync(abs)).toBe(true);
      const code = stripComments(fs.readFileSync(abs, 'utf8'));
      if (!code.includes(derivedIn!.template)) {
        throw new Error(
          `${derivedIn!.file} no longer contains the template ${derivedIn!.template} ` +
            `that builds '${prefix}'. A flow selecting that id will fail on device.`,
        );
      }
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
