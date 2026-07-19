/**
 * AsyncStorage hygiene for the signed-in account: the T11 account blob and
 * the M8a active-project choice. One module owns every USER-SCOPED key
 * prefix so the sign-out sweep can't miss one — a key that survives into
 * another user's session leaks that user's data or choices. Device-scoped
 * keys (e.g. theme) deliberately do NOT live here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const ACCOUNT_KEY_PREFIX = 'account:';
export const ACTIVE_PROJECT_KEY_PREFIX = 'activeProject:';

/** Cache key for the last successful account load — restores it offline (T11). */
export function accountKey(userId: string): string {
  return `${ACCOUNT_KEY_PREFIX}${userId}`;
}

/** Persisted project selection (M8a) — see ActiveProjectProvider. */
export function activeProjectKey(userId: string): string {
  return `${ACTIVE_PROJECT_KEY_PREFIX}${userId}`;
}

const SWEPT_PREFIXES = [ACCOUNT_KEY_PREFIX, ACTIVE_PROJECT_KEY_PREFIX];

/**
 * Remove every user-scoped blob — the signing-out user's, plus any stale
 * other-user keys left behind by older builds. Best-effort: a storage
 * failure must not block sign-out.
 */
export async function clearAccountCaches(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const swept = keys.filter((key) => SWEPT_PREFIXES.some((p) => key.startsWith(p)));
    if (swept.length > 0) await AsyncStorage.multiRemove(swept);
  } catch {
    // Storage unavailable — nothing actionable; the blobs are also
    // overwritten on the next successful account load.
  }
}
