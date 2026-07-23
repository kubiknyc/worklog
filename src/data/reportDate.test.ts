/**
 * computeReportDate — the project's calendar day, never the device's naive
 * date (PRD §15 #9). The interesting cases sit around the UTC midnight
 * boundary, where project-local and UTC days disagree.
 */
import { computeReportDate } from './reportDate';

/** The device-timezone day for `now`, computed the same way the fallback is. */
const deviceDay = (now: Date): string =>
  new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

test('uses the project timezone across the UTC midnight boundary (behind UTC)', () => {
  // 03:00Z on the 19th is still 11 pm on the 18th in New York (EDT, UTC-4).
  const now = new Date('2026-07-19T03:00:00Z');
  expect(computeReportDate('America/New_York', now)).toBe('2026-07-18');
});

test('uses the project timezone across the UTC midnight boundary (ahead of UTC)', () => {
  // 13:00Z on the 19th is already 01:00 on the 20th in Auckland (NZST, UTC+12).
  const now = new Date('2026-07-19T13:00:00Z');
  expect(computeReportDate('Pacific/Auckland', now)).toBe('2026-07-20');
});

test('falls back to the device timezone when the project timezone is null', () => {
  const now = new Date('2026-07-19T03:00:00Z');
  expect(computeReportDate(null, now)).toBe(deviceDay(now));
});

test('falls back to the device timezone on a garbage timezone string', () => {
  const now = new Date('2026-07-19T03:00:00Z');
  expect(computeReportDate('Not/A_Real_Zone', now)).toBe(deviceDay(now));
});

test('returns the YYYY-MM-DD shape', () => {
  expect(computeReportDate('America/New_York', new Date('2026-01-02T12:00:00Z'))).toMatch(
    /^\d{4}-\d{2}-\d{2}$/,
  );
});
