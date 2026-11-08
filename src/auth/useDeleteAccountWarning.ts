/**
 * Extra paragraph for the delete-account confirm sheet: tells a company admin
 * that deleting their account may delete their company too, and anyone that
 * it deletes their sole-member no-company projects (every WorkLog-created
 * project is one; independent of company admin status). Shown immediately
 * (conditional wording), then sharpened with counts once the roster check
 * lands, or dropped if other people turn out to use the company. A failed
 * check keeps the conditional wording — never false reassurance.
 */
import { useEffect, useState } from 'react';

import { useAuth } from './AuthProvider';
import {
  deleteWarningText,
  loadCompanyNames,
  loadNoCompanyImpact,
  loadSoloCompanyImpact,
  type DeleteWarningEntry,
  type NoCompanyImpact,
  type NoCompanyWarning,
} from './soloCompany';

type Impact = Awaited<ReturnType<typeof loadSoloCompanyImpact>>;

export function useDeleteAccountWarning(visible: boolean): string {
  const { userId, companyMemberships, projectCompanies, memberships } = useAuth();
  const [impacts, setImpacts] = useState<Readonly<Record<string, Impact>>>({});
  // undefined = still loading, null = could not tell.
  const [noCoImpact, setNoCoImpact] = useState<NoCompanyImpact | null | undefined>(undefined);
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});

  const adminCompanyIds = companyMemberships
    .filter((m) => m.role === 'admin')
    .map((m) => m.company_id);
  const adminKey = adminCompanyIds.join(',');

  const noCoKey = Object.keys(projectCompanies)
    .filter((id) => projectCompanies[id] === null)
    .sort()
    .join(',');
  const superKey = memberships
    .filter((m) => m.role === 'super')
    .map((m) => m.project_id)
    .sort()
    .join(',');

  useEffect(() => {
    if (!visible || !userId || noCoKey === '') return;
    let cancelled = false;
    loadNoCompanyImpact(userId, noCoKey.split(','), new Set(superKey.split(',')))
      .catch(() => null)
      .then((impact) => {
        if (!cancelled) setNoCoImpact(impact);
      });
    return () => {
      cancelled = true;
      setNoCoImpact(undefined);
    };
  }, [visible, userId, noCoKey, superKey]);

  useEffect(() => {
    if (!visible || !userId || adminKey === '') return;
    let cancelled = false;
    const ids = adminKey.split(',');
    loadCompanyNames(ids)
      .catch(() => ({}) as Record<string, string>)
      .then((found) => {
        if (!cancelled) setNames(found);
      });
    for (const companyId of ids) {
      const projectIds = Object.keys(projectCompanies).filter(
        (id) => projectCompanies[id] === companyId,
      );
      loadSoloCompanyImpact(userId, companyId, projectIds)
        .catch(() => null)
        .then((impact) => {
          if (!cancelled) setImpacts((prev) => ({ ...prev, [companyId]: impact }));
        });
    }
    return () => {
      cancelled = true;
      setImpacts({});
    };
  }, [visible, userId, adminKey, projectCompanies]);

  const entries: DeleteWarningEntry[] = [];
  for (const companyId of adminCompanyIds) {
    const impact = impacts[companyId];
    if (impact?.solo === false) continue;
    entries.push({
      name: names[companyId] ?? 'your company',
      state: impact?.solo ? 'solo' : 'maybe',
      projects:
        impact?.projects ?? Object.values(projectCompanies).filter((c) => c === companyId).length,
      reports: impact?.reports ?? null,
      sealedReports: impact?.sealedReports ?? null,
    });
  }
  let noCompany: NoCompanyWarning | undefined;
  if (noCoKey !== '' && noCoImpact?.projects !== 0) {
    noCompany = noCoImpact
      ? { state: 'solo', ...noCoImpact }
      : { state: 'maybe', projects: 0, reports: null, sealedReports: null };
  }
  return deleteWarningText(entries, noCompany);
}
