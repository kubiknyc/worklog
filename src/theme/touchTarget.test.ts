/**
 * The touch-target helper, and a regression pin for the controls that shipped
 * under the 48px floor (#19).
 */
import { MIN_TOUCH_TARGET, effectiveTarget, hitSlopFor, meetsTouchFloor } from './touchTarget';

describe('hitSlopFor', () => {
  it('returns the slop that lifts content onto the floor', () => {
    expect(effectiveTarget(20, hitSlopFor(20))).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(effectiveTarget(26, hitSlopFor(26))).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(effectiveTarget(27, hitSlopFor(27))).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  it('rounds up, never leaving a sub-pixel shortfall', () => {
    // 27px content needs 10.5 per side; 10 would leave 47.
    expect(hitSlopFor(27)).toBe(11);
    expect(effectiveTarget(27, 10)).toBeLessThan(MIN_TOUCH_TARGET);
  });

  it('asks for nothing when the content already clears the floor', () => {
    expect(hitSlopFor(48)).toBe(0);
    expect(hitSlopFor(60)).toBe(0);
  });

  it('rejects nonsense rather than silently returning a wrong slop', () => {
    expect(() => hitSlopFor(-1)).toThrow(/non-negative/);
    expect(() => hitSlopFor(Number.NaN)).toThrow(/non-negative/);
  });
});

describe('the controls #19 named', () => {
  // Content sizes as rendered. If one changes in source without its slop being
  // recomputed, these constants are what make that visible.
  const CONTROLS = [
    { name: 'sync pill', content: 27, was: 8 },
    { name: 'EntryCard remove', content: 20, was: 8 },
    { name: 'sync queue Discard', content: 18, was: 8 },
    { name: 'report back', content: 26, was: 10 },
  ] as const;

  it.each(CONTROLS)('$name was below the floor before the fix', ({ content, was }) => {
    expect(meetsTouchFloor(content, was)).toBe(false);
  });

  it.each(CONTROLS)('$name clears the floor with the derived slop', ({ content }) => {
    expect(meetsTouchFloor(content, hitSlopFor(content))).toBe(true);
  });

  it('login-forgot: a 40px minHeight was short; the shared floor is not', () => {
    expect(40).toBeLessThan(MIN_TOUCH_TARGET);
    expect(MIN_TOUCH_TARGET).toBe(48);
  });
});
