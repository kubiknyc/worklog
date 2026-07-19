# WorkLog Phase 4 Foundation Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the WorkLog Expo app foundation — scaffold + tooling, the six pure sync modules fully tested, M0 UI (theme/auth/tab shell), and the M1 data layer (SQLite wiring, repository seam, column-parity test, grep guard) — ending at the gate where M2 and M3-native can start.

**Architecture:** Fresh Expo scaffold at the WorkLog repo root, pinned to PunchLog's stack. PunchLog (`C:\Users\kubik\PUNCH-LOG-NEW`) is the port source: pure sync modules and theme/auth/db plumbing are copied file-by-file and adapted to WorkLog's committed domain types (`src/sync/types.ts`, `src/db/schema.ts`). Dev backend is the local Supabase stack in `C:\Users\kubik\JOBSIGHT-SUITE\jobsight-backend`.

**Tech Stack:** Expo SDK 54 · React Native 0.81.5 · React 19.1.0 · expo-router ~6.0.24 · expo-sqlite ~16.0.10 · @supabase/supabase-js ^2.108.2 · TypeScript ~5.9.2 strict · Jest ~29.7 (jest-expo preset)

**Spec:** `docs/superpowers/specs/2026-07-18-phase4-foundation-design.md`

## Global Constraints

- Working directory for all commands: `C:\Users\kubik\JOBSIGHT-SUITE\WorkLog` (Git Bash: `/c/Users/kubik/JOBSIGHT-SUITE/WorkLog`). Port source: `/c/Users/kubik/PUNCH-LOG-NEW`.
- Dependency pins copied from PunchLog `package.json` (Task 1 lists them verbatim). After any dependency change run `npx expo install --fix` so Expo-managed versions stay SDK-54-consistent.
- TypeScript strict; `npm run typecheck` (`tsc --noEmit`) must be green at the end of every task.
- No `console.log` in production code. No `any` — use `unknown` + narrowing.
- Platform-split rule: only `*.native.ts`/`*.native.tsx` files may statically import native-only modules (`expo-sqlite`). Enforced by the Task 2 guard test from Task 2 onward.
- The already-committed files `src/sync/types.ts` and `src/db/schema.ts` are Phase 3 artifacts: **do not modify them** in this slice except where a task explicitly says so.
- Commits: conventional format (`feat:`, `test:`, `chore:`), one per task minimum, no AI attribution lines.
- WorkLog mutation kinds (from `src/sync/types.ts`): `create_report`, `update_section`, `submit_report`, `lock_report`, `create_amendment`, `add_photo`, `update_photo_meta`, `remove_photo`. Drain order: all JSON kinds oldest-first, then `add_photo` oldest-first (doc `06-sync-mappings.md` §A).
- WorkLog statuses in lifecycle order: `draft`, `submitted`, `locked` (+ `amended` as derived display state).
- Tab layout (PRD §4): `[ Today ] [ History ] ( Camera — raised center, #3FA9F0 ) [ Photos ] [ Settings ]`.

---

### Task 1: Expo scaffold + tooling at repo root

**Files:**
- Create: `package.json`, `app.json`, `tsconfig.json`, `babel.config.js`, `.prettierrc`, `eslint.config.js`, `.env.example`, `.gitignore` (extend), `app/_layout.tsx`, `app/index.tsx`
- Reference: `/c/Users/kubik/PUNCH-LOG-NEW/package.json`, `/c/Users/kubik/PUNCH-LOG-NEW/app.json`, `/c/Users/kubik/PUNCH-LOG-NEW/tsconfig.json`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: a bootable expo-router app; npm scripts `start`, `typecheck`, `test`, `lint` used by every later task.

- [ ] **Step 1: Author package.json**

```json
{
  "name": "worklog",
  "main": "expo-router/entry",
  "version": "0.1.0",
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "web": "expo start --web",
    "lint": "expo lint",
    "typecheck": "tsc --noEmit",
    "test": "jest"
  },
  "jest": {
    "preset": "jest-expo",
    "testMatch": ["**/__tests__/**/*.test.{ts,tsx}", "**/?(*.)+(test).{ts,tsx}"],
    "testPathIgnorePatterns": ["/node_modules/"]
  },
  "dependencies": {
    "@expo-google-fonts/archivo": "^0.4.2",
    "@expo-google-fonts/jetbrains-mono": "^0.4.1",
    "@expo-google-fonts/spectral": "^0.4.1",
    "@expo/vector-icons": "^15.0.3",
    "@react-native-async-storage/async-storage": "2.2.0",
    "@supabase/supabase-js": "^2.108.2",
    "expo": "^54.0.0",
    "expo-constants": "~18.0.13",
    "expo-crypto": "~15.0.7",
    "expo-font": "~14.0.12",
    "expo-linking": "~8.0.12",
    "expo-router": "~6.0.24",
    "expo-secure-store": "~15.0.8",
    "expo-splash-screen": "~31.0.13",
    "expo-sqlite": "~16.0.10",
    "expo-status-bar": "~3.0.9",
    "expo-system-ui": "~6.0.9",
    "react": "19.1.0",
    "react-dom": "19.1.0",
    "react-native": "0.81.5",
    "react-native-safe-area-context": "~5.6.0",
    "react-native-screens": "~4.16.0",
    "react-native-url-polyfill": "^3.0.0",
    "react-native-web": "^0.21.0"
  },
  "devDependencies": {
    "@babel/core": "^7.25.2",
    "@testing-library/react-native": "^13.3.3",
    "@types/jest": "29.5.14",
    "@types/react": "~19.1.10",
    "eslint": "^9.25.0",
    "eslint-config-expo": "~10.0.0",
    "jest": "~29.7.0",
    "jest-expo": "~54.0.0",
    "prettier": "^3.3.0",
    "typescript": "~5.9.2"
  },
  "private": true
}
```

- [ ] **Step 2: Author app.json, tsconfig.json, babel.config.js, eslint.config.js, .prettierrc**

`app.json` (compare fields against PunchLog's `app.json` and keep the same shape; WorkLog identity):

```json
{
  "expo": {
    "name": "WorkLog",
    "slug": "worklog",
    "version": "0.1.0",
    "scheme": "worklog",
    "orientation": "portrait",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "ios": { "supportsTablet": false, "bundleIdentifier": "com.jobsight.worklog" },
    "android": { "package": "com.jobsight.worklog", "edgeToEdgeEnabled": true },
    "web": { "bundler": "metro", "output": "static" },
    "plugins": ["expo-router", "expo-splash-screen", "expo-secure-store", "expo-font", "expo-sqlite"]
  }
}
```

`tsconfig.json`:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": { "@/*": ["./*"] }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"],
  "exclude": ["node_modules", "docs", "scripts"]
}
```

`babel.config.js`:

```js
module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
```

`eslint.config.js`:

```js
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([expoConfig, { ignores: ['dist/*', 'docs/*'] }]);
```

`.prettierrc`:

```json
{ "singleQuote": true, "printWidth": 100, "trailingComma": "all" }
```

- [ ] **Step 3: Author .env.example and extend .gitignore**

`.env.example`:

```
# Local Supabase stack (run `supabase start` in ../jobsight-backend, values from `supabase status`)
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key from `supabase status`>
```

Append to `.gitignore`:

```
node_modules/
.expo/
dist/
.env
*.tsbuildinfo
```

- [ ] **Step 4: Author minimal boot routes**

`app/_layout.tsx`:

```tsx
import { Stack } from 'expo-router';

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

`app/index.tsx`:

```tsx
import { Text, View } from 'react-native';

export default function Index() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>WorkLog scaffold</Text>
    </View>
  );
}
```

- [ ] **Step 5: Install and verify**

Run: `npm install && npx expo install --fix && npm run typecheck && npm test -- --passWithNoTests`
Expected: install completes; `expo install --fix` may bump patch versions (accept); typecheck green; jest exits 0 ("no tests found" is OK at this point).

Run: `npx expo export --platform web`
Expected: static web export succeeds (proves the router entry + web bundle work without a device).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json app.json tsconfig.json babel.config.js eslint.config.js .prettierrc .env.example .gitignore app/
git commit -m "feat: Expo SDK 54 scaffold pinned to PunchLog stack"
```

---

### Task 2: Platform-split grep guard

**Files:**
- Create: `src/platformSplit.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a standing Jest gate; later tasks must keep it green. `NATIVE_ONLY_MODULES` is the extension point.

- [ ] **Step 1: Write the guard test (it is both the test and the implementation)**

```ts
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
```

- [ ] **Step 2: Run it**

Run: `npm test -- src/platformSplit.test.ts`
Expected: PASS (nothing imports expo-sqlite yet).

- [ ] **Step 3: Prove it fires**

Temporarily add `import 'expo-sqlite';` to `app/index.tsx`, run the test again.
Expected: FAIL listing `app/index.tsx imports expo-sqlite`. Revert the temporary line, re-run, PASS.

- [ ] **Step 4: Commit**

```bash
git add src/platformSplit.test.ts
git commit -m "test: platform-split guard for native-only imports"
```

---

### Task 3: Port paginate.ts (verbatim)

**Files:**
- Create: `src/sync/paginate.ts`, `src/sync/paginate.test.ts`
- Source: `/c/Users/kubik/PUNCH-LOG-NEW/src/sync/paginate.ts` (+ its `.test.ts`)

**Interfaces:**
- Consumes: nothing from other WorkLog modules (pure).
- Produces: the paged-pull helper exactly as PunchLog exports it (keep every export name unchanged); consumed by `pull.native.ts` in M3.

- [ ] **Step 1: Copy the test first**

```bash
cp /c/Users/kubik/PUNCH-LOG-NEW/src/sync/paginate.test.ts src/sync/paginate.test.ts
```

Run: `npm test -- src/sync/paginate.test.ts`
Expected: FAIL — cannot find module `./paginate`.

- [ ] **Step 2: Copy the module**

```bash
cp /c/Users/kubik/PUNCH-LOG-NEW/src/sync/paginate.ts src/sync/paginate.ts
```

This file is pure and domain-agnostic — a verbatim port. If it imports anything from PunchLog's `./types`, re-point the import to WorkLog's `./types`; if a referenced name doesn't exist in WorkLog's types, stop and check `docs/architecture/06-sync-mappings.md` §B before renaming anything.

- [ ] **Step 3: Verify**

Run: `npm test -- src/sync/paginate.test.ts && npm run typecheck`
Expected: all tests PASS, typecheck green.

- [ ] **Step 4: Commit**

```bash
git add src/sync/paginate.ts src/sync/paginate.test.ts
git commit -m "feat: port paginate pure module verbatim from PunchLog"
```

---

### Task 4: Port mutationQueue.ts (verbatim policy, WorkLog row targets)

**Files:**
- Create: `src/sync/mutationQueue.ts`, `src/sync/mutationQueue.test.ts`
- Source: `/c/Users/kubik/PUNCH-LOG-NEW/src/sync/mutationQueue.ts` (+ `.test.ts`)

**Interfaces:**
- Consumes: `ErrorClass`, `Mutation`, `MutationPayload` from `src/sync/types.ts` (already committed).
- Produces (all consumed by M3's push/store adapters and Task 6's coverage gate):
  - `RETRY_CEILING = 5`
  - `classifyError(err: unknown): ErrorClass`
  - `normalizeStorageError(err: unknown): unknown`
  - `isDuplicateUpload(err: unknown): boolean`
  - `orderForDrain(pending: readonly Mutation[]): Mutation[]`
  - `newMutation(clientId: string, payload: MutationPayload, createdAt: string): Mutation`
  - `RowTarget`, `rowTargetOf(payload: MutationPayload): RowTarget`
  - `otherMutationTargetsRow(queued: readonly Mutation[], m: Mutation): boolean`
  - `PushOutcome`, `AppliedOutcome`, `applyOutcome(m: Mutation, outcome: PushOutcome): AppliedOutcome`

- [ ] **Step 1: Copy module and test**

```bash
cp /c/Users/kubik/PUNCH-LOG-NEW/src/sync/mutationQueue.ts src/sync/mutationQueue.ts
cp /c/Users/kubik/PUNCH-LOG-NEW/src/sync/mutationQueue.test.ts src/sync/mutationQueue.test.ts
```

- [ ] **Step 2: Apply the ONLY two domain edits to the module**

Everything else — `classifyError`, `normalizeStorageError`, `isDuplicateUpload`, `applyOutcome`, `newMutation`, `otherMutationTargetsRow`, `RETRY_CEILING`, all doc comments about error classes — stays **verbatim** (risk register #7).

Edit A — `orderForDrain` keeps its exact logic (`add_photo` filtered last); only its doc comment's item/comment wording may be updated to report/section wording. The WorkLog safety argument is already documented in `06-sync-mappings.md` §A: `update_photo_meta`/`remove_photo` are only ever enqueued for already-synced photos, so no JSON kind can precede its own `add_photo`.

Edit B — replace PunchLog's `RowTarget`/`rowTargetOf` with the WorkLog mapping ([R2]: a section row's identity is the `(reportId, section)` tuple):

```ts
/** The local cached row a mutation writes (and marks `_dirty` until pushed —
 * except photos, whose unpushed-flag analogue is `_pending`). */
export interface RowTarget {
  readonly table: 'daily_reports' | 'report_sections' | 'report_photos' | 'report_amendments';
  readonly id: string;
}

/**
 * Which local row a mutation dirties. Section rows have a composite identity
 * [R2] — `(reportId, section)` joined with ':' (SectionKind values never
 * contain ':'). Lifecycle kinds (create/submit/lock) touch the report row.
 */
export function rowTargetOf(payload: MutationPayload): RowTarget {
  switch (payload.kind) {
    case 'update_section':
      return { table: 'report_sections', id: `${payload.data.reportId}:${payload.data.section}` };
    case 'add_photo':
    case 'update_photo_meta':
    case 'remove_photo':
      return { table: 'report_photos', id: payload.data.photoId };
    case 'create_amendment':
      return { table: 'report_amendments', id: payload.data.amendmentId };
    case 'create_report':
    case 'submit_report':
    case 'lock_report':
      return { table: 'daily_reports', id: payload.data.reportId };
  }
}
```

(Exhaustive switch, no `default` — the compiler then flags any future ninth kind.)

- [ ] **Step 3: Adapt the test fixtures**

The ported test file references PunchLog payload kinds (`create_item`, `add_comment`, …). Rewrite every fixture to WorkLog kinds using the payload shapes in `src/sync/types.ts` (e.g. a `create_report` fixture: `{ kind: 'create_report', data: { reportId: 'r1', projectId: 'p1', reportDate: '2026-07-18', carryForwardSourceReportId: null } }`). Behavior assertions (classification table, ceiling, offline exemption, park transitions, drain order) stay identical. Add/adjust `rowTargetOf` cases to cover all 8 kinds, including the composite section id:

```ts
it('update_section targets the (reportId, section) tuple row', () => {
  const target = rowTargetOf({
    kind: 'update_section',
    data: { reportId: 'r1', section: 'crew', content: {}, isComplete: false },
  });
  expect(target).toEqual({ table: 'report_sections', id: 'r1:crew' });
});
```

- [ ] **Step 4: Verify**

Run: `npm test -- src/sync/mutationQueue.test.ts && npm run typecheck`
Expected: all tests PASS, typecheck green.

- [ ] **Step 5: Commit**

```bash
git add src/sync/mutationQueue.ts src/sync/mutationQueue.test.ts
git commit -m "feat: port mutationQueue policy verbatim; WorkLog row targets"
```

---

### Task 5: Port conflict.ts, cursors.ts, engineApi.ts

**Files:**
- Create: `src/sync/conflict.ts`, `src/sync/conflict.test.ts`, `src/sync/cursors.ts`, `src/sync/cursors.test.ts`, `src/sync/engineApi.ts`
- Source: same filenames under `/c/Users/kubik/PUNCH-LOG-NEW/src/sync/`

**Interfaces:**
- Consumes: `Mutation` types from `src/sync/types.ts`; `rowTargetOf` from Task 4 (if the source files reference it).
- Produces:
  - `conflict.ts`: `isServerNewer(...)`, `MergeableItem`, `mergeItem<T>(local, server, localDirty): T`, `ResolvedItem`, `resolveItem(...)` — keep PunchLog signatures; generic-record LWW with dirty-row protection (invariant: a `_dirty` local row is never overwritten by a pull).
  - `cursors.ts`: `SCOPES` rewritten to WorkLog's grammar, `OVERLAP_MS = 10_000`, `overlapFloor(cursor, overlapMs?)`, `nextCursor(...)` — logic verbatim.
  - `engineApi.ts`: `SyncState`, `SyncEngineApi`, `IDLE_SYNC_STATE` — verbatim (pure interface module).

- [ ] **Step 1: Copy tests first, watch them fail**

```bash
cp /c/Users/kubik/PUNCH-LOG-NEW/src/sync/conflict.test.ts src/sync/conflict.test.ts
cp /c/Users/kubik/PUNCH-LOG-NEW/src/sync/cursors.test.ts src/sync/cursors.test.ts
```

Run: `npm test -- src/sync/conflict.test.ts src/sync/cursors.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 2: Copy and adapt the modules**

```bash
cp /c/Users/kubik/PUNCH-LOG-NEW/src/sync/conflict.ts src/sync/conflict.ts
cp /c/Users/kubik/PUNCH-LOG-NEW/src/sync/cursors.ts src/sync/cursors.ts
cp /c/Users/kubik/PUNCH-LOG-NEW/src/sync/engineApi.ts src/sync/engineApi.ts
```

- `conflict.ts`: keep the merge/LWW logic verbatim. If `MergeableItem` names PunchLog-specific fields beyond `id`/`updated_at`/`_dirty`-style flags, generalize the type parameter, not the logic. Per-section LWW rides on the same primitive: the section "item" is the row keyed by the Task 4 composite id.
- `cursors.ts`: replace the `SCOPES` table with WorkLog's cursor-scope keys from `06-sync-mappings.md` §B (per-project Tier-2 scopes; the photo scope is pre-versioned):

```ts
export const SCOPES = {
  projects: () => 'projects',
  members: () => 'members',
  memberPrefs: (projectId: string) => `member_prefs:${projectId}`,
  reports: (projectId: string) => `reports:${projectId}`,
  sections: (projectId: string) => `sections:${projectId}`,
  photos: (projectId: string) => `report_photos_v1:${projectId}`,
  amendments: (projectId: string) => `amendments:${projectId}`,
} as const;
```

Before committing, cross-check every key literal against the cursor table in `docs/architecture/06-sync-mappings.md` §B and use the doc's exact strings if they differ.
- `engineApi.ts`: verbatim; re-point type imports to WorkLog `./types` if needed.
- Adapt test fixtures to WorkLog scope names/kinds; behavior assertions unchanged.

- [ ] **Step 3: Verify**

Run: `npm test -- src/sync && npm run typecheck`
Expected: all sync tests PASS (paginate, mutationQueue, conflict, cursors), typecheck green.

- [ ] **Step 4: Commit**

```bash
git add src/sync/conflict.ts src/sync/conflict.test.ts src/sync/cursors.ts src/sync/cursors.test.ts src/sync/engineApi.ts
git commit -m "feat: port conflict/cursors/engineApi pure modules with WorkLog scopes"
```

---

### Task 6: Coverage gate for the pure sync spine

**Files:**
- Modify: `package.json` (jest config block)

**Interfaces:**
- Consumes: all Task 3–5 modules.
- Produces: enforced 100% coverage on `mutationQueue.ts`; `npm test` fails below threshold from now on.

- [ ] **Step 1: Add the threshold**

In the `"jest"` block of `package.json` add:

```json
"collectCoverageFrom": ["src/sync/*.ts", "!src/sync/types.ts"],
"coverageThreshold": {
  "src/sync/mutationQueue.ts": { "branches": 100, "functions": 100, "lines": 100, "statements": 100 }
}
```

- [ ] **Step 2: Run with coverage**

Run: `npm test -- --coverage`
Expected: PASS with `mutationQueue.ts` at 100/100/100/100. If any branch is uncovered, add the missing test case (the classification table in `classifyError` is the usual gap — cover 401, 409-duplicate, `PL001`, `PGRST301`-style codes, and the status-0 network heuristics).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "test: enforce 100% coverage on mutationQueue policy spine"
```

---

### Task 7: Port the theme system (M0)

**Files:**
- Create: `src/theme/tokens.ts`, `src/theme/fonts.ts`, `src/theme/ThemeProvider.tsx`, `src/theme/appearanceStorage.ts`, `src/theme/index.ts`, plus tests `appearanceStorage.test.ts`, `ThemeProvider.test.tsx`
- Create (as pulled in by imports): needed `src/lib/*` helpers from PunchLog (`errors.ts`, `strings.ts`, … — copy only what the theme files import, with their tests)
- Source: `/c/Users/kubik/PUNCH-LOG-NEW/src/theme/`, `/c/Users/kubik/PUNCH-LOG-NEW/src/lib/`

**Interfaces:**
- Consumes: AsyncStorage (already a dependency).
- Produces: `ThemeProvider`, `useTheme`, `useThemeContext` (keep PunchLog's export surface via `src/theme/index.ts`); design tokens incl. `REPORT_STATUS_COLORS` and `FIXED_COLORS.camera`; all three themes (Blueprint is the one auth screens pin).

- [ ] **Step 1: Copy tests, watch them fail**

```bash
cp /c/Users/kubik/PUNCH-LOG-NEW/src/theme/appearanceStorage.test.ts src/theme/appearanceStorage.test.ts
cp /c/Users/kubik/PUNCH-LOG-NEW/src/theme/ThemeProvider.test.tsx src/theme/ThemeProvider.test.tsx
```

Run: `npm test -- src/theme`
Expected: FAIL — modules not found.

- [ ] **Step 2: Copy the theme modules and any `src/lib` files they import**

```bash
cp /c/Users/kubik/PUNCH-LOG-NEW/src/theme/{tokens.ts,fonts.ts,ThemeProvider.tsx,appearanceStorage.ts,index.ts} src/theme/
```

Then follow the import graph: for each `../lib/<file>` import, copy that file and its test from PunchLog `src/lib/`.

- [ ] **Step 3: Apply the ReportStatus rename (PRD §3 M0 note)**

In `tokens.ts`, replace the PunchLog item-status color map with report statuses, reusing the existing palette values by lifecycle position (earliest PunchLog stage color → `draft`, next → `submitted`, terminal → `locked`) and the theme accent for `amended`:

```ts
export const REPORT_STATUS_COLORS: Record<'draft' | 'submitted' | 'locked' | 'amended', string> = {
  draft: /* palette value previously used for the earliest item status */,
  submitted: /* mid-lifecycle value */,
  locked: /* terminal value */,
  amended: /* accent value */,
};

export const FIXED_COLORS = { camera: '#3FA9F0' } as const;
```

(Copy the concrete hex values from the PunchLog map being replaced — do not invent new colors; the three-theme WCAG-AA guarantee rides on the existing palette.) Update any token test that asserted the old status keys.

- [ ] **Step 4: Verify**

Run: `npm test -- src/theme src/lib && npm run typecheck`
Expected: PASS, typecheck green.

- [ ] **Step 5: Commit**

```bash
git add src/theme src/lib
git commit -m "feat: port three-theme system with ReportStatus colors"
```

---

### Task 8: Supabase client + generated DB types

**Files:**
- Create: `src/supabase/client.ts`, `src/supabase/types.ts`, `.env` (local only, never committed)
- Source: `/c/Users/kubik/PUNCH-LOG-NEW/src/supabase/client.ts`

**Interfaces:**
- Consumes: env vars `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- Produces: `export const supabase` (typed client, chunked SecureStore session storage on native, localStorage on web, `detectSessionInUrl: false`) — consumed by auth (Task 9) and the web repository (Task 13).

- [ ] **Step 1: Copy the client verbatim**

```bash
cp /c/Users/kubik/PUNCH-LOG-NEW/src/supabase/client.ts src/supabase/client.ts
```

No edits — the chunked SecureStore adapter, web adapter, env guard, and AppState auto-refresh wiring are exactly what M0 requires (PRD §3: "chunked SecureStore Supabase client").

- [ ] **Step 2: Generate WorkLog Database types from the local stack**

```bash
cd /c/Users/kubik/JOBSIGHT-SUITE/jobsight-backend && supabase start && supabase gen types typescript --local > /c/Users/kubik/JOBSIGHT-SUITE/WorkLog/src/supabase/types.ts
cd /c/Users/kubik/JOBSIGHT-SUITE/WorkLog
```

Expected: `types.ts` contains a `Database` type including `daily_reports`, `report_sections`, `report_photos`, etc.

- [ ] **Step 3: Create `.env` from `.env.example`** with the URL and anon key printed by `supabase status`.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test`
Expected: green (client compiles against generated `Database`; grep guard still passes — `expo-secure-store` is Platform-branched at call time, deliberately not on the banned list).

- [ ] **Step 5: Commit**

```bash
git add src/supabase/client.ts src/supabase/types.ts
git commit -m "feat: Supabase client with chunked SecureStore sessions + generated types"
```

---

### Task 9: Auth provider, login route, root layout (M0)

**Files:**
- Create: `src/auth/AuthProvider.tsx`, `src/auth/index.ts` (+ `AuthProvider.test.tsx` and any `src/auth`/`src/lib` files AuthProvider imports, with tests)
- Create: `app/(auth)/_layout.tsx`, `app/(auth)/login.tsx`
- Modify: `app/_layout.tsx`, `app/index.tsx`
- Source: `/c/Users/kubik/PUNCH-LOG-NEW/src/auth/`, `/c/Users/kubik/PUNCH-LOG-NEW/app/(auth)/`, `/c/Users/kubik/PUNCH-LOG-NEW/app/_layout.tsx`

**Interfaces:**
- Consumes: `supabase` from Task 8, theme from Task 7.
- Produces: `AuthProvider`, `useAuth()` (session + `isHydrated`), consumed by every gated screen; `(auth)/login` email/password flow. Invite acceptance and set-password are **out of scope** (M2, P2-9) — do not port `invites.ts`/`setPasswordSession.ts`/`authLink.ts` unless AuthProvider fails to compile without them; if AuthProvider imports them, port the file but do not create routes that use it.

- [ ] **Step 1: Copy AuthProvider + test, follow its import graph**

```bash
cp /c/Users/kubik/PUNCH-LOG-NEW/src/auth/AuthProvider.tsx src/auth/AuthProvider.tsx
cp /c/Users/kubik/PUNCH-LOG-NEW/src/auth/AuthProvider.test.tsx src/auth/AuthProvider.test.tsx
cp /c/Users/kubik/PUNCH-LOG-NEW/src/auth/index.ts src/auth/index.ts
```

Copy each additionally-imported `src/auth`/`src/lib` file (+ its test). Strip PunchLog-specific exports from `src/auth/index.ts` that you did not port. Remove any push-notification or Sentry wiring inside AuthProvider (those subsystems are not in this slice) — delete the import and its call sites, keeping session logic intact.

- [ ] **Step 2: Port the login screen and auth group layout**

```bash
mkdir -p 'app/(auth)'
cp '/c/Users/kubik/PUNCH-LOG-NEW/app/(auth)/_layout.tsx' 'app/(auth)/_layout.tsx'
cp '/c/Users/kubik/PUNCH-LOG-NEW/app/(auth)/login.tsx' 'app/(auth)/login.tsx'
```

Edits: rebrand copy to "WorkLog"; the login screen renders in the **Blueprint** theme always (PRD §3 M0: "always Blueprint") — keep PunchLog's mechanism for pinning it if present, otherwise wrap the screen's token lookups to the Blueprint palette. Remove links to routes that don't exist yet (set-password, signup).

- [ ] **Step 3: Rewrite the root layout with providers + splash hold**

Model on PunchLog's `app/_layout.tsx`. Required behavior: load fonts, wrap `<ThemeProvider>` and `<AuthProvider>`, hold the splash screen until `isHydrated` (PRD §3 M0: "splash-hold on `isHydrated`"), then `<Stack>`. `app/index.tsx` becomes the gate:

```tsx
import { Redirect } from 'expo-router';
import { useAuth } from '@/src/auth';

export default function Index() {
  const { session, isHydrated } = useAuth();
  if (!isHydrated) return null; // splash still visible
  return session ? <Redirect href="/(tabs)" /> : <Redirect href="/(auth)/login" />;
}
```

(If the ported `useAuth` exposes different member names, use those — mirror PunchLog's surface rather than inventing one.)

- [ ] **Step 4: Verify**

Run: `npm test -- src/auth && npm run typecheck && npm test -- src/platformSplit.test.ts`
Expected: PASS. `/(tabs)` doesn't exist until Task 10 — typecheck of the redirect string is unchecked by tsc (router types generate after the route exists); acceptable for one task.

Manual: `npm run web`, open the printed URL.
Expected: login screen renders (Blueprint), sign-in with the seeded demo account from `jobsight-backend/supabase/seed.sql` succeeds (redirect will 404 until Task 10 — that's the expected intermediate state).

- [ ] **Step 5: Commit**

```bash
git add src/auth app/ src/lib
git commit -m "feat: auth provider + Blueprint login + splash-hold root layout"
```

---

### Task 10: Tab shell — 5 slots, raised camera action (M0)

**Files:**
- Create: `app/(tabs)/_layout.tsx`, `app/(tabs)/index.tsx` (Today), `app/(tabs)/history.tsx`, `app/(tabs)/photos.tsx`, `app/(tabs)/settings.tsx`, `app/(tabs)/camera.tsx`
- Reference: `/c/Users/kubik/PUNCH-LOG-NEW/app/(tabs)/_layout.tsx` (tab-bar styling idiom)

**Interfaces:**
- Consumes: theme tokens (Task 7), auth gate (Task 9).
- Produces: the five-slot shell M2+ screens fill; the camera slot is an action button placeholder until M5.

- [ ] **Step 1: Write the tab layout**

Follow PunchLog's `(tabs)/_layout.tsx` styling idiom (colors from `useTheme()`), with WorkLog's slot order and the raised center button:

```tsx
import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { FIXED_COLORS, useTheme } from '@/src/theme';

function RaisedCameraButton(props: { onPress?: (e: unknown) => void }) {
  return (
    <Pressable onPress={props.onPress} style={styles.cameraWrap} accessibilityLabel="Capture photo">
      <View style={styles.cameraCircle}>
        <MaterialCommunityIcons name="camera" size={28} color="#FFFFFF" />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cameraWrap: { top: -18, justifyContent: 'center', alignItems: 'center' },
  cameraCircle: {
    width: 56, height: 56, borderRadius: 28, // ≥48px touch target (PRD §9 AC)
    backgroundColor: FIXED_COLORS.camera,
    justifyContent: 'center', alignItems: 'center',
    elevation: 4, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 },
  },
});

export default function TabsLayout() {
  const theme = useTheme();
  return (
    <Tabs screenOptions={{ headerShown: false /* + tab bar colors from theme, per PunchLog idiom */ }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="calendar-today" color={color} size={size} /> }} />
      <Tabs.Screen name="history" options={{ title: 'History', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="history" color={color} size={size} /> }} />
      <Tabs.Screen name="camera" options={{ title: '', tabBarButton: (props) => <RaisedCameraButton onPress={props.onPress ?? undefined} /> }} />
      <Tabs.Screen name="photos" options={{ title: 'Photos', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="image-multiple" color={color} size={size} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <MaterialCommunityIcons name="cog" color={color} size={size} /> }} />
    </Tabs>
  );
}
```

(Adapt `useTheme()` usage to the actual ported hook surface; wire `tabBarActiveTintColor` etc. exactly the way PunchLog's tab layout does.)

- [ ] **Step 2: Placeholder screens**

Each of `index.tsx` (Today), `history.tsx`, `photos.tsx`, `settings.tsx`, `camera.tsx` is the same minimal themed placeholder — e.g.:

```tsx
import { Text, View } from 'react-native';
import { useTheme } from '@/src/theme';

export default function TodayScreen() {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background }}>
      <Text style={{ color: theme.colors.text }}>Today — M2</Text>
    </View>
  );
}
```

(`camera.tsx` says "Camera — M5". Adjust `theme.colors.*` member names to the real token shape.)

- [ ] **Step 3: Verify**

Run: `npm run typecheck && npm test`
Expected: green.

Manual: `npm run web` — sign in, land on Today, all four tabs navigate, camera button renders raised in `#3FA9F0` center slot. Then `npm run android` (or `npm run ios`): same, plus tab bar respects safe-area insets.

- [ ] **Step 4: Commit**

```bash
git add 'app/(tabs)'
git commit -m "feat: five-slot tab shell with raised camera action"
```

---

### Task 11: SQLite open/rows plumbing + migration runner (M1)

**Files:**
- Create: `src/db/open.native.ts`, `src/db/rows.native.ts` (+ any tests those files have in PunchLog)
- Source: `/c/Users/kubik/PUNCH-LOG-NEW/src/db/open.native.ts`, `/c/Users/kubik/PUNCH-LOG-NEW/src/db/rows.native.ts`

**Interfaces:**
- Consumes: `SCHEMA_VERSION`, `SCHEMA_V1`, `MIGRATIONS` from `src/db/schema.ts` (committed, do not modify).
- Produces: `openDb()` (or PunchLog's exact export name — keep it) applying `SCHEMA_V1` then `MIGRATIONS` keyed by `PRAGMA user_version`; row helpers consumed by `sqliteRepo.native.ts` (Task 13) and M3's `store.native.ts`.

- [ ] **Step 1: Copy both files (+ tests if present)**

```bash
cp /c/Users/kubik/PUNCH-LOG-NEW/src/db/open.native.ts src/db/open.native.ts
cp /c/Users/kubik/PUNCH-LOG-NEW/src/db/rows.native.ts src/db/rows.native.ts
```

Edits: database filename → `'worklog.db'`; the migration-runner logic (read `PRAGMA user_version`, apply `SCHEMA_V1` at 0, then each `MIGRATIONS[n]` in order inside a transaction, set `user_version`) ports verbatim against WorkLog's `schema.ts` exports (same export names by design). Remove any helper that references PunchLog-only tables; keep generic row helpers.

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm test`
Expected: green — including `src/platformSplit.test.ts`, which now proves the `.native.ts` suffix is doing its job (these two files import `expo-sqlite` and are exempt).

- [ ] **Step 3: Commit**

```bash
git add src/db/open.native.ts src/db/rows.native.ts
git commit -m "feat: SQLite open + migration runner via PRAGMA user_version"
```

---

### Task 12: Server-column reference generator + parity test (M1 keystone)

**Files:**
- Create: `scripts/gen-server-columns.mjs`, `src/db/serverColumns.generated.json`, `src/db/schemaParity.test.ts`
- Modify: `package.json` (add script)

**Interfaces:**
- Consumes: `DOMAIN_COLUMNS`, `SCHEMA_V1`, `MIGRATIONS` from `src/db/schema.ts`; `jobsight-backend/supabase/migrations/*.sql` (sibling clone, generator-time only — CI needs only the checked-in JSON).
- Produces: `serverColumns.generated.json` (`Record<table, string[]>`) and the both-directions parity test — the test class that caught the Phase 3 `width`/`height` FAIL.

- [ ] **Step 1: Write the generator**

`scripts/gen-server-columns.mjs`:

```js
/**
 * Regenerates src/db/serverColumns.generated.json from the sibling
 * jobsight-backend clone's migrations. Run after any backend schema change:
 *   npm run gen:server-columns
 * Tables tracked = the WorkLog app's DOMAIN_COLUMNS tables.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(HERE, '../../jobsight-backend/supabase/migrations');
const OUT = path.resolve(HERE, '../src/db/serverColumns.generated.json');

const TABLES = [
  'profiles', 'projects', 'project_members', 'report_member_prefs', 'daily_reports',
  'report_sections', 'report_crew', 'report_equipment', 'report_work_performed',
  'report_delays', 'report_safety_observations', 'report_weather', 'report_photos',
  'report_amendments', 'report_amendment_changes',
];

const CONSTRAINT_WORDS = new Set([
  'primary', 'unique', 'constraint', 'foreign', 'check', 'exclude', 'like', 'references',
]);

/** Body of the first top-level (...) after `from`, tracking paren depth. */
function parenBody(sql, from) {
  const open = sql.indexOf('(', from);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < sql.length; i += 1) {
    if (sql[i] === '(') depth += 1;
    if (sql[i] === ')') { depth -= 1; if (depth === 0) return sql.slice(open + 1, i); }
  }
  return null;
}

/** Split a CREATE TABLE body on top-level commas only. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0; let cur = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else { cur += ch; }
  }
  parts.push(cur);
  return parts;
}

const columns = Object.fromEntries(TABLES.map((t) => [t, new Set()]));
const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  for (const table of TABLES) {
    const createRe = new RegExp(`create table (if not exists )?(public\\.)?${table}\\b`, 'gi');
    for (const m of [...sql.matchAll(createRe)]) {
      const body = parenBody(sql, m.index);
      if (!body) continue;
      for (const line of splitTopLevel(body)) {
        const word = line.trim().split(/\s+/)[0]?.replace(/"/g, '').toLowerCase();
        if (word && !CONSTRAINT_WORDS.has(word)) columns[table].add(word);
      }
    }
    const alterRe = new RegExp(
      `alter table (if exists )?(only )?(public\\.)?${table}\\s+add column (if not exists )?"?([a-z_]+)"?`, 'gi');
    for (const m of [...sql.matchAll(alterRe)]) columns[table].add(m[5]);
    const dropRe = new RegExp(`alter table (if exists )?(only )?(public\\.)?${table}\\s+drop column (if exists )?"?([a-z_]+)"?`, 'gi');
    for (const m of [...sql.matchAll(dropRe)]) columns[table].delete(m[5]);
  }
}

const out = Object.fromEntries(TABLES.map((t) => [t, [...columns[t]].sort()]));
for (const [t, cols] of Object.entries(out)) {
  if (cols.length === 0) throw new Error(`No columns found for ${t} — parser or migrations problem`);
}
fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`Wrote ${OUT}\n`);
```

Add to `package.json` scripts: `"gen:server-columns": "node scripts/gen-server-columns.mjs"`.

- [ ] **Step 2: Generate and eyeball**

Run: `npm run gen:server-columns && git diff --stat`
Expected: `src/db/serverColumns.generated.json` created; spot-check `report_photos` includes `width`, `height`, `gps_lat`; `daily_reports` includes `report_date`, `status`.

- [ ] **Step 3: Write the parity test**

`src/db/schemaParity.test.ts`:

```ts
/**
 * Both-directions column parity between the app's SQLite mirror and the
 * server migrations (via the checked-in generated snapshot). Regenerate the
 * snapshot with `npm run gen:server-columns` whenever the backend changes.
 * This is the test class that caught the Phase 3 report_photos width/height
 * mismatch (08-phase3-verification.md, Check 1).
 */
import serverColumns from './serverColumns.generated.json';
import { DOMAIN_COLUMNS, MIGRATIONS, SCHEMA_V1 } from './schema';

/** App-side columns that deliberately have no server counterpart. */
const LOCAL_ONLY: Partial<Record<keyof typeof DOMAIN_COLUMNS, readonly string[]>> = {
  report_photos: ['local_uri', 'local_thumb_uri'],
};
/** Server-side columns the app deliberately never mirrors. */
const SERVER_ONLY: Partial<Record<keyof typeof DOMAIN_COLUMNS, readonly string[]>> = {};

const tables = Object.keys(DOMAIN_COLUMNS) as (keyof typeof DOMAIN_COLUMNS)[];

describe('schema parity (app ⇄ server)', () => {
  it('snapshot covers every DOMAIN_COLUMNS table', () => {
    for (const t of tables) expect(Object.keys(serverColumns)).toContain(t);
  });

  for (const table of tables) {
    const server: string[] = (serverColumns as Record<string, string[]>)[table] ?? [];
    const localOnly = LOCAL_ONLY[table] ?? [];
    const serverOnly = SERVER_ONLY[table] ?? [];

    it(`${table}: every server column is mirrored locally`, () => {
      for (const col of server) {
        if (serverOnly.includes(col)) continue;
        expect(DOMAIN_COLUMNS[table]).toContain(col);
      }
    });

    it(`${table}: every local domain column exists on the server`, () => {
      for (const col of DOMAIN_COLUMNS[table]) {
        if (localOnly.includes(col)) continue;
        expect(server).toContain(col);
      }
    });

    it(`${table}: local DDL defines every declared column`, () => {
      const create = SCHEMA_V1.find((s) => new RegExp(`CREATE TABLE IF NOT EXISTS ${table} `).test(s));
      expect(create).toBeDefined();
      const adds = Object.values(MIGRATIONS).flat()
        .filter((s) => new RegExp(`ALTER TABLE ${table} ADD COLUMN `).test(s));
      const ddl = [create, ...adds].join('\n');
      for (const col of DOMAIN_COLUMNS[table]) {
        expect(ddl).toMatch(new RegExp(`\\b${col}\\b`));
      }
    });
  }
});
```

Before running: check `src/db/schema.ts` — if `local_uri`/`local_thumb_uri` are NOT in `DOMAIN_COLUMNS.report_photos`, empty that `LOCAL_ONLY` entry. Adjust `LOCAL_ONLY`/`SERVER_ONLY` only with a comment citing the design doc that sanctions each exclusion; an undocumented exclusion is a parity failure, not a config knob. Enable JSON imports if tsc complains: add `"resolveJsonModule": true` to `tsconfig.json` compilerOptions.

- [ ] **Step 4: Run it**

Run: `npm test -- src/db/schemaParity.test.ts`
Expected: PASS. If a column mismatch appears, that is a REAL finding — reconcile against `docs/architecture/04-data-model.md` before touching either side (schema.ts is a Phase 3 artifact; a change to it needs the same scrutiny as a migration).

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-server-columns.mjs src/db/serverColumns.generated.json src/db/schemaParity.test.ts package.json tsconfig.json
git commit -m "test: both-directions schema parity against generated server column snapshot"
```

---

### Task 13: Repository seam (M1)

**Files:**
- Create: `src/data/types.ts`, `src/data/RepositoryProvider.tsx`, `src/data/sqliteRepo.native.ts`, `src/data/supabaseRepo.ts`, `src/data/platformRepo.native.ts`, `src/data/platformRepo.web.ts`, `src/data/index.ts`, `src/data/sqliteRepo.native.test.ts`
- Reference (pattern source): `/c/Users/kubik/PUNCH-LOG-NEW/src/data/platformRepoTypes.ts`, `platformRepo.native.ts`, `platformRepo.web.ts`, `RepositoryProvider.tsx`, `sqliteRepo.native.ts`, `supabaseRepo.ts`

**Interfaces:**
- Consumes: `openDb`/row helpers (Task 11), `supabase` (Task 8), `DOMAIN_COLUMNS` (schema.ts).
- Produces: `Repository` interface + `useRepository()` — **the only data surface screens may import** (doc 02 §C). M2 extends this interface; M1 ships it with the two read methods below plus the provider plumbing.

```ts
// src/data/types.ts
export interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
}

export interface DailyReportRow {
  readonly id: string;
  readonly project_id: string;
  readonly report_date: string; // YYYY-MM-DD
  readonly status: 'draft' | 'submitted' | 'locked';
}

export interface Repository {
  listProjects(): Promise<readonly ProjectRow[]>;
  getReportByDate(projectId: string, reportDate: string): Promise<DailyReportRow | null>;
}
```

- [ ] **Step 1: Write the failing repo test**

`src/data/sqliteRepo.native.test.ts` — test against an injected fake DB seam (mirror how PunchLog's `platformRepo.native.test.ts` fakes its DB — reuse that fixture style):

```ts
import { createSqliteRepo } from './sqliteRepo.native';

type Row = Record<string, unknown>;
function fakeDb(rows: { projects: Row[]; daily_reports: Row[] }) {
  return {
    getAllAsync: async (sql: string): Promise<Row[]> =>
      /FROM projects/i.test(sql) ? rows.projects : [],
    getFirstAsync: async (sql: string, params: readonly unknown[]): Promise<Row | null> => {
      if (!/FROM daily_reports/i.test(sql)) return null;
      const [projectId, reportDate] = params;
      return (
        rows.daily_reports.find((r) => r.project_id === projectId && r.report_date === reportDate) ?? null
      );
    },
  };
}

describe('sqliteRepo', () => {
  it('lists projects', async () => {
    const repo = createSqliteRepo(fakeDb({ projects: [{ id: 'p1', name: 'Site A', address: null }], daily_reports: [] }) as never);
    expect(await repo.listProjects()).toEqual([{ id: 'p1', name: 'Site A', address: null }]);
  });

  it('getReportByDate returns the matching row or null', async () => {
    const report = { id: 'r1', project_id: 'p1', report_date: '2026-07-18', status: 'draft' };
    const repo = createSqliteRepo(fakeDb({ projects: [], daily_reports: [report] }) as never);
    expect(await repo.getReportByDate('p1', '2026-07-18')).toEqual(report);
    expect(await repo.getReportByDate('p1', '2026-07-19')).toBeNull();
  });
});
```

Run: `npm test -- src/data`
Expected: FAIL — module not found.

- [ ] **Step 2: Implement the seam, following PunchLog's pattern files**

- `src/data/types.ts`: exactly the block in Interfaces above.
- `src/data/sqliteRepo.native.ts`: `export function createSqliteRepo(db: Db): Repository` where `Db` is the minimal query interface (`getAllAsync`, `getFirstAsync`) satisfied by both expo-sqlite's database and the test fake. Queries: `SELECT id, name, address FROM projects ORDER BY name` and `SELECT id, project_id, report_date, status FROM daily_reports WHERE project_id = ? AND report_date = ?`.
- `src/data/supabaseRepo.ts`: same two methods via `supabase.from('projects')/.from('daily_reports')` selects (web is online-only).
- `src/data/platformRepo.native.ts` / `platformRepo.web.ts`: pick sqlite vs supabase implementation — copy PunchLog's split idiom.
- `src/data/RepositoryProvider.tsx`: context + `useRepository()` hook — copy PunchLog's provider shape; mount it in `app/_layout.tsx` inside AuthProvider.
- `src/data/index.ts`: re-export `Repository`, row types, `RepositoryProvider`, `useRepository` only.

- [ ] **Step 3: Verify**

Run: `npm test && npm run typecheck`
Expected: everything green — including the grep guard proving `sqliteRepo.native.ts` is the only new sqlite-touching file and it carries the `.native` suffix.

- [ ] **Step 4: Commit**

```bash
git add src/data app/_layout.tsx
git commit -m "feat: repository seam — SQLite native / Supabase web split"
```

---

### Task 14: Slice verification gate (Definition of Done)

**Files:**
- Modify: `docs/superpowers/specs/2026-07-18-phase4-foundation-design.md` (tick the DoD checkboxes)

**Interfaces:**
- Consumes: everything above.
- Produces: the verified exit state — M2 and M3-native unblocked.

- [ ] **Step 1: Full automated gate**

Run: `npm run typecheck && npm test -- --coverage && npm run lint`
Expected: tsc green · all suites PASS (platform-split, paginate, mutationQueue @100%, conflict, cursors, theme, lib, auth, schemaParity, data) · lint clean.

- [ ] **Step 2: Web + native boot check**

With the local stack up (`supabase start` in `../jobsight-backend`) and `.env` populated:
- `npm run web`: sign in with the seeded demo `super` account → lands on Today → all four tabs navigate → camera button raised, `#3FA9F0`.
- `npm run android` (or `npm run ios` on a Mac): same flow; splash holds until hydration; session survives an app restart (SecureStore).

- [ ] **Step 3: Grep-guard spot audit**

Run: `grep -rn "from 'expo-sqlite'" src app --include='*.ts' --include='*.tsx' | grep -v '.native.'`
Expected: no output (belt-and-suspenders confirmation of the jest guard).

- [ ] **Step 4: Tick the spec's DoD checklist** in `docs/superpowers/specs/2026-07-18-phase4-foundation-design.md` — every box in "Definition of done (slice)" must be checkable; if one is not, fix the gap before this task completes.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-07-18-phase4-foundation-design.md
git commit -m "chore: Phase 4 foundation slice DoD verified"
```
