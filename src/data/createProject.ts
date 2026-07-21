/**
 * Project creation — a standalone helper, deliberately NOT on the Repository
 * interface: creating a project is online-only on every platform (there is no
 * offline "provisional project" concept; a project must exist server-side
 * before anything can be filed against it), so both the native and web builds
 * share this exact module and it never touches the mutation queue. The
 * CreateProjectSheet gates on the failure being a transport error
 * (`isLikelyOffline`) to show the neutral offline copy.
 *
 * Server contract (verified against the backend migrations and PunchLog's
 * `src/data/createProject.ts`):
 *
 *  - `projects_insert` RLS requires `created_by = auth.uid()`.
 *  - `bootstrap_project_creator` is an AFTER-INSERT **TRIGGER**, not an RPC —
 *    it enrols the creator as `super` in the same transaction. That is why the
 *    id is CLIENT-MINTED and the insert carries **no `.select()`**: PostgREST
 *    evaluates a RETURNING row against the `projects_read` SELECT policy
 *    (`is_member`), which the creator cannot pass mid-statement because the
 *    membership row only exists after the trigger fires and the statement
 *    commits. A `.select()` here 403s on an otherwise successful insert.
 *
 * Caller order (Wave 4/6 surfaces): `createProject()` →
 * `useAuth().refresh()` (so the new `super` membership lands in context) →
 * `setActiveProject(newId)`.
 *
 * Geocoding: there is no geocode edge function (that is M9). When the caller
 * supplies a manually dropped pin we record it with
 * `geocode_source: 'manual_pin'` + `geocoded_at`; otherwise both stay null and
 * `timezone` is the DEVICE zone, which `computeReportDate` already treats as
 * the fallback.
 */
import { uuidv4 } from '../lib/uuid';
import { supabase } from '../supabase/client';

export interface CreateProjectInput {
  readonly name: string;
  readonly address?: string | null;
  readonly lat?: number | null;
  readonly lng?: number | null;
}

function fail(context: string, error: { readonly message: string }): never {
  // Raw PostgREST messages can leak schema detail — keep them out of the UI,
  // but log them so production failures stay diagnosable (supabaseRepo idiom).
  console.warn(`[createProject] ${context} failed:`, error);
  throw new Error("Couldn't create the project. Please check your connection and try again.");
}

/** The device's IANA zone, or null when the runtime can't report one. */
function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Insert the project and return its (client-minted) id. Online-only; throws a
 * user-facing Error on any failure.
 */
export async function createProject(input: CreateProjectInput): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user.id;
  if (!userId) throw new Error('You appear to be signed out. Please sign in again.');

  const name = input.name.trim();
  if (name.length === 0) throw new Error('Enter a project name.');

  const address = input.address?.trim() || null;
  const lat = input.lat ?? null;
  const lng = input.lng ?? null;
  const hasPin = lat !== null && lng !== null;

  const projectId = uuidv4();
  const { error } = await supabase.from('projects').insert({
    id: projectId,
    name,
    address,
    lat,
    lng,
    timezone: deviceTimeZone(),
    // Only a real coordinate carries provenance; without one both columns stay
    // null so M9's geocoder can tell "never geocoded" from "user-placed pin".
    geocode_source: hasPin ? 'manual_pin' : null,
    geocoded_at: hasPin ? new Date().toISOString() : null,
    created_by: userId,
  });
  // No `.select()` — see the header note on the RLS/trigger race.
  if (error) fail('project insert', error);

  return projectId;
}
