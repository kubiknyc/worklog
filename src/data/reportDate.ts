/**
 * Report-date computation (PRD §15 #9): `report_date` is the PROJECT's
 * calendar day — the day boundary lives in the project's IANA timezone
 * (`projects.timezone`), never a naive device date. A super filing at 11 pm
 * on a New-York job while their phone sits in UTC must still land on the
 * New-York day; the natural key UNIQUE(project_id, report_date), collision
 * handling, carry-forward, and the calendar all hang on this.
 *
 * Pure — no native imports; `now` is injected so tests pin the clock.
 */

/** `en-CA` is the locale whose date parts natively format as YYYY-MM-DD. */
function formatDay(now: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * `YYYY-MM-DD` in the project's timezone. A null timezone (column unset —
 * it is additive and nullable) or an invalid IANA name (bad admin input,
 * ICU gaps) falls back to the DEVICE timezone rather than throwing:
 * a wrong-but-plausible day beats a crash on the report-create path.
 */
export function computeReportDate(projectTimezone: string | null, now: Date): string {
  if (projectTimezone) {
    try {
      return formatDay(now, projectTimezone);
    } catch {
      // Invalid IANA name — fall through to the device-timezone day.
    }
  }
  return formatDay(now);
}
