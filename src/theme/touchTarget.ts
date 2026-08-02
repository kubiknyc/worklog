/**
 * The 48px touch-target floor (PRD §9 AC-T1) and the slop needed to reach it.
 *
 * Six controls shipped under the floor (#19), including the sync pill at ~27px.
 * The pattern was the same every time: a `hitSlop={8}` chosen by eye and never
 * checked against the rendered content size. Eyeballing cannot work here — the
 * answer depends on icon size, font size and padding, and it changes whenever
 * any of those move.
 *
 * `hitSlopFor` computes it instead, so a control declares its content size and
 * gets a compliant target for free. This is a gloves-on rule: crews use the app
 * outdoors, in gloves, on a phone that may be wet, and a missed tap on the sync
 * queue is how unsent work stays unsent.
 */

/** WCAG 2.2 AA (2.5.8) is 24px; PRD §9 AC-T1 sets the stricter 48px bar. */
export const MIN_TOUCH_TARGET = 48;

/**
 * Extra hit area needed on EACH side so `contentPx` reaches the floor.
 *
 * React Native's `hitSlop` extends the touchable region outward without moving
 * pixels, which is what we want: the pill stays visually small while its target
 * clears 48.
 */
export function hitSlopFor(contentPx: number): number {
  if (!Number.isFinite(contentPx) || contentPx < 0) {
    throw new Error(`content size must be a non-negative number, got ${contentPx}`);
  }
  return Math.max(0, Math.ceil((MIN_TOUCH_TARGET - contentPx) / 2));
}

/** Resulting target for `contentPx` with `slop` on each side. */
export function effectiveTarget(contentPx: number, slop: number): number {
  return contentPx + slop * 2;
}

/** Does this content + slop pairing clear the floor? */
export function meetsTouchFloor(contentPx: number, slop: number): boolean {
  return effectiveTarget(contentPx, slop) >= MIN_TOUCH_TARGET;
}
