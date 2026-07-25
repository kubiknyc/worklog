/**
 * Pure auth helpers — role resolution, profile-completeness, and credential
 * validation. No React or Supabase imports so this stays unit-testable.
 *
 * Role is per-project (a user can be `super` on one project and `sub` on
 * another), resolved from the `project_members` rows returned for the signed-in
 * user. See BUILD_PLAN M2 ("Role resolved per-project from project_members").
 */
import type { Tables } from '../supabase/types';

export type ProjectRole = Tables<'project_members'>['role'];
export type CompanyRole = Tables<'company_members'>['role'];

/** The membership shape the app actually selects (project_id + role). */
export interface Membership {
  readonly project_id: string;
  readonly role: ProjectRole;
}

/** The company-membership shape the app selects (company_id + role). */
export interface CompanyMembership {
  readonly company_id: string;
  readonly role: CompanyRole;
}

/** True when the user administers at least one company. */
export function isCompanyAdmin(companyMemberships: readonly CompanyMembership[]): boolean {
  return companyMemberships.some((m) => m.role === 'admin');
}

/**
 * Merge project_members rows with synthesized `super` entries for every
 * project of a company the user administers — the client-side mirror of the
 * server's widened `private.is_super` (migration 20260712000001), where a
 * company admin is a super on all company projects regardless of pm rows
 * (an explicit `sub` row is therefore overridden to `super`).
 *
 * NOTE: the result is no longer a 1:1 mirror of project_members rows. That is
 * deliberate and safe: no client code writes pm rows from this array, and the
 * server remains the authorization authority — this only drives UI gating.
 */
export function mergeEffectiveMemberships(
  pmRows: readonly Membership[],
  companyMemberships: readonly CompanyMembership[],
  projects: readonly { readonly id: string; readonly company_id: string | null }[],
): Membership[] {
  const adminCompanies = new Set(
    companyMemberships.filter((m) => m.role === 'admin').map((m) => m.company_id),
  );
  if (adminCompanies.size === 0) return [...pmRows];

  const adminProjects = new Set(
    projects
      .filter((p) => p.company_id !== null && adminCompanies.has(p.company_id))
      .map((p) => p.id),
  );
  const merged: Membership[] = pmRows.map((m) =>
    adminProjects.has(m.project_id) && m.role !== 'super' ? { ...m, role: 'super' } : m,
  );
  const covered = new Set(pmRows.map((m) => m.project_id));
  for (const projectId of adminProjects) {
    if (!covered.has(projectId)) merged.push({ project_id: projectId, role: 'super' });
  }
  return merged;
}

/** Role for a specific project, or `null` if the user is not a member. */
export function roleForProject(
  memberships: readonly Membership[],
  projectId: string,
): ProjectRole | null {
  const match = memberships.find((m) => m.project_id === projectId);
  return match ? match.role : null;
}

/** True when the user is `super` on at least one project. */
export function isSuperOnAnyProject(memberships: readonly Membership[]): boolean {
  return memberships.some((m) => m.role === 'super');
}

/**
 * A profile is "complete" once its required editable field (full name) is set.
 * The `handle_new_user` trigger inserts a row with an empty `full_name`, so a
 * brand-new user lands on the complete-profile step until they fill it in.
 */
export function isProfileComplete(profile: Pick<Tables<'profiles'>, 'full_name'> | null): boolean {
  return !!profile && profile.full_name.trim().length > 0;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Minimal client-side email shape check (server is the real authority). */
export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export interface CredentialError {
  readonly field: 'email' | 'password';
  readonly message: string;
}

/** Validate login inputs before hitting the network. Returns null when valid. */
export function validateCredentials(email: string, password: string): CredentialError | null {
  if (!isValidEmail(email)) {
    return { field: 'email', message: 'Enter a valid email address.' };
  }
  if (password.length < 6) {
    return { field: 'password', message: 'Password must be at least 6 characters.' };
  }
  return null;
}
