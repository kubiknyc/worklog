/**
 * Client caller for the `worklog-geocode` edge function (M9 / T24). Fills a
 * project's lat/lng from its address so the weather fill has coordinates —
 * before this, nothing ever geocoded and every project's weather returned
 * `no_geolocation`.
 *
 * Mirrors `weatherFill.ts`'s soft-failure contract: NEVER throws, never gates
 * project creation, and collapses every transport/unknown failure into
 * `networkError`. No caller acts on the outcome — `worklog-weather` also
 * geocodes lazily, so a miss here self-heals on the first weather fill. See
 * `jobsight-backend/supabase/functions/worklog-geocode/handler.ts`.
 */
import { supabase } from '../supabase/client';

export type GeocodeStatus =
  | 'already_located'
  | 'geocoded'
  | 'no_address'
  | 'not_found'
  | 'throttled'
  | 'fetch_failed'
  | 'networkError';

export interface GeocodeResult {
  readonly status: GeocodeStatus;
}

const KNOWN_STATUSES: ReadonlySet<string> = new Set([
  'already_located',
  'geocoded',
  'no_address',
  'not_found',
  'throttled',
  'fetch_failed',
]);

/** Fire against the deployed function; NEVER throws (see module doc). */
export async function geocodeProject(projectId: string): Promise<GeocodeResult> {
  try {
    const { data, error } = await supabase.functions.invoke('worklog-geocode', {
      body: { project_id: projectId },
    });
    if (error) return { status: 'networkError' };
    const status = (data as { status?: unknown } | null)?.status;
    if (typeof status === 'string' && KNOWN_STATUSES.has(status)) {
      return { status: status as GeocodeStatus };
    }
    return { status: 'networkError' };
  } catch {
    return { status: 'networkError' };
  }
}
