/**
 * Pure list-building for the project switcher (T23). One superintendent runs
 * several job sites, so Settings needs a way to move between them — before
 * this, `setActiveProject` was only ever called right after a create.
 *
 * Input is the user's memberships (the authoritative "which projects can I
 * see" list — the same one `resolveActiveProject` validates against) plus
 * whatever project rows the repo could resolve. A membership whose row hasn't
 * synced down yet still appears, under a placeholder name, so the switcher
 * never hides a project the user belongs to.
 */
import type { Membership, ProjectRole } from '../auth/roles';

export const UNSYNCED_PROJECT_NAME = 'Project (syncing…)';

export interface ProjectOption {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
  readonly role: ProjectRole;
  readonly active: boolean;
}

export interface ProjectSummary {
  readonly name: string;
  readonly address?: string | null;
}

export function buildProjectOptions(
  memberships: readonly Membership[],
  projects: ReadonlyMap<string, ProjectSummary | null>,
  activeProjectId: string | null,
): ProjectOption[] {
  const seen = new Set<string>();
  const options: ProjectOption[] = [];
  for (const m of memberships) {
    if (seen.has(m.project_id)) continue;
    seen.add(m.project_id);
    const row = projects.get(m.project_id) ?? null;
    options.push({
      id: m.project_id,
      name: row?.name.trim() || UNSYNCED_PROJECT_NAME,
      address: row?.address?.trim() || null,
      role: m.role,
      active: m.project_id === activeProjectId,
    });
  }
  // Name order (case-insensitive), id as the tiebreak — two jobs can share a
  // name ("Hunt residence"), and the order must not flicker between renders.
  return options.sort(
    (a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id),
  );
}
