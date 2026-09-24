/**
 * Fill-on-sync retry sweep (worklog-weather's own header: "the fill-on-sync
 * retry sweep for offline mornings"). Not a sync mutation and not sync
 * policy — plain native IO alongside the other `.native.ts` files in this
 * directory (store/push/pull/reparent), called once per online pull cycle
 * from `pull.native.ts`.
 *
 * `report_weather.weather_source = 'none'` IS the retry queue: the edge
 * function only ever flips a row to 'auto' (success) or leaves it 'none'
 * (no_geolocation / report_locked / fetch_failed — see its own header), so a
 * report still needing an attempt is exactly a 'none' row. Filtered further
 * to skip pointless round-trips: a project with no lat/lng will only ever
 * answer 'no_geolocation', and a locked report's snapshot is legally frozen
 * (the server refuses it anyway, but there is no reason to ask).
 *
 * Best-effort and sequential: bounded so a backlog of old un-weathered
 * reports can't turn one pull cycle into an unbounded burst of requests.
 * Never throws — called from the pull cycle, which must never fail because a
 * weather fetch failed.
 */
import { all } from '../db/rows.native';
import type { Db } from '../db/rows.native';
import { fillWeather } from '../data/weatherFill';

/** Caps one sweep's network round-trips regardless of how large the backlog is. */
const MAX_REPORTS_PER_SWEEP = 10;

interface DueRow {
  readonly report_id: string;
  readonly project_id: string;
  readonly report_date: string;
}

export async function runWeatherFillSweep(db: Db): Promise<void> {
  let due: readonly DueRow[];
  try {
    due = await all<DueRow>(
      db,
      `SELECT dr.id AS report_id, dr.project_id AS project_id, dr.report_date AS report_date
         FROM daily_reports dr
         JOIN report_weather rw ON rw.report_id = dr.id
         JOIN projects p ON p.id = dr.project_id
        WHERE rw.weather_source = 'none'
          AND dr.status != 'locked'
          AND p.lat IS NOT NULL AND p.lng IS NOT NULL
        ORDER BY dr.report_date DESC
        LIMIT ${MAX_REPORTS_PER_SWEEP}`,
    );
  } catch {
    return; // best-effort: a read failure here costs staleness, never correctness
  }

  for (const row of due) {
    try {
      await fillWeather(row.project_id, row.report_date);
    } catch {
      // fillWeather itself never throws; stay defensive so one bad row can't
      // stop the rest of the sweep.
    }
  }
}
