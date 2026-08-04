/**
 * Project creation — a standalone helper, deliberately NOT on the Repository
 * interface: creating a project is online-only on every platform (there is no
 * offline "provisional project" concept; a project must exist server-side
 * before anything can be filed against it), so both the native and web builds
 * share this exact module and it never touches the mutation queue.
 *
 * Failure copy is chosen HERE, not by the caller: `fail()` classifies the raw
 * error before masking it and throws `OFFLINE_COPY` or `REJECTED_COPY`. The
 * header used to say CreateProjectSheet gated on `isLikelyOffline` — it could
 * not, because by the time the sheet sees the error the original is gone and
 * the classification is always false (#22).
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
import { isLikelyOffline } from '../lib/errors';
import { uuidv4 } from '../lib/uuid';
import { supabase } from '../supabase/client';

export interface CreateProjectInput {
  readonly name: string;
  readonly address?: string | null;
  readonly lat?: number | null;
  readonly lng?: number | null;
}

/** Shown when the request never reached the server — no server verdict exists. */
export const OFFLINE_COPY =
  "You appear to be offline. Creating a project needs a connection — try again once you're back online.";
/** Shown when the server did reply and rejected the insert. */
export const REJECTED_COPY = "Couldn't create the project. Please try again.";

function fail(context: string, error: unknown): never {
  // Raw PostgREST messages can leak schema detail — keep them out of the UI,
  // but log them so production failures stay diagnosable (supabaseRepo idiom).
  console.warn(`[createProject] ${context} failed:`, error);
  // Classify BEFORE masking. This used to throw one fixed string, on which
  // `isLikelyOffline` is always false — so the sheet's documented offline gate
  // could never fire and every offline attempt got server-rejection copy (#22).
  // The classification has to happen here, while the original error still
  // exists; the alternative — loosening `isLikelyOffline` to match the masked
  // string — would make every server rejection read as offline.
  throw new Error(isLikelyOffline(error) ? OFFLINE_COPY : REJECTED_COPY);
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
