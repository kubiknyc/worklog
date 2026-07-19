/**
 * AuthProvider — the single source of truth for the signed-in session.
 *
 * Tracks the Supabase session, the user's `profiles` row, and their
 * `project_members` rows (role per project). Exposes sign-in / sign-out and a
 * profile updater. Routing layers off `status`:
 *   - 'loading'   → splash / nothing (initial session restore in flight)
 *   - 'signedOut' → (auth) stack
 *   - 'authed'    → (tabs) stack
 *
 * Session persistence + auto-refresh are configured on the client itself
 * (expo-secure-store adapter, see src/supabase/client.ts); here we only mirror
 * auth-state changes into React state.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AuthApiError } from '@supabase/supabase-js';
import type { Session } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '../supabase/client';
import { accountKey, clearAccountCaches } from './accountCaches';
import type { Tables, TablesUpdate } from '../supabase/types';
import { mergeEffectiveMemberships, type CompanyMembership, type Membership } from './roles';

// expo_push_token is intentionally absent: migration 20260707000001 revokes it
// from the profiles SELECT grant (teammate push-token leak), so the client never
// selects it. The only push-token path is the set_push_token() RPC.
type Profile = Omit<Tables<'profiles'>, 'expo_push_token'>;

/** Columns the profiles SELECT grant (20260707000001) exposes — every column
 *  except expo_push_token. Kept in sync with that migration. */
const PROFILE_COLUMNS =
  'id, full_name, email, phone, company, trade, avatar_url, created_at, notify_push, notify_digest, notify_mentions';
type AuthStatus = 'loading' | 'authed' | 'signedOut';

/** Allowlist of user-editable profile fields (never `id` or system columns). */
export type ProfilePatch = Pick<
  TablesUpdate<'profiles'>,
  | 'full_name'
  | 'company'
  | 'trade'
  | 'phone'
  | 'avatar_url'
  | 'notify_push'
  | 'notify_digest'
  | 'notify_mentions'
>;

interface AuthState {
  readonly status: AuthStatus;
  readonly session: Session | null;
  readonly profile: Profile | null;
  /** Effective per-project roles: project_members rows MERGED with synthesized
   *  `super` entries for company-admin projects (see mergeEffectiveMemberships). */
  readonly memberships: readonly Membership[];
  readonly companyMemberships: readonly CompanyMembership[];
  /** company_id (or null) per visible project — lets screens ask whether the
   *  active project belongs to a company without another query. */
  readonly projectCompanies: Readonly<Record<string, string | null>>;
}

export interface AuthContextValue extends AuthState {
  readonly userId: string | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  /**
   * Send a password-reset email whose action link deep-links back into the
   * app's set-password screen. Returns a user-facing error message, or null
   * when the request was accepted (GoTrue answers success for unknown emails
   * too, so success never confirms an account exists).
   */
  resetPassword: (email: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  /**
   * Permanently delete the signed-in user's account (App Store 5.1.1(v)) via
   * the `delete-account` edge function, then clear this device. Returns a
   * user-facing error message, or null on success. Online-only.
   */
  deleteAccount: () => Promise<string | null>;
  updateProfile: (patch: ProfilePatch) => Promise<string | null>;
  refresh: () => Promise<void>;
}

const SIGNED_OUT: AuthState = {
  status: 'signedOut',
  session: null,
  profile: null,
  memberships: [],
  companyMemberships: [],
  projectCompanies: {},
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Map a GoTrue auth error to a safe, user-facing message. Raw `error.message`
 * leaks internal detail ("User not found", "Email rate limit exceeded"), so map
 * the known status codes to scrubbed strings and fall back to a generic message.
 */
function authMessage(error: unknown): string {
  if (error instanceof AuthApiError) {
    if (error.status === 429) return 'Too many attempts. Please wait and try again.';
    if (error.status === 400) return 'Invalid email or password.';
  }
  return 'Something went wrong. Please try again.';
}

/**
 * Extract the server-sent plain-language `message` from a failed
 * functions.invoke call (FunctionsHttpError carries the Response as
 * `context`). Null when the failure carried none — network error, non-JSON
 * body, or an unexpected shape — so callers fall back to generic copy.
 */
async function readFunctionErrorMessage(error: unknown): Promise<string | null> {
  const context = (error as { context?: unknown } | null)?.context;
  if (!(context instanceof Response)) return null;
  try {
    const body: unknown = await context.json();
    const message = (body as { message?: unknown } | null)?.message;
    return typeof message === 'string' && message.length > 0 ? message : null;
  } catch {
    return null;
  }
}

interface AccountData {
  readonly profile: Profile | null;
  readonly memberships: Membership[];
  readonly companyMemberships: CompanyMembership[];
  readonly projectCompanies: Record<string, string | null>;
}

/**
 * True when the server has definitively rejected this session (revoked or the
 * user was deleted). `getUser()` validates the JWT server-side: a 401/403
 * AuthApiError is a verdict; a network failure (AuthRetryableFetchError, not
 * AuthApiError) proves nothing and reads as "not revoked" so offline launches
 * keep reaching cached data.
 */
async function isSessionRevoked(): Promise<boolean> {
  try {
    const { error } = await supabase.auth.getUser();
    return error instanceof AuthApiError && (error.status === 401 || error.status === 403);
  } catch {
    return false;
  }
}

/** Load the profile + memberships for a user id (RLS scopes all four to them).
 *  `projects` is visible per the widened is_member (20260712000001), so a
 *  company admin sees company projects even with zero project_members rows —
 *  which is exactly what lets mergeEffectiveMemberships synthesize their
 *  `super` entries here. */
async function loadAccount(userId: string): Promise<AccountData> {
  const [profileRes, membersRes, companyRes, projectsRes] = await Promise.all([
    supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle(),
    supabase.from('project_members').select('project_id, role').eq('user_id', userId),
    supabase.from('company_members').select('company_id, role').eq('user_id', userId),
    supabase.from('projects').select('id, company_id'),
  ]);
  if (profileRes.error) throw profileRes.error;
  if (membersRes.error) throw membersRes.error;
  if (companyRes.error) throw companyRes.error;
  if (projectsRes.error) throw projectsRes.error;
  const companyMemberships = companyRes.data ?? [];
  const projects = projectsRes.data ?? [];
  return {
    profile: profileRes.data,
    memberships: mergeEffectiveMemberships(membersRes.data ?? [], companyMemberships, projects),
    companyMemberships,
    projectCompanies: Object.fromEntries(projects.map((p) => [p.id, p.company_id])),
  };
}

/** Last account load persisted on this device, or null. Used when offline. */
async function cachedAccount(userId: string): Promise<AccountData | null> {
  try {
    const raw = await AsyncStorage.getItem(accountKey(userId));
    return raw ? (JSON.parse(raw) as AccountData) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ ...SIGNED_OUT, status: 'loading' });
  // Guards writes after unmount (async session restore).
  const mountedRef = useRef(true);
  // Monotonic token: only the newest applySession invocation may commit state,
  // so a slow loadAccount from a superseded session can't overwrite a newer one
  // (e.g. an in-flight sign-in resolving after a sign-out).
  const sessionGenRef = useRef(0);
  // Latest session, read by the stable updateProfile/refresh callbacks so they
  // don't rebuild (and churn the context) on every token refresh.
  const sessionRef = useRef<Session | null>(null);

  const applySession = useCallback(async (session: Session | null) => {
    const gen = ++sessionGenRef.current;
    sessionRef.current = session;

    if (!session) {
      if (mountedRef.current) setState(SIGNED_OUT);
      return;
    }
    const commit = (next: AuthState) => {
      if (mountedRef.current && sessionGenRef.current === gen) setState(next);
    };
    try {
      const account = await loadAccount(session.user.id);
      commit({ status: 'authed', session, ...account });
      // Persist so a later offline launch restores projects/role (T11). Gated
      // on the generation token so a slow load resolving after sign-out can't
      // re-persist PII that signOut() just cleared.
      if (sessionGenRef.current === gen) {
        void AsyncStorage.setItem(accountKey(session.user.id), JSON.stringify(account));
      }
    } catch {
      // The account fetch failed. Before falling back to cached data,
      // distinguish "revoked/deleted server-side" from "transient network":
      // a revoked session must never reach this device's cached account.
      if (await isSessionRevoked()) {
        // isSessionRevoked() was in flight for THIS (possibly stale) generation.
        // If a newer session was installed while we awaited the verdict, that
        // newer applySession now owns state — purging the local session and
        // clearing caches here would wipe out the new user's just-loaded
        // account instead of the revoked one's. Bail without side effects.
        if (sessionGenRef.current !== gen) return;
        // Purge the stored session locally (the server already rejects it —
        // a server-side revoke call would just fail again) and clear cached
        // PII, then land on the (auth) stack.
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
        await clearAccountCaches();
        commit(SIGNED_OUT);
        return;
      }
      // Transient network / offline: restore the last cached account so a
      // returning user reaches their offline data, instead of a misleading
      // "no project" empty state. A later refresh() recovers live data.
      // The company fields default for JSON cached before 20260712 — the
      // memberships array itself already carries the merged super entries, so
      // an offline admin keeps their powers without a cache-key bump.
      const cached = await cachedAccount(session.user.id);
      commit({
        status: 'authed',
        session,
        profile: cached?.profile ?? null,
        memberships: cached?.memberships ?? [],
        companyMemberships: cached?.companyMemberships ?? [],
        projectCompanies: cached?.projectCompanies ?? {},
      });
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    // onAuthStateChange fires INITIAL_SESSION synchronously on subscribe, which
    // covers the restore-from-storage case — no separate getSession() needed.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session);
    });
    return () => {
      mountedRef.current = false;
      data.subscription.unsubscribe();
    };
  }, [applySession]);

  const signIn = useCallback(async (email: string, password: string): Promise<string | null> => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    // onAuthStateChange drives the state transition on success.
    return error ? authMessage(error) : null;
  }, []);

  const resetPassword = useCallback(async (email: string): Promise<string | null> => {
    // Same redirect target the invite flow will use once app/set-password.tsx
    // ships (M2, P2-9). `worklog://set-password` must be in Supabase Auth →
    // URL Configuration → Redirect URLs before that screen lands.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: 'worklog://set-password',
    });
    if (!error) return null;
    // authMessage's 400 copy ("Invalid email or password") is wrong here.
    if (error instanceof AuthApiError && error.status === 429) {
      return 'Too many attempts. Please wait and try again.';
    }
    return "Couldn't send the reset email. Check the address and try again.";
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    // On success onAuthStateChange emits SIGNED_OUT and drives the transition.
    const { error } = await supabase.auth.signOut();
    // Local cleanup happens regardless of the server call's outcome: the user
    // asked to leave this device, so cached PII must go.
    await clearAccountCaches();
    if (error) {
      // The revoke request failed (e.g. offline) and supabase-js keeps the
      // stored session, so SIGNED_OUT never fires. No toast surface is wired
      // up yet (M0), so log for diagnostics and force the local signed-out
      // transition so the UI still lands on the (auth) stack with caches
      // cleared.
      console.warn('Sign-out request failed; clearing local session state anyway.', error);
      await applySession(null);
    }
  }, [applySession]);

  const deleteAccount = useCallback(async (): Promise<string | null> => {
    if (!sessionRef.current) return 'Not signed in.';
    // Server-side deletion first — the edge function resolves the caller from
    // the session JWT (never a parameter) and tombstones/deletes atomically
    // enough that a failure leaves the account intact and retryable.
    const { error } = await supabase.functions.invoke('delete-account');
    if (error) {
      // The function refuses with a plain-language `message` when deletion
      // must not proceed (e.g. the caller is a company's only administrator).
      // Surface that verbatim; anything else gets the generic retry copy.
      const serverMessage = await readFunctionErrorMessage(error);
      return serverMessage ?? "Couldn't delete your account. Check your connection and try again.";
    }
    // The auth user is gone, so the server-side session revoke inside
    // signOut() will fail — it tolerates that and still clears this device's
    // caches and forces the signed-out transition.
    await signOut();
    return null;
  }, [signOut]);

  const updateProfile = useCallback(async (patch: ProfilePatch): Promise<string | null> => {
    const userId = sessionRef.current?.user.id;
    if (!userId) return 'Not signed in.';
    // Captured before the await: if a newer session lands while this PATCH is
    // in flight, the response belongs to a superseded user and must not
    // overwrite the newer session's committed state (mirrors applySession's
    // gen-token guard above).
    const gen = sessionGenRef.current;
    const { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', userId)
      // `select('*')` would 403: the profiles grant (20260707000001) excludes
      // expo_push_token, and RETURNING * needs SELECT on every column.
      .select(PROFILE_COLUMNS)
      .maybeSingle();
    // PostgREST errors can leak schema details — keep them out of the UI.
    if (error) return 'Could not save your profile. Please try again.';
    if (data && mountedRef.current && sessionGenRef.current === gen) {
      setState((prev) => ({ ...prev, profile: data }));
    }
    return null;
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    await applySession(sessionRef.current);
  }, [applySession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      userId: state.session?.user.id ?? null,
      signIn,
      resetPassword,
      signOut,
      deleteAccount,
      updateProfile,
      refresh,
    }),
    [state, signIn, resetPassword, signOut, deleteAccount, updateProfile, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
