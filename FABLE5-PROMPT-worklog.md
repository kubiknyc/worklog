# BUILD PROMPT — WorkLog: Standalone Construction Daily Report App — JobSight Apps Suite (Claude Fable 5)

<!--
  Paste this entire file as the opening prompt. Everything in it is final:
  the open architecture questions were resolved against the real PunchLog
  codebase on 2026-07-15, and all embedded code is copied verbatim from that
  repo (post "PunchLog rename" commit). Do not relitigate decisions in §11.
-->

---

## 1. ROLE

You are a principal mobile engineer and product architect specializing in
offline-first construction field software. You are an expert in Expo / React
Native / TypeScript (strict) / Supabase, and in shipping apps through App
Store and Play Store review. You write production code — complete,
compiling, tested — never placeholders or pseudo-code.

## 2. MISSION

Build **WorkLog** — a standalone daily report mobile app, the second app
in the **JobSight Apps Suite**, a series of standalone, single-purpose
construction management apps — for App Store and Play Store distribution.
WorkLog and PunchLog (a punch-list app, built and preparing to ship) are
**peer apps** in the suite: WorkLog is independent, not a PunchLog
sub-brand or module. But the JobSight suite shares one technical and
visual identity, so WorkLog must mirror PunchLog's stack, architecture,
and design system **exactly**: same design tokens, same offline-first
sync pattern, same Supabase project. A superintendent who uses PunchLog
should feel WorkLog is the same product family the moment it opens —
under its own name.

## 3. USER & CONTEXT

- **Client:** Eli Vidyaev — Site Superintendent at GDC Contracting LLC (NYC
  high-end residential GC: brownstone, co-op, townhouse renovation) and a
  working developer (React/TypeScript/Next.js/Supabase/Tailwind/Drizzle).
  He will read your code; write for a peer.
- **Primary users:** site superintendents in the field — poor connectivity,
  gloved hands, bright sunlight, time-poor. **Daily entry must take under
  5 minutes.** Secondary users: PMs and owners reviewing reports.
- **Why this app exists:** a daily report is the construction industry's
  legal record of what happened on site. In dispute and delay claims it is
  evidence. Immutability, audit trails, and dispute-grade PDF output are
  core requirements, not features.

## 4. SUITE ARCHITECTURE (RESOLVED — build exactly this)

Three architecture questions were open; all three were resolved by
inspecting the PunchLog codebase and confirmed with Eli. The real PunchLog
code is embedded below — replicate it, don't approximate it.

### 4.1 Styling: copy PunchLog's theme verbatim, package-shaped

**Decision:** Copy the design system into WorkLog verbatim (no shared
npm package yet — PunchLog is mid-store-submission and won't be
restructured now). Structure WorkLog's `src/theme/` folder **exactly**
like PunchLog's, so a future extraction into a shared suite-level UI
package (e.g. `@jobsight/ui` — suite-branded, not PunchLog-branded; the
apps are peers) is a mechanical move for both apps.

PunchLog's theme lives in `src/theme/` as four files: `tokens.ts`,
`fonts.ts`, `ThemeProvider.tsx`, `appearanceStorage.ts` (a small
AsyncStorage read/write for the persisted theme + density choice), with an
`index.ts` barrel. Reproduce all of them. The two big ones follow verbatim.

**`src/theme/tokens.ts` — copy verbatim:**

```ts
/**
 * Design tokens for PunchLog — recreated verbatim from
 * design_handoff_native_app/DESIGN_SPEC.md ("Design tokens" section).
 *
 * Three switchable themes (Blueprint is the default), fixed status/priority
 * colors, density presets, and shared spacing/shape values.
 */

export type ThemeName = 'blueprint' | 'editorial' | 'beton';
export type DensityName = 'comfortable' | 'compact';
type ColorScheme = 'light' | 'dark';

export type ItemStatus = 'open' | 'in_progress' | 'review' | 'closed';
export type Priority = 'high' | 'medium' | 'low';

export interface Palette {
  readonly bg: string;
  readonly surface: string;
  readonly surface2: string;
  readonly text: string;
  readonly muted: string;
  readonly faint: string;
  readonly border: string;
  readonly accent: string;
  /** Foreground color to use on top of `accent`. */
  readonly accentInk: string;
  readonly scheme: ColorScheme;
}

/** Theme palettes (set on the root in the prototype as CSS custom properties). */
export const PALETTES: Readonly<Record<ThemeName, Palette>> = {
  blueprint: {
    bg: '#0C2944',
    surface: '#103A5C',
    surface2: '#0E3252',
    text: '#EAF4FF',
    muted: '#8FB6D6',
    faint: '#5E86A6',
    border: 'rgba(120,180,220,0.18)',
    accent: '#4FC3F7',
    accentInk: '#06243C',
    scheme: 'dark',
  },
  editorial: {
    bg: '#F0EBE0',
    surface: '#F8F4EB',
    surface2: '#EAE3D3',
    text: '#1F1B14',
    muted: '#645B4B', // WCAG AA: 6.1:1 on surface, 5.6:1 on bg (was #7A7163, 4.0:1 — failed)
    faint: '#6B6354', // WCAG AA: 5.4:1 on surface, 5.0:1 on bg (was #A89B82, 2.3:1 — failed)
    border: 'rgba(43,36,24,0.14)',
    accent: '#9A3B2E',
    accentInk: '#F5F0E6',
    scheme: 'light',
  },
  beton: {
    bg: '#C9C8C3',
    surface: '#D3D2CD',
    surface2: '#C0BFBA',
    text: '#46453F',
    muted: '#4A4945', // WCAG AA: 6.0:1 on surface, 5.4:1 on bg (was #7E7D78, 2.5:1 — failed)
    faint: '#525147', // WCAG AA: 5.3:1 on surface, 4.8:1 on bg (was #9A988F, 1.7:1 — failed)
    border: 'rgba(28,26,23,0.12)',
    accent: '#E8531F',
    accentInk: '#FFFFFF',
    scheme: 'light',
  },
} as const;

// Status/priority colors are per-theme: a single shared set cannot meet WCAG
// contrast (>=3:1 for these graphical indicators) against both the dark Blueprint
// surface and the light Editorial/Beton surfaces at once. Each value below clears
// 3:1 against its theme's surface, bg, and surface2 (verified, ratios in review).
export const STATUS_COLORS: Readonly<Record<ThemeName, Readonly<Record<ItemStatus, string>>>> = {
  blueprint: { open: '#FF6B6F', in_progress: '#8AA6F7', review: '#E8A100', closed: '#46C98A' },
  editorial: { open: '#E5484D', in_progress: '#3E63DD', review: '#A36C00', closed: '#1F8A50' },
  beton: { open: '#BE3137', in_progress: '#2F50C0', review: '#855700', closed: '#1A7745' },
} as const;

export const PRIORITY_COLORS: Readonly<Record<ThemeName, Readonly<Record<Priority, string>>>> = {
  blueprint: { high: '#FF6B6F', medium: '#E8A100', low: '#9AA7B4' },
  editorial: { high: '#E5484D', medium: '#A36C00', low: '#697787' },
  beton: { high: '#BE3137', medium: '#855700', low: '#586470' },
} as const;

// Error text is per-theme for the same reason: a light red (#FF8A8A) is legible
// on the dark Blueprint surface but ~1.5–2:1 — invisible — on the light
// Editorial/Beton surfaces. Each value clears WCAG AA (4.5:1) for text against
// its theme's surface and bg (dark reds on the light themes).
export const ERROR_COLORS: Readonly<Record<ThemeName, string>> = {
  blueprint: '#FF8A8A',
  editorial: '#B42318',
  beton: '#8E1B12',
} as const;

/** Standalone fixed accents. */
export const FIXED_COLORS = {
  /** Raised bottom-tab camera button. */
  camera: '#3FA9F0',
  /** Markup annotations (circle/arrow). */
  markup: '#FF5A3C',
  /** Login-screen error text only (login is always Blueprint). Themed surfaces
   * use the per-theme `theme.error` (see ERROR_COLORS) instead. */
  error: '#FF8A8A',
} as const;

export interface Density {
  readonly rowPad: number;
  readonly listGap: number;
}

export const DENSITIES: Readonly<Record<DensityName, Density>> = {
  comfortable: { rowPad: 15, listGap: 10 },
  compact: { rowPad: 11, listGap: 7 },
} as const;

/**
 * 4pt spacing scale with semantic names. Prefer these over inline pixel values
 * so vertical/horizontal rhythm stays consistent across screens. `xs`–`xxl`
 * cover the common range; reach past it only for one-off hero spacing.
 */
export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** Shared spacing + shape values (ranges from the spec, fixed to single values). */
export const RADII = {
  card: 18,
  pill: 12,
  input: 14,
  button: 14,
} as const;

export const SIZES = {
  screenPad: 16,
  buttonHeight: 50,
  inputHeight: 50,
} as const;

export const DEFAULT_THEME: ThemeName = 'blueprint';
export const DEFAULT_DENSITY: DensityName = 'comfortable';

export const THEME_NAMES: readonly ThemeName[] = ['blueprint', 'editorial', 'beton'];
```

Adaptation note (the ONLY permitted change to tokens): `ItemStatus` /
`STATUS_COLORS` model punch-list item states. WorkLog's report lifecycle
is `draft → submitted → locked` (+ `amended`). Keep the palette values
and the per-theme WCAG-audited approach, and map report states onto them
(draft→`in_progress` blue family, submitted→`review` amber family,
locked→`closed` green family, amended→`open` red family as an attention
state). Rename the type for the new domain (`ReportStatus`), keep
everything else identical.

**`src/theme/fonts.ts` — copy verbatim** (deps:
`@expo-google-fonts/archivo`, `@expo-google-fonts/jetbrains-mono`,
`@expo-google-fonts/spectral`):

```ts
/**
 * Font loading map + family-name constants.
 *
 * Archivo  → UI (weights 400–900)
 * JetBrains Mono → item codes / mono labels
 * Spectral → serif display moments (wordmark, hero %, item title, empty state)
 *
 * The string keys here are the family names referenced via `fontFamily` in
 * styles once `useFonts(FONT_MAP)` reports loaded. Every family listed loads
 * at splash and gates first render — only ship families that are actually used.
 */
import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  Archivo_900Black,
} from '@expo-google-fonts/archivo';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import {
  Spectral_400Regular,
  Spectral_600SemiBold,
  Spectral_700Bold,
} from '@expo-google-fonts/spectral';

/** Passed directly to `useFonts` from `expo-font`. */
export const FONT_MAP = {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
  Archivo_900Black,
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
  Spectral_400Regular,
  Spectral_600SemiBold,
  Spectral_700Bold,
} as const;

/** Named font families for use in `fontFamily` style props. */
export const FONTS = {
  ui: {
    regular: 'Archivo_400Regular',
    medium: 'Archivo_500Medium',
    semibold: 'Archivo_600SemiBold',
    bold: 'Archivo_700Bold',
    extrabold: 'Archivo_800ExtraBold',
    black: 'Archivo_900Black',
  },
  mono: {
    regular: 'JetBrainsMono_400Regular',
    medium: 'JetBrainsMono_500Medium',
    bold: 'JetBrainsMono_700Bold',
  },
  serif: {
    regular: 'Spectral_400Regular',
    semibold: 'Spectral_600SemiBold',
    bold: 'Spectral_700Bold',
  },
} as const;
```

**`src/theme/ThemeProvider.tsx`** — replicate PunchLog's exactly: a
`ThemeProvider` holding theme name + density, hydrated once from persisted
appearance storage (children render with defaults immediately; an
`isHydrated` flag lets the root hold the splash so returning users never
see a Blueprint flash; a `touchedRef` guard makes a manual change during
hydration win over the stale persisted value; write-through persistence
only after hydration). It exposes:

```ts
export interface Theme {
  readonly name: ThemeName;
  readonly densityName: DensityName;
  readonly colors: Palette;
  readonly density: Density;
  readonly status: (typeof STATUS_COLORS)[ThemeName];
  readonly priority: (typeof PRIORITY_COLORS)[ThemeName];
  /** Per-theme error text color (WCAG-AA on this theme's surfaces). */
  readonly error: string;
  readonly fixed: typeof FIXED_COLORS;
  readonly radii: typeof RADII;
  readonly sizes: typeof SIZES;
  readonly spacing: typeof SPACING;
  readonly fonts: typeof FONTS;
}

export function useTheme(): Theme;          // convenience hook
export function useThemeContext(): ThemeContextValue; // theme + setters + isHydrated
```

**Hard rule (same as PunchLog):** every component styles exclusively
through `useTheme()` tokens. Never hardcode a palette value. The navy
`#1A2B4A` / amber `#F5A623` palette from earlier drafts is
**superseded** by these real tokens.

### 4.2 Backend: SHARED Supabase project

**Decision:** WorkLog uses **the same Supabase project as PunchLog** —
the JobSight suite's shared backend. (Independence is a branding and
distribution property, not a backend one: one login and one project list
across the suite is the point.) One login, one `profiles` row, the same
`companies` / `projects` / `project_members` across the whole suite.
Per-app feature tables are added by **additive-only** migrations.

What already exists in the shared project (do NOT recreate; reference it):

- **Auth & profiles:** Supabase email+password auth;
  `profiles(id → auth.users, full_name, email, phone, company, trade,
  avatar_url, expo_push_token, created_at)` auto-created by a
  `handle_new_user()` trigger.
- **Tenancy:** `companies(id, name, created_by, created_at)` +
  `company_members(company_id, user_id, role company_role, created_at)`
  where `company_role = enum('admin','member')`. `projects.company_id` is
  a nullable link. Company ADMIN ⊇ project SUPER: the RLS helper
  functions were widened in place so a company admin can do everything a
  project super can on every company project.
- **Projects & membership:** `projects(id, name, address, created_by,
  created_at, company_id, code_prefix)`; `project_members(project_id,
  user_id, role project_role, created_at)` where
  `project_role = enum('super','sub')`. A `bootstrap_project_creator`
  trigger enrolls the creator as `'super'`.
- **RLS pattern (replicate for all new tables):** small SECURITY DEFINER
  helper functions with `set search_path = public`, then policies built on
  them. From the live schema:

```sql
create or replace function is_member(p uuid) returns boolean
  language sql security definer stable set search_path = public as $FN$
  select exists (select 1 from project_members
                 where project_id = p and user_id = auth.uid()); $FN$;

create or replace function is_super(p uuid) returns boolean
  language sql security definer stable set search_path = public as $FN$
  select exists (select 1 from project_members
                 where project_id = p and user_id = auth.uid() and role = 'super'); $FN$;

-- Policies then read like:
create policy projects_read on projects for select using (is_member(id));
create policy items_insert on items for insert with check (is_super(project_id));

-- And execute rights on helpers are revoked from clients:
revoke execute on function public.is_member(uuid) from anon, authenticated;
```

- **Storage:** private bucket per content type with path-encoding RLS
  (PunchLog: `punch-photos` bucket, paths `<projectId>/<itemId>/<photoId>.jpg`,
  policies parse the path with `split_part(name,'/',…)`). WorkLog adds its
  own bucket (e.g. `worklog-photos`,
  paths `<projectId>/<reportId>/<photoId>.jpg`) with the same pattern.
- **Edge functions already deployed:** `delete-account` (store-mandated
  account deletion), `invite-user`, `register-company`, `send-email`
  (Resend), `send-push` (Expo push), `ai-describe`. Reuse `delete-account`,
  `invite-user`, `send-push`, `send-email` as-is; add new functions only
  for daily-report needs (weather fetch, heavy PDF fallback).
- **Server-governed writes pattern:** PunchLog routes status changes
  through an `advance_status` RPC that enforces legal transitions
  server-side (a sub cannot close an item). Replicate this for the report
  lifecycle: `submit_report` / `lock_report` / `amend_report` RPCs that
  enforce draft→submitted→locked server-side, reject edits to locked rows
  at the database level (trigger or RPC-only writes), and write audit rows.
  Immutability that only exists in the UI is not immutability.

**Role mapping for WorkLog** (spec roles: superintendent / PM /
admin): superintendent → existing `project_members.role = 'super'`;
admin → existing `company_members.role = 'admin'`; **PM** has no existing
value — decide in the Architecture phase whether PM maps onto `'super'`
(simplest, zero migration) or needs an additive
`alter type project_role add value 'pm'` with helper updates. Flag the
tradeoff; do not silently break PunchLog's `is_super` semantics.

**Repo strategy:** WorkLog lives in **its own repository**. The shared
Supabase project has a **dedicated backend repo — `jobsight-backend`** —
holding the single migration timeline, all edge functions, `config.toml`,
and the guarded `seed.sql` (extracted from the PunchLog repo on
2026-07-15). All WorkLog schema deliverables target that repo; the
WorkLog app repo may keep reference copies only.

**Migration rules (this is a shared production database):**

1. Additive only: new tables (`daily_reports`, `report_*`), new enum
   values, new nullable columns. Never alter or drop anything PunchLog
   reads.
2. Deliver migrations as plain SQL files in the `jobsight-backend` repo's
   `supabase/migrations/` timestamp-name style (the project's migration
   history is plain SQL — Drizzle may be used as an authoring layer, but
   the deliverable is SQL compatible with `supabase migration up`).
3. Idempotent guards (`if not exists`, DO-block enum guards) — the
   existing later migrations model this.
4. Every new table gets RLS enabled + policies via the helper-function
   pattern above, in the same migration that creates it.
5. New/changed edge functions (weather fetch, heavy-PDF fallback,
   `delete-account` extension) are delivered into `jobsight-backend`'s
   `supabase/functions/`, not the app repo.

**Client env/config:** same pattern as PunchLog —
`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` (same values,
same project), client throws at startup if missing. Secrets
(weather API if any, Resend, push) live in edge functions via
`supabase secrets set`, never in the app bundle.

**Supabase client — replicate PunchLog's verbatim** (this supersedes the
earlier "AsyncStorage" research recommendation; PunchLog ships a chunked
SecureStore adapter because session JSON exceeds SecureStore's ~2 KB
value limit and refresh tokens must not sit in cleartext):

```ts
/**
 * Supabase client (auth/data/storage).
 *
 * Reads public env vars injected by Expo at build time, plus the URL polyfill
 * required by supabase-js on React Native. Session tokens are persisted in the
 * device keychain via `expo-secure-store` (NOT AsyncStorage) — the refresh token
 * grants indefinite access, so it must not sit in cleartext where a rooted device
 * or an unencrypted backup can read it. On web there is no keychain, so the
 * online-only web build falls back to localStorage (supabase-js's own web
 * default); the router's Node render persists nothing.
 */
import 'react-native-url-polyfill/auto';

import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';

import type { Database } from './types';

/**
 * SecureStore-backed storage adapter for the Supabase auth session.
 *
 * SecureStore warns (and on iOS can refuse) values over ~2 KB, and a Supabase
 * session JSON (access + refresh JWT) routinely exceeds that. So values are
 * chunked: the primary key holds a chunk count, and `<key>.0`, `<key>.1`, …
 * hold the slices. Reads reassemble; writes/removes clean up any prior chunks.
 */
const CHUNK_SIZE = 2000;

function chunkKey(key: string, index: number): string {
  return `${key}.${index}`;
}

async function clearChunks(key: string): Promise<void> {
  const countRaw = await SecureStore.getItemAsync(key);
  const count = countRaw ? parseInt(countRaw, 10) : 0;
  if (Number.isNaN(count) || count <= 0) {
    await SecureStore.deleteItemAsync(key);
    return;
  }
  for (let i = 0; i < count; i += 1) {
    await SecureStore.deleteItemAsync(chunkKey(key, i));
  }
  await SecureStore.deleteItemAsync(key);
}

const SecureStoreAdapter = {
  async getItem(key: string): Promise<string | null> {
    const countRaw = await SecureStore.getItemAsync(key);
    if (countRaw == null) return null;
    const count = parseInt(countRaw, 10);
    if (Number.isNaN(count) || count <= 0) return null;
    const parts: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      if (part == null) return null; // a missing slice means a corrupt/partial write
      parts.push(part);
    }
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    await clearChunks(key); // drop any larger prior value's leftover slices
    const count = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
    for (let i = 0; i < count; i += 1) {
      await SecureStore.setItemAsync(chunkKey(key, i), value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
    await SecureStore.setItemAsync(key, String(count));
  },
  async removeItem(key: string): Promise<void> {
    await clearChunks(key);
  },
};

/**
 * Web storage adapter. Web builds must never touch SecureStore: the native
 * module doesn't exist there, and during Expo Router's Node render (static/SSR
 * pass, where `window` is also absent) the call throws and kills the dev
 * server. localStorage matches supabase-js's own web default; the web target
 * is an online-only companion surface, so the keychain-level threat model in
 * the header doesn't apply.
 */
const WebStorageAdapter = {
  async getItem(key: string): Promise<string | null> {
    if (typeof window === 'undefined') return null; // Node render: no session
    return window.localStorage.getItem(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(key);
  },
};

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Set EXPO_PUBLIC_SUPABASE_URL and ' +
      'EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file (see .env.example).',
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: Platform.OS === 'web' ? WebStorageAdapter : SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    // No URL-based session detection on native; deep-link auth lands later.
    detectSessionInUrl: false,
  },
});

// Supabase's recommended React Native wiring: the auto-refresh timer only runs
// reliably while the app is foregrounded, so start it on `active` and stop it
// otherwise (a backgrounded timer would fire late and let the session lapse).
// Web tabs refresh fine without this, so guard to native.
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}
```

Never force logout on a token-refresh failure while offline — a
superintendent in a basement keeps working; the session refreshes on
reconnect.

### 4.3 Sync engine: replicate PunchLog's pattern faithfully

**Decision:** Do NOT extract a shared sync package (PunchLog is
about-to-ship, tested code; generalizing it now is schedule risk), and do
NOT substitute WatermelonDB or any other sync library — that earlier
recommendation is superseded. Replicate PunchLog's expo-sqlite + custom
sync engine **faithfully**, swapping only the domain: daily-report
mutation kinds instead of punch-list ones. The real core code is embedded
below; your implementation must exhibit the same behaviors.

**Architecture shape (mirror this file layout):**

```
src/data/       repository seam — screens ONLY talk to this interface
                (SQLite impl on device, Supabase impl on web)
src/db/         SQLite schema + IO, native-only (*.native.ts)
src/sync/       pure logic (Jest-tested, no native imports) + native adapters
  types.ts          mutation payloads, MutationStore/CursorStore seams  [pure]
  engineApi.ts      SyncState + SyncEngineApi surface                   [pure]
  mutationQueue.ts  error classification, retry/park policy, drain order[pure]
  conflict.ts       pull-vs-dirty-row conflict policy                   [pure]
  cursors.ts        keyset pull cursors                                 [pure]
  paginate.ts       pull pagination                                     [pure]
  engine.native.ts  orchestrator (push-then-pull, single-flight)
  push.native.ts    per-kind push handlers → Supabase
  pull.native.ts    keyset pulls → SQLite upserts
  store.native.ts   MutationStore/CursorStore over SQLite
  outbox.native.ts  durable photo-bytes outbox (app-document dir)
  context.native.ts SyncContext = { db, mutations, cursors }
```

**Platform split (hard rule, verbatim from PunchLog):** native-only code
goes in `*.native.ts` files. The web import graph must never reach
`src/db` or the sync engine — Metro resolves static imports regardless of
`Platform.OS`. After touching data/sync, this grep must return nothing:

```
grep -rln "from '.*\.native'\|expo-sqlite\|@react-native-community/netinfo" src app \
  --include='*.ts*' | grep -v test | grep -v '\.native\.'
```

**Core invariants (all present in the embedded code — keep every one):**

1. **Client UUID = final server id.** Every row is created locally with a
   client-generated UUID that IS the server primary key; retries dedup on
   it, photos know their full storage path at capture.
2. **Push-then-pull; pull only when push fully drained** — reads never
   show a half-synced world.
3. **Single-flight with coalescing** — one run at a time; triggers during
   a run schedule exactly one re-run.
4. **Offline is not failure.** Transport-level failures never count
   toward the retry ceiling — a week off-grid can't park valid writes.
5. **Retry ceiling parks, never drops.** After 5 judged failures a
   mutation is `parked` and surfaced in the UI for explicit user retry.
   RLS denials evict the local row (the server will never accept it);
   deterministic rejections park immediately.
6. **Dirty-row protection.** Local rows carry `_dirty`/`_pending` flags; a
   pull never overwrites a row that still has an unpushed local edit, and
   `_dirty` clears only when no other queued mutation targets that row.
7. **Photos ride the same queue, drained last.** Bytes live in a durable
   outbox (app-document dir, not the purgeable cache); JSON mutations
   drain first so a slow multi-MB upload can't stall cheap writes; a
   storage 409 on the UUID path means a previous attempt landed — treat
   as success.
8. **Non-status fields are last-write-wins by server `updated_at`; never
   send client timestamps.** Status/lifecycle transitions go through
   server RPCs only.

**`src/sync/types.ts` — PunchLog verbatim.** Replace the five punch-list
payload kinds with daily-report kinds (e.g. `create_report`,
`update_section`, `submit_report`, `create_amendment`, `add_photo`, …)
but keep the exact structure: payload union tagged by `kind`, `Mutation`
envelope, `MutationStatus = 'pending' | 'parked'`, `ErrorClass`, and the
`MutationStore`/`CursorStore` seams:

```ts
/**
 * `pending` mutations drain on the next sync; `parked` ones hit the retry ceiling
 * or a permanent error and wait for an explicit user retry (surfaced in the UI).
 */
export type MutationStatus = 'pending' | 'parked';

// … per-kind payload interfaces, each carrying the client UUIDs it produces …
// PunchLog example (photo — note the durable outbox URI and capture-known path):
export interface AddPhotoPayload {
  readonly photoId: string; // client UUID = final server id (and the outbox file name)
  readonly itemId: string;
  readonly projectId: string;
  readonly storagePath: string;
  /** Durable outbox file URI (app-document dir, not the purgeable OS cache). */
  readonly localUri: string;
  readonly width: number;
  readonly height: number;
  readonly markups: readonly PhotoMarkup[];
}

export type MutationPayload =
  | { readonly kind: 'create_item'; readonly data: CreateItemPayload }
  | { readonly kind: 'update_status'; readonly data: UpdateStatusPayload }
  | { readonly kind: 'add_comment'; readonly data: AddCommentPayload }
  | { readonly kind: 'reassign'; readonly data: ReassignPayload }
  | { readonly kind: 'add_photo'; readonly data: AddPhotoPayload };

export interface Mutation {
  /** Idempotency key — the client UUID of the durable artifact this produces. */
  readonly clientId: string;
  readonly payload: MutationPayload;
  readonly createdAt: string;
  readonly attempts: number;
  readonly status: MutationStatus;
  readonly lastError: string | null;
}

/**
 * How a failed push attempt is categorized — drives retry vs park vs evict.
 * `offline` is transport-level (no connectivity): retried like `retryable` but
 * never counted toward the retry ceiling, so being off-grid can't park a write.
 */
export type ErrorClass = 'retryable' | 'permanent' | 'evict' | 'offline';

/** Persistence seam for the queue. Implemented by `store.native`; never in Jest. */
export interface MutationStore {
  enqueue(m: Mutation): Promise<void>;
  /** Oldest-first, `pending` only. */
  pending(): Promise<Mutation[]>;
  /** All mutations (for the sync-status UI), newest issue first. */
  all(): Promise<Mutation[]>;
  replace(m: Mutation): Promise<void>;
  remove(clientId: string): Promise<void>;
  /** Flip a parked mutation back to pending for an explicit user retry. */
  unpark(clientId: string): Promise<void>;
}

/** Persistence seam for pull cursors. Implemented by `store.native`. */
export interface CursorStore {
  get(scope: string): Promise<string | null>;
  set(scope: string, value: string): Promise<void>;
}
```

**`src/sync/engineApi.ts` — copy verbatim** (pure surface the UI and web
bundle depend on):

```ts
export interface SyncState {
  readonly online: boolean;
  readonly syncing: boolean;
  /** Mutations queued for the next sync. */
  readonly pending: number;
  /** Mutations that hit a permanent error / the retry ceiling — need attention. */
  readonly parked: number;
  readonly lastError: string | null;
  /**
   * Bumped after every successful pull. Screens subscribe to this to refetch
   * when a background sync lands new server data (see useRefreshOnFocusAndSync).
   */
  readonly completedPulls: number;
}

export interface SyncEngineApi {
  /** Subscribe NetInfo/AppState triggers and kick the first sync. */
  start(): void;
  /** Tear down listeners + any pending debounce (call on provider unmount). */
  stop(): void;
  getState(): SyncState;
  subscribe(fn: (s: SyncState) => void): () => void;
  run(): Promise<void>;
  /** Re-queue every parked mutation and sync (explicit user retry). */
  retryParked(): Promise<void>;
}

export const IDLE_SYNC_STATE: SyncState = {
  online: true,
  syncing: false,
  pending: 0,
  parked: 0,
  lastError: null,
  completedPulls: 0,
};
```

**`src/sync/mutationQueue.ts` — copy verbatim** (pure queue policy; this
is the heart of the engine's reliability and is 90% domain-agnostic —
only `orderForDrain` and `rowTargetOf` mention concrete kinds/tables;
adapt those two to daily-report kinds and tables):

```ts
import type { ErrorClass, Mutation, MutationPayload } from './types';

/** Attempts after which a still-retryable mutation is parked for manual retry. */
export const RETRY_CEILING = 5;

interface SupabaseLikeError {
  readonly code?: string;
  readonly status?: number;
  readonly message?: string;
  readonly name?: string;
}

function asError(err: unknown): SupabaseLikeError {
  if (err && typeof err === 'object') return err as SupabaseLikeError;
  return { message: String(err) };
}

/**
 * Map a push failure to an action:
 * - `evict`    — RLS/authorization denial (Postgres 42501, HTTP 403). The
 *                server won't ever accept this write; drop the local row too.
 * - `permanent`— a deterministic rejection (illegal transition 22000, check
 *                violation 23514, …). Parking it and surfacing beats looping.
 * - `retryable`— 5xx/auth-refresh/unknown — back off and try again next sync.
 * - `offline`  — transport failure (no reply at all). Retried, but exempt from
 *                the ceiling: a week without signal must not park valid writes.
 */
export function classifyError(err: unknown): ErrorClass {
  const e = asError(err);
  const code = e.code ?? '';
  const status = e.status ?? 0;

  if (code === '42501' || status === 403) return 'evict';

  // 401 = expired/invalid access token, not an authorization denial. The
  // Supabase client refreshes the session and the next sync retries; a genuinely
  // dead token just keeps failing until the retry ceiling parks it. Evicting here
  // would silently delete a still-valid offline write.
  if (status === 401) return 'retryable';

  // Server errors are transient but count toward the ceiling — a persistently
  // failing server should eventually park and surface, not loop silently.
  if (status >= 500) return 'retryable';
  // No HTTP status at all → the request never got a response (airplane mode,
  // dead wifi, DNS). This is the normal offline case, not a server verdict.
  if (status === 0 && (e.name === 'TypeError' || /network|fetch|timeout/i.test(e.message ?? ''))) {
    return 'offline';
  }

  // Deterministic rejections: SQL data/constraint errors (22xxx/23xxx) and
  // PL/pgSQL-raised errors. Match the PL/pgSQL SQLSTATE class (P0xxx: P0001
  // raise, P0002 not-found) plus our custom stale-replace code 'PL001' — but
  // NOT PostgREST's 'PGRST###' codes, some of which (e.g. PGRST301 expired JWT)
  // are retryable. A blanket startsWith('P') swept those in by mistake.
  if (/^(22|23)/.test(code)) return 'permanent';
  if (code.startsWith('P0') || code === 'PL001') return 'permanent';

  // 4xx that isn't auth → deterministic; anything else → give it another go.
  if (status >= 400 && status < 500) return 'permanent';
  return 'retryable';
}

/**
 * Normalize a storage-js error before `classifyError`. StorageApiError
 * carries the HTTP status as a *string* `statusCode` (older releases omit the
 * numeric `status` entirely), so an unnormalized "403" would fall through every
 * status check and misclassify an RLS denial as retryable.
 */
export function normalizeStorageError(err: unknown): unknown {
  if (!err || typeof err !== 'object') return err;
  const e = err as SupabaseLikeError & { statusCode?: string | number };
  const numeric =
    typeof e.status === 'number' && e.status !== 0
      ? e.status
      : typeof e.statusCode === 'number'
        ? e.statusCode
        : typeof e.statusCode === 'string'
          ? parseInt(e.statusCode, 10)
          : NaN;
  if (!Number.isFinite(numeric) || numeric <= 0) return err;
  return { name: e.name, message: e.message, code: e.code, status: numeric };
}

/**
 * True when a storage upload failed because the object already exists
 * (HTTP 409 "Duplicate"). The bucket deliberately has no storage UPDATE policy
 * (so `upsert: true` is unavailable — its conflict path is an UPDATE → RLS
 * denial); a 409 on our client-UUID path can only mean a previous attempt's
 * bytes landed before a crash/timeout, so the caller treats it as success and
 * proceeds to the row insert — bytes→crash→retry converges.
 */
export function isDuplicateUpload(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as SupabaseLikeError & { statusCode?: string | number; error?: string };
  if (e.status === 409 || String(e.statusCode ?? '') === '409') return true;
  // Older storage-api releases report the duplicate as 400 + error 'Duplicate'.
  return /duplicate|already exists/i.test(`${e.error ?? ''} ${e.message ?? ''}`);
}

/**
 * Drain order: JSON mutations first (cheap, oldest-first), `add_photo`
 * last (also oldest-first) — one slow multi-MB upload on flaky cell must not
 * transiently stall status/comment writes queued behind it. Safe to reorder:
 * no mutation ever depends on a photo, while photos DO depend on their item's
 * create_item — which, being JSON, still lands first.
 */
export function orderForDrain(pending: readonly Mutation[]): Mutation[] {
  const json = pending.filter((m) => m.payload.kind !== 'add_photo');
  const photos = pending.filter((m) => m.payload.kind === 'add_photo');
  return [...json, ...photos];
}

/** A mutation as first enqueued: pending, zero attempts. */
export function newMutation(
  clientId: string,
  payload: MutationPayload,
  createdAt: string,
): Mutation {
  return {
    clientId,
    payload,
    createdAt,
    attempts: 0,
    status: 'pending',
    lastError: null,
  };
}

/**
 * Fold a push outcome into the mutation. Pure: returns the next queue state and
 * whether the caller must evict the local row. Success → remove. Retryable →
 * bump attempts (park at the ceiling). Offline → stay pending, attempts
 * untouched. Permanent/evict → park immediately.
 */
export function applyOutcome(m: Mutation, outcome: PushOutcome): AppliedOutcome {
  if (outcome.ok) return { next: null, evict: false };

  const cls = classifyError(outcome.error);
  const lastError = messageOf(outcome.error);

  // Offline is not a failed attempt — nothing was judged. Leave the mutation
  // exactly as queued so extended offline use can never park valid work.
  if (cls === 'offline') {
    return { next: { ...m, lastError }, evict: false };
  }

  const attempts = m.attempts + 1;

  if (cls === 'evict') {
    return { next: { ...m, attempts, status: 'parked', lastError }, evict: true };
  }
  if (cls === 'permanent') {
    return { next: { ...m, attempts, status: 'parked', lastError }, evict: false };
  }
  // retryable
  const status = attempts >= RETRY_CEILING ? 'parked' : 'pending';
  return { next: { ...m, attempts, status, lastError }, evict: false };
}
```

(Also replicate `rowTargetOf` / `otherMutationTargetsRow` — which local
row a mutation dirties, and the guard that `_dirty` clears only when no
other queued mutation still targets that row — and the
`PushOutcome`/`AppliedOutcome` interfaces, exactly as in PunchLog.)

**`src/sync/engine.native.ts` — copy verbatim, it is domain-agnostic:**

```ts
/**
 * Sync engine: orchestrates push-then-pull and exposes an observable state for
 * the sync-status UI. Native-only.
 *
 * - push-then-pull: pull runs only when push fully drained, so reads never show
 *   a half-synced world.
 * - single-flight: one run at a time; a trigger during a run schedules exactly
 *   one re-run afterward (coalesces bursts).
 * - triggers: NetInfo reconnect (offline→online edge) and AppState foreground,
 *   both debounced.
 */
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import type { SyncContext } from './context.native';
import { IDLE_SYNC_STATE, type SyncEngineApi, type SyncState } from './engineApi';
import { push } from './push.native';
import { pull } from './pull.native';

const DEBOUNCE_MS = 600;

export class SyncEngine implements SyncEngineApi {
  private state: SyncState = IDLE_SYNC_STATE;
  private listeners = new Set<(s: SyncState) => void>();
  private running = false;
  private rerun = false;
  private stopped = true;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private unsubNet: (() => void) | null = null;
  private appStateSub: { remove: () => void } | null = null;

  constructor(private readonly ctx: SyncContext) {}

  getState(): SyncState {
    return this.state;
  }

  subscribe(fn: (s: SyncState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private set(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  private async refreshCounts(): Promise<void> {
    const all = await this.ctx.mutations.all();
    this.set({
      pending: all.filter((m) => m.status === 'pending').length,
      parked: all.filter((m) => m.status === 'parked').length,
    });
  }

  start(): void {
    this.stopped = false;
    this.unsubNet = NetInfo.addEventListener((s) => {
      const online = !!s.isConnected;
      const wasOffline = !this.state.online;
      this.set({ online });
      if (online && wasOffline) this.schedule();
    });
    this.appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') this.schedule();
    });
    void this.refreshCounts();
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    this.unsubNet?.();
    this.appStateSub?.remove();
    if (this.debounce) clearTimeout(this.debounce);
  }

  /** Debounced trigger — coalesces rapid reconnect/foreground events. */
  schedule(): void {
    // An in-flight run's `finally` may reschedule after stop(); don't let a
    // sync start against a torn-down provider.
    if (this.stopped) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.run(), DEBOUNCE_MS);
  }

  /** Flip every parked mutation back to pending and sync (explicit user retry). */
  async retryParked(): Promise<void> {
    const all = await this.ctx.mutations.all();
    for (const m of all) if (m.status === 'parked') await this.ctx.mutations.unpark(m.clientId);
    await this.run();
  }

  async run(): Promise<void> {
    if (this.stopped) return;
    // Offline: don't attempt the network at all. Every write nudges a run, and
    // failed offline attempts used to burn the retry ceiling and park valid
    // mutations. Keep the queue counts fresh and wait for the reconnect edge
    // (the NetInfo listener schedules a run the moment we're back online).
    if (!this.state.online) {
      await this.refreshCounts();
      return;
    }
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    this.set({ syncing: true, lastError: null });
    try {
      const result = await push(this.ctx);
      if (result.ok) {
        await pull(this.ctx);
        // Tell subscribed screens fresh server data landed locally.
        this.set({ completedPulls: this.state.completedPulls + 1 });
      }
      await this.refreshCounts();
    } catch (err) {
      this.set({ lastError: err instanceof Error ? err.message : 'Sync failed' });
    } finally {
      this.running = false;
      this.set({ syncing: false });
      if (this.rerun) {
        this.rerun = false;
        this.schedule();
      }
    }
  }
}
```

**SQLite schema conventions (`src/db/schema.ts`)** — mirror PunchLog's
exactly:

- Pure strings only (no native imports) so Jest can assert **column
  parity** between the local schema and `supabase/migrations/*` without
  opening a database. Ship the same parity test.
- Versioned DDL: `SCHEMA_VERSION` + `MIGRATIONS[n]` upgrades (n-1)→n via
  `PRAGMA user_version`, applied in one transaction with the version stamp.
- Type mapping: uuid/text/date/timestamptz → `TEXT`; int → `INTEGER`;
  real → `REAL`; jsonb/arrays → `TEXT` holding JSON.
- Local-only columns prefixed `_`: `_dirty` (unpushed local edit),
  `_pending` (photo captured locally, upload unconfirmed), plus a
  `DOMAIN_COLUMNS` map the parity test reads.
- No local FK constraints — the server is the integrity authority.
- Sync bookkeeping tables verbatim:

```sql
CREATE TABLE IF NOT EXISTS sync_mutations (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS sync_cursors (scope TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

**Pull conventions:** keyset pagination on `(updated_at, id)` per scope
(cursor scope keys like `reports:<projectId>`), upserts that never touch
local-only columns, and periodic id-sweep reconciles that skip
`_pending`/`_dirty` rows. Conflict policy: a dirty local row survives
last-write-wins until its mutation drains; conflicts are logged and
surfaced, never silently dropped (spec §5 requires a resolution surface).

**Repository seam:** screens and components import **only** the
`src/data` repository interface — never the Supabase client, never
`src/db`, never the sync engine. The repository has a SQLite
implementation on device (writes locally + enqueues mutations +
nudges the engine) and a Supabase implementation on web (online-only).
Web runs online-only; native is offline-first. Same rule as PunchLog.

### 4.4 Photo pipeline & the EXIF divergence (decided)

PunchLog's pipeline (replicate the mechanics): every photo — camera or
library — passes through a single post-processing step before anything
else touches it: re-encode to JPEG at ≤1280px longest edge / ~0.6 quality
via `expo-image-manipulator` (which also bakes EXIF orientation into the
pixels), then move the file out of the purgeable OS cache into a durable
app-document `captures/` directory that survives until the repository's
outbox takes ownership. Photos are inserted locally with `_pending = 1` +
the outbox URI; push success alone clears them.

**Deliberate divergence (Eli's decision — do not "fix" this):** PunchLog
strips EXIF/GPS for privacy. WorkLog **preserves capture timestamp + GPS
provenance** — daily reports are dispute evidence and provenance is the
point. Two consequences you must handle:

1. `expo-image-manipulator` re-encoding drops EXIF. So capture EXIF
   (`exif: true` on `expo-camera`/`expo-image-picker`) **before**
   compression, persist `captured_at`, `gps_lat`, `gps_lng`, `gps_accuracy`
   as first-class columns on the photo row (local + Postgres), embed them
   in the PDF photo sheets, and re-inject or sidecar them as needed.
   State your chosen mechanism as an ASSUMPTION in the Architecture phase.
2. WorkLog's privacy declarations differ from PunchLog's: App Privacy
   nutrition labels and the Play Data Safety form must declare precise
   location collection, and the privacy policy must say photos retain
   location metadata. PunchLog's policy text cannot be copy-pasted.

## 5. CORE FEATURE REQUIREMENTS (LOCKED — verbatim from the approved spec)

**Report lifecycle**
- One report per project per day.
- Draft → submitted → locked. Locked reports are immutable; corrections via AMENDMENTS with full audit trail (who/when/what, original preserved) — legal defensibility is a core requirement (dispute/delay claims).

**Report sections**
- Weather (auto-fetched by project geolocation, timestamped snapshot, manual override)
- Crew/manpower by subcontractor trade (headcount, hours)
- Work performed (by area/trade)
- Deliveries
- Equipment on site
- Inspections (agency, inspector, result, notes)
- Safety observations & incidents
- Delays & impacts (cause, duration, responsible party, cost/schedule impact)
- Visitors
- RFIs / issues raised
- General notes

**Killer features**
- **Smart carry-forward:** one-tap roll of yesterday's crew, equipment, and open items into today's draft (individually editable). Competitors (Raken) lack this — top user request.
- **Fast photo workflow:** camera-first batch capture; per-photo caption + trade tag + location/room tag; timestamp/GPS EXIF preserved; client-side compression; instant local thumbnails with lazy full-res; background upload queue; in-app zoom/lightbox. Slow photos are competitors' #1 complaint — beat them here.
- **Voice-to-text** for notes fields (on-device).
- **PDF export:** branded, dispute-grade — logo, all sections, photo sheets, digital signature block, page numbers, generated timestamp. Shareable via email/Files.

**Platform features**
- Multi-project with NO artificial offline project cap (Raken caches only 5 — don't copy that).
- Roles: superintendent / PM / admin, enforced via Supabase RLS + project membership (not just UI).
- Report history: calendar view + filterable list (project, date range, status, trade, keyword, has-incident, has-delay).
- Weekly rollup summaries (manpower, progress, delays).
- Company branding settings (logo, colors, report header/footer, distribution lists).
- Report customization: admins can mark fields required and toggle sections.
- In-app account deletion (store-mandated — see §8; the shared project's `delete-account` edge function already exists — extend it to cover daily-report data).

**Offline-first (non-negotiable)**
- Full report creation AND photo capture with zero connectivity.
- Local-first DB (expo-sqlite, per PunchLog pattern); background sync queue; per-report and global sync status indicators (pending/syncing/synced/error/conflict); conflict logging with resolution surface; never silently lose field data.

## 6. TECH STACK (FIXED — no substitutions without a flagged tradeoff)

Pinned to PunchLog's shipping stack (from its `package.json`):

- **Expo SDK 54** / **React Native 0.81.5** / **React 19.1** /
  **Expo Router ~6.0** (typed routes) / **TypeScript ~5.9 strict**
- **Supabase**: `@supabase/supabase-js ^2.108`, shared project per §4.2
- **Offline:** `expo-sqlite ~16.0` + the replicated sync engine per §4.3;
  `@react-native-community/netinfo 11.4`
- **Already proven in PunchLog — use the same:** `expo-camera`,
  `expo-image-picker`, `expo-image-manipulator`, `expo-image`,
  `expo-file-system`, `expo-print` + `expo-sharing` (PDF),
  `expo-secure-store`, `expo-notifications`, `expo-font` +
  `@expo-google-fonts/{archivo,jetbrains-mono,spectral}`,
  `expo-splash-screen`, `expo-updates` (EAS Update,
  `runtimeVersion.policy = "fingerprint"`), `@sentry/react-native`,
  `react-native-gesture-handler`, `react-native-reanimated`,
  `react-native-webview`
- **New for this app (validated in research):** `expo-location` (weather
  geolocation + photo provenance), `expo-speech-recognition`
  (on-device voice-to-text), `react-native-signature-canvas`
  (PDF signature block)
- **Weather:** a Supabase Edge Function calling **Open-Meteo** (no API
  key needed; keys — if a provider is swapped — stay server-side).
  Snapshot is fetched by project geolocation, stored on the report with
  its fetch timestamp, manually overridable, and cached so an offline
  morning still gets a draft (fill weather on next sync if absent).
- **PDF:** `expo-print` on-device for typical reports; a Supabase Edge
  Function fallback for heavy photo-sheet PDFs. PunchLog has a working
  HTML-report pipeline (`src/report/`: `renderReportHtml.ts`, platform
  `printReport.native/web.ts`, `embedPhoto.native/web.ts`) — follow its
  shape.
- **Testing:** jest-expo for unit tests (pure sync logic, report
  assembly, schema parity), same layout rule as PunchLog: **never put
  test files under `app/`** (Expo Router bundles every `app/` file into
  the native app; a colocated `*.test.tsx` breaks the device bundle and
  neither jest nor tsc catches it). Tests live next to their `src/`
  modules.

**Navigation (mirror PunchLog's Expo Router conventions):** routes in
`app/` — `(auth)/login`, a `(tabs)/` group (PunchLog:
`index`/`list`/`plan`/`tasks`/`settings`; WorkLog: today's report,
history/calendar, photos, settings — finalize in the PRD), dynamic detail
routes like `report/[id]`. Creation flows are **sheet components, not
routes** (PunchLog's item creation is a sheet). Login screen always
renders in Blueprint theme.

## 7. DESIGN REQUIREMENTS

- **Identical look and feel to PunchLog** — the tokens, fonts, and
  ThemeProvider in §4.1 are the design system. Same three switchable
  themes (Blueprint default / Editorial / Béton), same density presets,
  same radii/spacing/sizes, same component patterns (cards, pills,
  sheets, status chips, sync banner, empty states). This shared visual
  identity is what makes the JobSight Apps Suite read as one family.
- Mobile-first, field-optimized: **≥48px touch targets**, high-contrast /
  sunlight-readable (the token sets are already WCAG-AA audited — keep
  that property for any new color), gloved-hand friendly.
- **Daily entry completable in under 5 minutes:** steppers, chips, and
  pickers over free typing; smart carry-forward as the default morning
  flow; optimistic UI on all local writes.
- Professional, not consumer-cute — these documents go to owners and
  lawyers.
- Accessibility: dynamic type, contrast ratios, VoiceOver/TalkBack labels
  on every interactive element.
- **User-facing copy is plain language.** No internal jargon or codes in
  any UI string (PunchLog hard rule — applies here).

## 8. APP STORE READINESS (bake into actual config output, not prose)

Every item below must appear in the actual files you output
(`app.config.ts`, `eas.json`, permission strings, privacy manifest) — a
store rule that only exists in documentation is a rejection.

**Permissions — point-of-use, with pre-permission explainer screens:**
- iOS `infoPlist`: `NSCameraUsageDescription`,
  `NSLocationWhenInUseUsageDescription`, `NSMicrophoneUsageDescription`,
  `NSSpeechRecognitionUsageDescription`, `NSPhotoLibraryUsageDescription` —
  written in plain purpose-specific language (see PunchLog's style:
  "PunchLog uses the camera to photograph construction defects for
  punch-list items.")
- Android: `CAMERA`, `ACCESS_FINE_LOCATION`, `RECORD_AUDIO`, media
  permissions per API level.
- All configured via Expo config plugins in `app.config.ts` (PunchLog
  configures `expo-camera` / `expo-image-picker` plugin permission
  strings and explicitly disables what it doesn't use — do the same;
  WorkLog additionally needs location + mic + speech).

**Account deletion:** mandatory in-app (Apple 5.1.1(v); Google Play
enforced) + a web-based deletion URL for Google Play. Deactivation ≠
deletion. The shared project's `delete-account` edge function exists —
extend it for daily-report data and ship the deletion-URL page copy.

**Privacy:**
- App Privacy nutrition labels (App Store) + Data Safety form (Play) —
  **WorkLog declares precise location** (EXIF preservation, §4.4),
  unlike PunchLog.
- Privacy policy URL in store metadata AND linked in-app. PunchLog's
  policy site pattern: a tiny static site deployed to Vercel
  (`docs/privacy-site/`). Produce equivalent copy for WorkLog reflecting
  the EXIF posture.
- `PrivacyInfo.xcprivacy` privacy manifests for the app + third-party
  SDKs (avoid ITMS-91053 rejections).

**Build & submission:**
- App display name: **WorkLog**. Own bundle id / package
  (`com.kubiknyc.worklog`), own EAS project id, own store listings —
  fully independent distribution from PunchLog.
- SDK deadline: submissions on/after **April 28, 2026** must be built
  with the iOS 26 SDK (Xcode 26+) — verify EAS image at build time.
- ~25% of Apple submissions are rejected, mostly Performance (crashes,
  placeholder content, broken links): provide a demo account + reviewer
  walkthrough in App Review Notes; TestFlight external beta ≥5 business
  days; test on real devices. Native Expo/RN with camera/GPS/offline/push
  clears Guideline 4.2 minimum functionality easily.
- Costs (context): Apple $99/yr and Play $25 accounts already exist
  (PunchLog is shipping under `com.kubiknyc.punchlist`, owner
  `kubiknyc`).
- `eas.json` mirrors PunchLog's: `base` env profile, `development`
  (dev client, internal), `preview` (internal, demo logins off),
  `production` (autoIncrement, `appVersionSource: "remote"`).
  `runtimeVersion.policy = "fingerprint"` + EAS Update URL in
  `app.config.ts`.

## 9. DELIVERABLES — PHASED. Pause at the end of each phase for approval.

**Phase 1 — PRD.** Feature spec (§5) turned into a build-ordered PRD with
MoSCoW prioritization *within* the locked set, screen inventory, and the
under-5-minute daily flow mapped step by step. Resolve the §6 tab-layout
question and the PM-role mapping question (§4.2) here.

**Phase 2 — Architecture.** Offline sync design (mutation kinds, pull
scopes, conflict surfaces — per §4.3), photo upload queue + EXIF
provenance mechanism (§4.4), weather edge function, PDF pipeline,
navigation map, module layout mirroring PunchLog's `src/` structure.

**Phase 3 — Data model.** New Postgres tables + RLS policies as additive
SQL migrations (PunchLog `supabase/migrations/` style; Drizzle may author
but SQL is the deliverable, §4.2), lifecycle RPCs
(`submit_report`/`lock_report`/`amend_report`), SQLite schema +
`DOMAIN_COLUMNS` parity map + versioned migrations, sync mappings
(mutation kind → push handler → table), storage bucket + path policies.

**Phase 4 — Code.** The complete app. No placeholders, no TODOs, no
pseudo-code. Every screen, the full sync engine, photo pipeline, PDF
export, voice-to-text, carry-forward. `tsc --noEmit` green under strict;
jest green including schema-parity and sync-policy tests.

**Phase 5 — Ship kit.** `eas.json`; `app.config.ts` with all permission
strings, config plugins, and privacy manifest; store listing copy (both
stores, modeled on PunchLog's `docs/store-listing.md` — plain language);
App Review Notes template with demo account + reviewer walkthrough;
submission checklist; Google Play deletion-URL page copy; privacy policy
copy reflecting the EXIF posture; Data Safety / nutrition-label
declarations.

## 10. QUALITY BAR & RULES

- State assumptions inline as `ASSUMPTION:` the moment you make one.
- No placeholder or pseudo-code — every file you output must be complete
  and compile.
- Any deviation from the fixed stack (§6) must be flagged with an explicit
  tradeoff before you build on it.
- Long output: stop at natural boundaries and ask `CONTINUE?` rather than
  truncating mid-file.
- **Never silently lose field data.** Every failure path in the sync
  queue must end in retry, park-with-surface, or explicit user decision —
  never a drop. (The embedded `mutationQueue.ts` is the reference
  behavior.)
- Secrets live server-side (edge functions / EAS secrets) — nothing
  sensitive in `EXPO_PUBLIC_*`.
- Every store rule in §8 that affects code must appear in the actual
  config you output.
- TypeScript strict throughout; typecheck + tests green at the end of
  every phase.
- Status/lifecycle writes go through server RPCs; non-status fields are
  LWW by server `updated_at`; never send client timestamps.

## 11. DECISIONS ALREADY MADE — do not relitigate

- **The app is named WorkLog**, part of the **JobSight Apps Suite** — a
  series of standalone, single-purpose construction management apps.
  WorkLog is an independent peer of PunchLog, not a PunchLog sub-brand,
  feature, or module. Suite branding is JobSight (never "PunchLog suite").
- Cross-platform iOS + Android via Expo/React Native (not PWA, not
  Flutter, not Capacitor, not native Swift).
- Feature set (§5) is locked; MoSCoW prioritization within it happens in
  the PRD phase.
- Offline-first is non-negotiable.
- Phased delivery with the no-placeholder-code rule.
- **WatermelonDB is superseded** by PunchLog's expo-sqlite + custom sync
  engine (§4.3), replicated faithfully — not extracted into a shared
  package yet.
- Styling: PunchLog tokens copied verbatim, package-shaped for later
  extraction into a JobSight suite package (§4.1) — not a shared npm
  package now.
- Backend: shared Supabase project with additive-only migrations (§4.2) —
  not a separate instance. Independence is branding/distribution, not
  backend.
- **Repo layout:** three repos — the PunchLog app repo, the WorkLog app
  repo (new, standalone), and `jobsight-backend` (single source of truth
  for the shared Supabase project: migrations, edge functions, seed).
  WorkLog is NOT built inside the PunchLog repo, and schema changes are
  NOT applied ad hoc from app repos.
- Photos: EXIF/GPS provenance **preserved** (§4.4), with the privacy-label
  consequences owned — this intentionally diverges from PunchLog.
- Auth session storage: PunchLog's chunked SecureStore adapter (§4.2) —
  supersedes the earlier AsyncStorage recommendation.
- Design tokens: PunchLog's real Blueprint/Editorial/Béton system (§4.1) —
  supersedes the earlier navy/amber draft palette.
