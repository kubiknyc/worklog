/**
 * "Am I the only person in my company?" — behind the extra warning on
 * Settings › Delete account.
 *
 * The delete-account edge function deletes a company together with its sole
 * member's account — every project, daily report (locked and signed ones too),
 * photo and PDF — and refuses with `last_admin` when other people use it. The
 * server makes the final call; this only lets the confirm sheet say so BEFORE
 * the user confirms. It is answerable from the client because a company admin
 * can read every row involved:
 *   - `cm_read` (20260712000001): any company member reads the whole roster.
 *   - `pm_read` / `projects_read`: `private.is_member` treats a company admin
 *     as a member of every company project, so all project_members rows show.
 *   - `daily_reports_select` (20260717000003): gated on `private.is_super`,
 *     which includes the project's company admins (20260712000001) — with no
 *     author or draft restriction, so an admin's counts are complete.
 *   - `companies_read` (20260712000001): members read their company's name.
 * Project ids come from the account load (`projectCompanies`), not a query.
 *
 * "Locked or signed" = status `submitted` or `locked`: `submit_report`
 * (20260717000007) writes the signature in the same transaction that sets
 * `submitted`, and `locked` only follows `submitted`. Drafts are unsigned.
 *
 * No-company projects (WorkLog creates every project without a company): the
 * server also deletes each project with `company_id IS NULL` where the caller
 * has a project_members row and NO other user does — any role, with or without
 * a company. `loadNoCompanyImpact` mirrors that rule. Report counts are only
 * read for projects where the caller is `super`: `daily_reports_select` is
 * `private.is_super`, and RLS FILTERS rather than errors, so anyone else would
 * get a silent, too-low 0. Mixed or non-super => no counts at all.
 *
 * Failure is never reassurance: an unreadable roster returns `null` (unknown)
 * and the caller keeps showing the conditional warning.
 */
import { supabase } from '../supabase/client';

export interface SoloCompanyImpact {
  /** True when nobody else is a company member or a member of its projects. */
  readonly solo: boolean;
  /** Counts are best-effort: null when that count could not be read. */
  readonly reports: number | null;
  /** Reports that are submitted (signed) or locked. */
  readonly sealedReports: number | null;
  /** Project count, set when this call had to fetch the company's projects itself. */
  readonly projects?: number;
}

const NOT_SOLO: SoloCompanyImpact = { solo: false, reports: null, sealedReports: null };

/** null = could not tell. */
export async function loadSoloCompanyImpact(
  userId: string,
  companyId: string,
  knownProjectIds: readonly string[],
): Promise<SoloCompanyImpact | null> {
  const others = await supabase
    .from('company_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .neq('user_id', userId);
  if (others.error || others.count === null) return null;
  if (others.count > 0) return NOT_SOLO;

  let projectIds = knownProjectIds;
  let fetchedProjects: number | undefined;
  if (projectIds.length === 0) {
    // The account load may simply not have listed this company's projects yet.
    const rows = await supabase.from('projects').select('id').eq('company_id', companyId);
    if (rows.error || !rows.data) return null;
    if (rows.data.length === 0) return { solo: true, reports: 0, sealedReports: 0, projects: 0 };
    projectIds = rows.data.map((r) => r.id);
    fetchedProjects = projectIds.length;
  }

  // ponytail: one `in` list per query — fine for a handful of projects; page it if a company has hundreds.
  const ids = [...projectIds];
  const [people, reports, sealed] = await Promise.all([
    supabase
      .from('project_members')
      .select('user_id', { count: 'exact', head: true })
      .in('project_id', ids)
      .neq('user_id', userId),
    supabase
      .from('daily_reports')
      .select('id', { count: 'exact', head: true })
      .in('project_id', ids),
    supabase
      .from('daily_reports')
      .select('id', { count: 'exact', head: true })
      .in('project_id', ids)
      .in('status', ['submitted', 'locked']),
  ]);
  if (people.error || people.count === null) return null;
  if (people.count > 0) return NOT_SOLO;
  return {
    solo: true,
    reports: reports.error ? null : reports.count,
    sealedReports: sealed.error ? null : sealed.count,
    ...(fetchedProjects === undefined ? {} : { projects: fetchedProjects }),
  };
}

export interface NoCompanyImpact {
  /** How many of the caller's no-company projects nobody else is a member of. */
  readonly projects: number;
  /** null when not reliably countable (caller is not super on every one of them). */
  readonly reports: number | null;
  readonly sealedReports: number | null;
}

/**
 * The server's no-company rule, client side. `candidateIds` = the caller's own
 * projects with no company; `superIds` = those where the caller's role is super.
 * null = could not tell.
 */
export async function loadNoCompanyImpact(
  userId: string,
  candidateIds: readonly string[],
  superIds: ReadonlySet<string>,
): Promise<NoCompanyImpact | null> {
  const others = await supabase
    .from('project_members')
    .select('project_id')
    .in('project_id', [...candidateIds])
    .neq('user_id', userId);
  if (others.error || !others.data) return null;
  const shared = new Set(others.data.map((r) => r.project_id));
  const sole = candidateIds.filter((id) => !shared.has(id));
  if (sole.length === 0) return { projects: 0, reports: null, sealedReports: null };
  if (!sole.every((id) => superIds.has(id))) {
    return { projects: sole.length, reports: null, sealedReports: null };
  }
  const [reports, sealed] = await Promise.all([
    supabase
      .from('daily_reports')
      .select('id', { count: 'exact', head: true })
      .in('project_id', sole),
    supabase
      .from('daily_reports')
      .select('id', { count: 'exact', head: true })
      .in('project_id', sole)
      .in('status', ['submitted', 'locked']),
  ]);
  return {
    projects: sole.length,
    reports: reports.error ? null : reports.count,
    sealedReports: sealed.error ? null : sealed.count,
  };
}

/** Company names by id; empty on any failure (the caller falls back to wording without a name). */
export async function loadCompanyNames(
  companyIds: readonly string[],
): Promise<Record<string, string>> {
  const res = await supabase
    .from('companies')
    .select('id, name')
    .in('id', [...companyIds]);
  if (res.error || !res.data) return {};
  return Object.fromEntries(res.data.map((c) => [c.id, c.name]));
}

export interface DeleteWarningEntry {
  readonly name: string;
  /** 'solo' = confirmed the only person; 'maybe' = couldn't tell yet. */
  readonly state: 'solo' | 'maybe';
  readonly projects: number;
  readonly reports: number | null;
  readonly sealedReports: number | null;
}

export interface NoCompanyWarning {
  readonly state: 'solo' | 'maybe';
  readonly projects: number;
  readonly reports: number | null;
  readonly sealedReports: number | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const sealedClause = (sealed: number | null) =>
  sealed !== null && sealed > 0 ? `, ${sealed} of them locked or signed` : '';

function noCompanySentence(w: NoCompanyWarning): string {
  if (w.state === 'maybe') {
    return (
      "If you're the only person on a project that isn't part of a company, deleting your account " +
      'also permanently deletes that project with its daily reports (including locked and signed reports) and photos.'
    );
  }
  const one = w.projects === 1;
  const counts =
    w.reports !== null
      ? ` (${plural(w.reports, 'daily report', 'daily reports')}${sealedClause(w.sealedReports)})`
      : '';
  return (
    `You're the only person on ${plural(w.projects, 'project', 'projects')} that ${one ? "isn't" : "aren't"} part of a company, ` +
    `so deleting your account also permanently deletes ${one ? 'it' : 'them'} with ${one ? 'its' : 'their'} ` +
    `daily reports (including locked and signed reports) and photos${counts}.`
  );
}

/** One sentence per company, then the no-company one; empty string when there is nothing to warn about. */
export function deleteWarningText(
  entries: readonly DeleteWarningEntry[],
  noCompany?: NoCompanyWarning,
): string {
  const companies = entries.map((e) => {
    if (e.state === 'maybe') {
      return (
        `If you're the only person in ${e.name}, deleting your account also permanently deletes ` +
        `${e.name} with all its projects, daily reports (including locked and signed reports) and photos.`
      );
    }
    const sealed = sealedClause(e.sealedReports);
    const counts =
      e.reports !== null && e.projects > 0
        ? ` (${plural(e.projects, 'project', 'projects')}, ${plural(e.reports, 'daily report', 'daily reports')}${sealed})`
        : '';
    return (
      `You're the only person in ${e.name}, so deleting your account also permanently deletes ` +
      `${e.name} and everything in it${counts}: its projects, daily reports (including locked and signed reports) and photos.`
    );
  });
  return [...companies, ...(noCompany ? [noCompanySentence(noCompany)] : [])].join(' ');
}

/**
 * Delete-account confirm copy. With a company-deletion warning, the base
 * sentence must not promise that the company's reports merely become
 * inaccessible — they are deleted.
 */
export function deleteAccountMessage(warning: string): string {
  if (!warning) {
    return "This permanently deletes your account and removes your access to this company's reports. It cannot be undone.";
  }
  return `${warning}\n\nThis permanently deletes your account and removes your access. It cannot be undone.`;
}
