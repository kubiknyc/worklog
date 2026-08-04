/**
 * Design tokens for WorkLog — ported verbatim from PunchLog's
 * design_handoff_native_app/DESIGN_SPEC.md ("Design tokens" section), with
 * the item-status palette remapped onto WorkLog's report lifecycle (PRD §3
 * M0 note): draft → submitted → locked, plus `amended` as a derived display
 * state (a locked report with >=1 amendment — not a fourth lifecycle state).
 *
 * Three switchable themes (Blueprint is the default), fixed report-status/
 * priority colors, density presets, and shared spacing/shape values.
 */

export type ThemeName = 'blueprint' | 'editorial' | 'beton';
export type DensityName = 'comfortable' | 'compact';
type ColorScheme = 'light' | 'dark';

export type ReportStatus = 'draft' | 'submitted' | 'locked' | 'amended';
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
    // WCAG AA: 5.21:1 on accent (was #FFFFFF, 3.69:1 — under AC-S1's 4.5 floor
    // for text on a fill). This is the value `onFillColor(accent)` picks, i.e.
    // ON_FILL_DARK: beton's accent is a mid-tone orange, light enough that
    // white text on it is the same class of bug as #18.
    accentInk: '#0B0F14',
    scheme: 'light',
  },
} as const;

// Status/priority colors are per-theme: a single shared set cannot meet WCAG
// contrast (>=3:1 for these graphical indicators) against both the dark Blueprint
// surface and the light Editorial/Beton surfaces at once. Each value below clears
// 3:1 against its theme's surface, bg, and surface2 (verified, ratios in review).
//
// ReportStatus rename (PRD §3 M0 note): reuses PunchLog's ItemStatus palette
// by lifecycle position — earliest stage (`open`) -> `draft`, next (`in_progress`)
// -> `submitted`, terminal (`closed`) -> `locked`; PunchLog's `review` value is
// unused (WorkLog's 3-stage lifecycle has no analog). `amended` is a derived
// display state, not a lifecycle stage, so it takes each theme's `accent` color
// (PALETTES[name].accent) rather than an item-status value.
//
// The "verified" claim above is NOT true of `beton.amended`: the raw accent is
// 2.00–2.44:1 against beton's light surfaces. That is a known, deliberate
// exception — recolouring it means re-tinting the theme's accent, a brand
// decision rather than a contrast fix — and it is pinned as such in
// `contrast.test.ts`'s KNOWN_BELOW_FLOOR, which also fails if the problem ever
// resolves so the exemption cannot outlive it. Status-colour contrast is owned
// there; `tokens.test.ts` deliberately does not restate it.
export const REPORT_STATUS_COLORS: Readonly<
  Record<ThemeName, Readonly<Record<ReportStatus, string>>>
> = {
  blueprint: { draft: '#FF6B6F', submitted: '#8AA6F7', locked: '#46C98A', amended: '#4FC3F7' },
  editorial: { draft: '#E5484D', submitted: '#3E63DD', locked: '#1F8A50', amended: '#9A3B2E' },
  beton: { draft: '#BE3137', submitted: '#2F50C0', locked: '#1A7745', amended: '#E8531F' },
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
export const FIXED_COLORS = { camera: '#3FA9F0' } as const;

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
