/**
 * Extra paragraph for the delete-account confirm sheet: tells a company admin
 * that deleting their account may delete their company too. Shown immediately
 * (conditional wording), then sharpened with counts once the roster check
 * lands, or dropped if other people turn out to use the company. A failed
 * check keeps the conditional wording — never false reassurance.
 */
import { useEffect, useState } from 'react';

import { useAuth } from './AuthProvider';
import {
  deleteWarningText,
  loadCompanyNames,
  loadSoloCompanyImpact,
  type DeleteWarningEntry,
} from './soloCompany';

type Impact = Awaited<ReturnType<typeof loadSoloCompanyImpact>>;

export function useDeleteAccountWarning(visible: boolean): string {
  const { userId, companyMemberships, projectCompanies } = useAuth();
  const [impacts, setImpacts] = useState<Readonly<Record<string, Impact>>>({});
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});

  const adminCompanyIds = companyMemberships
    .filter((m) => m.role === 'admin')
    .map((m) => m.company_id);
  const adminKey = adminCompanyIds.join(',');

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
  return deleteWarningText(entries);
}
