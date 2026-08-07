/**
 * TERMS_URL / PRIVACY_URL are rendered as tappable links on the registration
 * consent line and in Settings → Legal, and the App Review notes assert both
 * documents are linked and accepted.
 *
 * Deliberate deviation from PunchLog (spec §6): this suite does NOT assert
 * LEGAL_PAGES_PUBLISHED. That flag is flipped only after `check:submission`
 * confirms both URLs return 200 against the live site — a unit test in a
 * sandbox with no egress cannot verify that, and asserting a hardcoded
 * `false` here would just be a test that has to be edited (not verified) the
 * day the flag flips, defeating the point of a gate.
 */
import { PRIVACY_URL, TERMS_URL } from './legal';

it('links to absolute https URLs on the marketing site', () => {
  for (const url of [TERMS_URL, PRIVACY_URL]) {
    expect(url).toMatch(/^https:\/\//);
  }
});

it('uses the same origin for both legal pages', () => {
  const originOf = (url: string) => new URL(url).origin;
  expect(originOf(TERMS_URL)).toBe(originOf(PRIVACY_URL));
});

it('points terms and privacy at their respective routes', () => {
  expect(TERMS_URL).toMatch(/\/terms$/);
  expect(PRIVACY_URL).toMatch(/\/privacy$/);
});
