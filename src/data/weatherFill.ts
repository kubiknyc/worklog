/**
 * Client caller for the `worklog-weather` edge function (M9). NOT a sync
 * mutation — invoked as a side effect after `create_report` while online
 * (`repo.createReport`, both platforms) and by the pull path's fill-on-sync
 * retry sweep (`src/sync/weatherFillSweep.native.ts`) for reports created
 * offline. See `jobsight-backend/supabase/functions/worklog-weather/index.ts`
 * for the server contract this mirrors.
 *
 * The function returns HTTP 200 for every outcome except a genuine server
 * error — 'fetch_failed' is a SOFT failure the sweep retries later, never a
 * user-visible error. This caller mirrors that: it never throws and never
 * distinguishes "the network is down" from "the function said no" beyond the
 * single `networkError` bucket, because neither caller acts on the
 * difference — both just leave `report_weather.weather_source` at 'none' for
 * the next sweep to retry.
 */
import { supabase } from '../supabase/client';

export type WeatherFillStatus =
  'ok' | 'no_geolocation' | 'manual_override' | 'report_locked' | 'fetch_failed' | 'networkError';

export interface WeatherFillResult {
  readonly status: WeatherFillStatus;
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  'ok',
  'no_geolocation',
  'manual_override',
  'report_locked',
  'fetch_failed',
]);

/** Fire against the deployed function; NEVER throws (see module doc). */
export async function fillWeather(
  projectId: string,
  reportDate: string,
): Promise<WeatherFillResult> {
  try {
    const { data, error } = await supabase.functions.invoke('worklog-weather', {
      body: { project_id: projectId, report_date: reportDate },
    });
    if (error) return { status: 'networkError' };
    const status = (data as { status?: unknown } | null)?.status;
    if (typeof status === 'string' && KNOWN_STATUSES.has(status)) {
      return { status: status as WeatherFillStatus };
    }
    return { status: 'networkError' };
  } catch {
    return { status: 'networkError' };
  }
}
