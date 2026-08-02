/**
 * WCAG contrast maths, and the on-fill foreground picker (#18).
 *
 * The bug this exists to prevent: `ConfirmSheet` filled its destructive button
 * with `reportStatus.locked` and hardcoded `#FFFFFF` text. In the default
 * Blueprint theme that is 2.10:1 — under half the 4.5:1 floor PRD AC-S1
 * requires. Neither file was wrong alone. The status palette is documented as
 * clearing ">=3:1 for these graphical indicators" (tokens.ts), the correct bar
 * for a status dot or chip; reusing it as a *text background* moves the bar to
 * 4.5:1, and nothing carried that constraint across the seam.
 *
 * Hardcoding a different literal would just move the bug. Instead the
 * foreground is derived from the fill, so any future fill — a new theme, a
 * changed status colour — gets a compliant pairing without anyone remembering
 * to recheck.
 */

/** Near-black ink for light fills. Darker than any palette `text` value. */
export const ON_FILL_DARK = '#0B0F14';
/** White for dark fills. */
export const ON_FILL_LIGHT = '#FFFFFF';

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Parses `#RGB` and `#RRGGBB`. Throws on anything else — a silent 0 reads as black. */
export function parseHex(hex: string): readonly [number, number, number] {
  const raw = hex.trim().replace(/^#/, '');
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`not a hex colour: ${hex}`);
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ] as const;
}

/** WCAG 2.x relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio, 1:1 to 21:1. Order-independent. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The foreground to place on `fill` — whichever of dark ink / white contrasts
 * better. Ties go to dark, the safer default on mid-tone fills.
 */
export function onFillColor(fill: string): string {
  return contrastRatio(ON_FILL_DARK, fill) >= contrastRatio(ON_FILL_LIGHT, fill)
    ? ON_FILL_DARK
    : ON_FILL_LIGHT;
}

/** WCAG AA for normal-size text. */
export const AA_TEXT_CONTRAST = 4.5;
