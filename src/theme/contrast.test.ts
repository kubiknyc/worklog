/**
 * Contrast maths, and the AA floor for every fill the app puts text on (#18).
 *
 * `src/theme/tokens.ts` had no test at all (#24 lists it), which is how a
 * palette documented as ">=3:1 for graphical indicators" came to be used as a
 * text background at 2.10:1 without anything noticing.
 */
import {
  AA_TEXT_CONTRAST,
  ON_FILL_DARK,
  ON_FILL_LIGHT,
  contrastRatio,
  onFillColor,
  parseHex,
  relativeLuminance,
} from './contrast';
import { ERROR_COLORS, PALETTES, REPORT_STATUS_COLORS, THEME_NAMES } from './tokens';

describe('contrast maths', () => {
  it('matches the WCAG reference extremes', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });

  it('is order-independent', () => {
    expect(contrastRatio('#46C98A', '#FFFFFF')).toBeCloseTo(
      contrastRatio('#FFFFFF', '#46C98A'),
      10,
    );
  });

  it('reproduces the ratios that made #18 a bug', () => {
    // The issue's own table said blueprint was ~1.89:1; recomputing from the
    // hex gives 2.10:1. Both are far under the floor, but the number quoted in
    // the issue was wrong and should not be propagated.
    expect(contrastRatio('#46C98A', '#FFFFFF')).toBeCloseTo(2.1, 1);
    expect(contrastRatio('#1F8A50', '#FFFFFF')).toBeCloseTo(4.37, 1);
    expect(contrastRatio('#1A7745', '#FFFFFF')).toBeCloseTo(5.57, 1);
  });

  it('parses both hex forms and rejects junk', () => {
    expect(parseHex('#FFF')).toEqual([255, 255, 255]);
    expect(parseHex('00ff00')).toEqual([0, 255, 0]);
    expect(() => parseHex('#12345')).toThrow(/not a hex colour/);
    expect(() => parseHex('rebeccapurple')).toThrow(/not a hex colour/);
  });

  it('luminance is monotonic from black to white', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 6);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 6);
    expect(relativeLuminance('#808080')).toBeGreaterThan(0);
    expect(relativeLuminance('#808080')).toBeLessThan(1);
  });
});

describe('onFillColor', () => {
  it('picks white on dark fills and ink on light fills', () => {
    expect(onFillColor('#0B2A45')).toBe(ON_FILL_LIGHT);
    expect(onFillColor('#F5F5F5')).toBe(ON_FILL_DARK);
  });

  it('picks the better option on the fill that caused #18', () => {
    // White on blueprint's locked green is 2.10:1; dark ink clears AA easily.
    expect(onFillColor('#46C98A')).toBe(ON_FILL_DARK);
    expect(contrastRatio(onFillColor('#46C98A'), '#46C98A')).toBeGreaterThanOrEqual(
      AA_TEXT_CONTRAST,
    );
  });
});

describe('every fill the app puts text on clears AA', () => {
  // The destructive confirm and the danger button both fill with the theme's
  // `error` colour and derive their foreground. This is the assertion that
  // would have caught #18 at the seam, where neither file was wrong alone.
  it.each(THEME_NAMES)('%s: destructive fill + derived foreground', (theme) => {
    const fill = ERROR_COLORS[theme];
    const ratio = contrastRatio(onFillColor(fill), fill);
    if (ratio < AA_TEXT_CONTRAST) {
      throw new Error(`${theme} error fill ${fill} best foreground is only ${ratio.toFixed(2)}:1`);
    }
  });
});

describe('report-status colours stay graphical indicators', () => {
  /**
   * These are NOT text backgrounds, and must not become them. Editorial's
   * `locked` (#1F8A50) is the proof: it clears neither 4.5:1 with white (4.37)
   * nor with dark ink (4.40), so no foreground choice can rescue it. That is
   * why #18's real fix was to stop `ConfirmSheet` filling with a status colour
   * rather than to pick a better text colour.
   *
   * Their actual contract — tokens.ts documents ">=3:1 against surface, bg and
   * surface2" — is what gets pinned here.
   */
  const GRAPHICAL_CONTRAST = 3;

  /**
   * Known violations of the contract tokens.ts claims is "verified".
   *
   * NOT a loosened assertion — every other pair is still held to 3:1, and each
   * entry here names the reason it cannot simply be fixed in this change.
   * Delete an entry when the underlying decision is made; do not add one
   * without an issue.
   *
   * `beton.amended` (#E8531F) fails against ALL THREE beton surfaces —
   * 2.20:1 on bg, 2.44:1 on surface, 2.00:1 on surface2 — so the colour itself
   * is the problem, not one pairing. It cannot be recoloured in isolation:
   * `amended` is documented as taking each theme's `accent` (tokens.ts), and
   * beton's accent IS #E8531F, so changing it re-tints the whole theme. That is
   * a brand decision, not a contrast fix.
   */
  const KNOWN_BELOW_FLOOR = new Set(['beton.amended']);

  it.each(THEME_NAMES)('%s: every status colour clears 3:1 on all surfaces', (theme) => {
    const palette = PALETTES[theme];
    for (const [status, color] of Object.entries(REPORT_STATUS_COLORS[theme])) {
      for (const surfaceName of ['bg', 'surface', 'surface2'] as const) {
        if (KNOWN_BELOW_FLOOR.has(`${theme}.${status}`)) continue;
        const ratio = contrastRatio(color, palette[surfaceName]);
        if (ratio < GRAPHICAL_CONTRAST) {
          throw new Error(
            `${theme}.${status} (${color}) is ${ratio.toFixed(2)}:1 on ${surfaceName} ` +
              `(${palette[surfaceName]}) — below the 3:1 indicator floor`,
          );
        }
      }
    }
  });

  it('every known-below-floor entry is still genuinely below the floor', () => {
    // Stops the exception list outliving the problem: once beton's accent is
    // resolved, this fails and forces the entry to be deleted.
    for (const key of KNOWN_BELOW_FLOOR) {
      const [theme, status] = key.split('.') as [
        (typeof THEME_NAMES)[number],
        'draft' | 'submitted' | 'locked' | 'amended',
      ];
      const color = REPORT_STATUS_COLORS[theme][status];
      // Exempted because it fails everywhere — if any surface starts passing,
      // the exemption is too broad and must be narrowed or deleted.
      for (const surface of ['bg', 'surface', 'surface2'] as const) {
        expect(contrastRatio(color, PALETTES[theme][surface])).toBeLessThan(GRAPHICAL_CONTRAST);
      }
    }
  });

  it('editorial locked cannot be used as a text background by any foreground', () => {
    // Pins the finding above so a future change that reintroduces the misuse
    // has a test explaining why it is impossible, not just failing.
    const fill = REPORT_STATUS_COLORS.editorial.locked;
    expect(contrastRatio(ON_FILL_LIGHT, fill)).toBeLessThan(AA_TEXT_CONTRAST);
    expect(contrastRatio(ON_FILL_DARK, fill)).toBeLessThan(AA_TEXT_CONTRAST);
  });
});
