/**
 * AsyncStorage hygiene for the signed-in account: the T11 account blob, the
 * M8a active-project choice, and the create-company refusal flag. One module owns every USER-SCOPED key
 * prefix so the sign-out sweep can't miss one — a key that survives into
 * another user's session leaks that user's data or choices. Device-scoped
 * keys (e.g. theme) deliberately do NOT live here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const ACCOUNT_KEY_PREFIX = 'account:';
export const ACTIVE_PROJECT_KEY_PREFIX = 'activeProject:';
export const CREATE_COMPANY_REFUSED_KEY_PREFIX = 'createCompanyRefused:';

/** Cache key for the last successful account load — restores it offline (T11). */
export function accountKey(userId: string): string {
  return `${ACCOUNT_KEY_PREFIX}${userId}`;
}

/** Persisted project selection (M8a) — see ActiveProjectProvider. */
export function activeProjectKey(userId: string): string {
  return `${ACTIVE_PROJECT_KEY_PREFIX}${userId}`;
}

/**
 * Set once `create_own_company` refused this user as already affiliated
 * (PL002) and a reload still showed no membership — a live phone-book contact
 * or a company creator with no membership row. The server will refuse them
 * every time, so the Today card stays hidden (see CreateCompanySection).
 */
export function createCompanyRefusedKey(userId: string): string {
  return `${CREATE_COMPANY_REFUSED_KEY_PREFIX}${userId}`;
}

/**
 * Strip contact PII from the account blob before it lands in plaintext
 * AsyncStorage: `profile.email` / `profile.phone` never persist. Display
 * email is backfilled from the SecureStore-held session on offline restore,
 * so the cache needs neither. Structural generic so this module doesn't
 * import AuthProvider's types (which would cycle).
 */
export function pruneAccountForCache<
  P extends { readonly email?: unknown; readonly phone?: unknown },
  A extends { readonly profile: P | null },
>(account: A): Omit<A, 'profile'> & { readonly profile: Omit<P, 'email' | 'phone'> | null } {
  const { profile } = account;
  if (!profile) return { ...account, profile: null };
  const { email: _email, phone: _phone, ...pruned } = profile;
  return { ...account, profile: pruned };
}

const SWEPT_PREFIXES = [
  ACCOUNT_KEY_PREFIX,
  ACTIVE_PROJECT_KEY_PREFIX,
  CREATE_COMPANY_REFUSED_KEY_PREFIX,
];

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
