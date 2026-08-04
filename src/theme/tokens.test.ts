/**
 * `docs/architecture/05-test-architecture.md` §C names this file an M0 gate
 * deliverable ("palette/status/spacing values match spec verbatim"). It did not
 * exist (#24). `tokens.ts` reports 100% coverage because it is pure data, so
 * its absence was invisible in every report.
 *
 * The point is not to restate the literals — a test that only echoes values
 * fails whenever they change and catches nothing. The value is in checking the
 * CLAIMS the file makes in prose. One turned out to be false: `accentInk` is
 * documented as "Foreground color to use on top of `accent`", and beton's was
 * #FFFFFF on a mid-tone orange — 3.69:1, under the 4.5 floor AC-S1 requires
 * for text on a fill. Exactly the #18 pairing in a place #18 did not look.
 * It is now ON_FILL_DARK (5.21:1), and the assertion below is what keeps it so.
 *
 * Scope is chosen to avoid overlapping `contrast.test.ts`, which owns
 * report-status contrast and its documented exemptions. What lives here is
 * what nothing else covered: registry consistency, text/muted/faint/accentInk,
 * priority colours, error fills, and the numeric scales.
 */
import {
  DEFAULT_DENSITY,
  DEFAULT_THEME,
  DENSITIES,
  ERROR_COLORS,
  PALETTES,
  PRIORITY_COLORS,
  RADII,
  REPORT_STATUS_COLORS,
  SIZES,
  SPACING,
  THEME_NAMES,
  type ThemeName,
} from './tokens';
import { AA_TEXT_CONTRAST, contrastRatio, onFillColor } from './contrast';

/** WCAG 2.x floor for non-text graphical indicators (status dots, chips). */
const AA_GRAPHIC_CONTRAST = 3;

/** Every backdrop a foreground may land on within one theme. */
function surfacesOf(theme: ThemeName): readonly (readonly [string, string])[] {
  const p = PALETTES[theme];
  return [
    ['bg', p.bg],
    ['surface', p.surface],
    ['surface2', p.surface2],
  ] as const;
}

describe('theme registry is internally consistent', () => {
  it('THEME_NAMES lists exactly the themes every table defines', () => {
    // A theme in PALETTES but missing from a colour table crashes ThemeProvider
    // at runtime with an undefined colour — nothing catches it at build time.
    expect([...THEME_NAMES].sort()).toEqual(Object.keys(PALETTES).sort());
    expect([...THEME_NAMES].sort()).toEqual(Object.keys(REPORT_STATUS_COLORS).sort());
    expect([...THEME_NAMES].sort()).toEqual(Object.keys(PRIORITY_COLORS).sort());
    expect([...THEME_NAMES].sort()).toEqual(Object.keys(ERROR_COLORS).sort());
  });

  it('the defaults are real entries', () => {
    expect(THEME_NAMES).toContain(DEFAULT_THEME);
    expect(Object.keys(DENSITIES)).toContain(DEFAULT_DENSITY);
  });

  it('every report status and priority has a colour in every theme', () => {
    for (const theme of THEME_NAMES) {
      expect(Object.keys(REPORT_STATUS_COLORS[theme]).sort()).toEqual([
        'amended',
        'draft',
        'locked',
        'submitted',
      ]);
      expect(Object.keys(PRIORITY_COLORS[theme]).sort()).toEqual(['high', 'low', 'medium']);
    }
  });
});

describe('text foregrounds clear WCAG AA (4.5:1) — PRD AC-S1', () => {
  it.each(THEME_NAMES)('%s: text is legible on every surface', (theme) => {
    for (const [surface, backdrop] of surfacesOf(theme)) {
      const ratio = contrastRatio(PALETTES[theme].text, backdrop);
      expect({ surface, pass: ratio >= AA_TEXT_CONTRAST }).toEqual({ surface, pass: true });
    }
  });

  it.each(THEME_NAMES)('%s: muted secondary text is legible on every surface', (theme) => {
    // `muted` carries real content (timestamps, row subtitles), so it is text,
    // not decoration. Two themes' muted values were already corrected once for
    // exactly this — see the inline notes in tokens.ts.
    for (const [surface, backdrop] of surfacesOf(theme)) {
      const ratio = contrastRatio(PALETTES[theme].muted, backdrop);
      expect({ surface, pass: ratio >= AA_TEXT_CONTRAST }).toEqual({ surface, pass: true });
    }
  });

  it.each(THEME_NAMES)('%s: accentInk is legible on the accent fill', (theme) => {
    // The #18 pairing, generalised: a foreground documented as sitting on a
    // fill is text on that fill and owes 4.5:1. beton failed this at 3.69.
    const ratio = contrastRatio(PALETTES[theme].accentInk, PALETTES[theme].accent);
    expect({ theme, pass: ratio >= AA_TEXT_CONTRAST }).toEqual({ theme, pass: true });
  });

  it.each(THEME_NAMES)('%s: error text is legible on every surface', (theme) => {
    for (const [surface, backdrop] of surfacesOf(theme)) {
      const ratio = contrastRatio(ERROR_COLORS[theme], backdrop);
      expect({ surface, pass: ratio >= AA_TEXT_CONTRAST }).toEqual({ surface, pass: true });
    }
  });

  it.each(THEME_NAMES)('%s: the derived ink on an error FILL clears AA', (theme) => {
    // ConfirmSheet fills its destructive button with `error` and derives the
    // foreground. This asserts the derivation actually lands above the floor,
    // rather than merely being called.
    const fill = ERROR_COLORS[theme];
    expect(contrastRatio(onFillColor(fill), fill)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
  });
});

describe('graphical indicators clear WCAG AA (3:1)', () => {
  // Report-status contrast is deliberately NOT restated here. `contrast.test.ts`
  // already owns it, together with the `KNOWN_BELOW_FLOOR` exemption for
  // `beton.amended` (2.00–2.44:1 — recolouring it re-tints the theme's accent,
  // a brand decision) and a second test that fails once that stops being true,
  // so the exemption cannot outlive the problem. Duplicating the check here
  // would mean maintaining the same exemption twice and getting it wrong once.

  it.each(THEME_NAMES)('%s: every priority colour clears 3:1 on all surfaces', (theme) => {
    for (const [priority, colour] of Object.entries(PRIORITY_COLORS[theme])) {
      for (const [surface, backdrop] of surfacesOf(theme)) {
        const ratio = contrastRatio(colour, backdrop);
        expect({ priority, surface, pass: ratio >= AA_GRAPHIC_CONTRAST }).toEqual({
          priority,
          surface,
          pass: true,
        });
      }
    }
  });

  it.each(THEME_NAMES)('%s: faint clears the indicator bar on every surface', (theme) => {
    // `faint` is the sheet grab-handle and hairline fills — decoration, so 3:1
    // is the right bar for it, not 4.5.
    for (const [surface, backdrop] of surfacesOf(theme)) {
      const ratio = contrastRatio(PALETTES[theme].faint, backdrop);
      expect({ surface, pass: ratio >= AA_GRAPHIC_CONTRAST }).toEqual({ surface, pass: true });
    }
  });
});

describe('scale values match the spec', () => {
  it('SPACING is a 4pt scale in ascending order', () => {
    const values = Object.values(SPACING);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    for (const value of values) expect(value % 4).toBe(0);
  });

  it('SPACING keys and values are the documented set', () => {
    expect(SPACING).toEqual({ xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 });
  });

  it('RADII and SIZES are the documented single values', () => {
    expect(RADII).toEqual({ card: 18, pill: 12, input: 14, button: 14 });
    expect(SIZES).toEqual({ screenPad: 16, buttonHeight: 50, inputHeight: 50 });
  });

  it('control heights clear the 48px touch-target floor', () => {
    // AC-T1: a control shorter than this needs hit slop to be tappable, and
    // these two are used bare.
    expect(SIZES.buttonHeight).toBeGreaterThanOrEqual(48);
    expect(SIZES.inputHeight).toBeGreaterThanOrEqual(48);
  });

  it('compact density is tighter than comfortable on both axes', () => {
    expect(DENSITIES.compact.rowPad).toBeLessThan(DENSITIES.comfortable.rowPad);
    expect(DENSITIES.compact.listGap).toBeLessThan(DENSITIES.comfortable.listGap);
  });
});
