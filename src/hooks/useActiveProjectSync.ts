/**
 * Bridges `ActiveProjectProvider`'s `activeProjectId` to
 * `Repository.setActiveProject`. Mounted once in `app/(tabs)/_layout.tsx` —
 * Jest ignores `app/`, so this hook (not the mount call) carries the test
 * coverage. `pull.native.ts`'s orchestrator reads `sync_meta.active_project_id`
 * to scope its per-report pull; this hook is what keeps that key in step with
 * whichever project the user is actually looking at. A null id (signed out,
 * or the persisted choice not yet resolved) writes nothing; a write failure is
 * swallowed — sync bookkeeping must never break navigation.
 */
import { useEffect } from 'react';

import { useRepository } from '../data/RepositoryProvider';
import { useActiveProject } from '../project/ActiveProjectProvider';

export function useActiveProjectSync(): void {
  const { activeProjectId } = useActiveProject();
  const repo = useRepository();

  useEffect(() => {
    if (!activeProjectId) return;
    void repo.setActiveProject(activeProjectId).catch(() => {});
  }, [activeProjectId, repo]);
}
