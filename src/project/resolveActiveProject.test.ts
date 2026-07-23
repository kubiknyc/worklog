/**
 * resolveActiveProject — pure resolution of the active project id.
 * Order: valid persisted choice → deterministic default (lowest project_id
 * by string sort) → null when the user has no memberships.
 */
import type { Membership } from '../auth/roles';
import { resolveActiveProject } from './resolveActiveProject';

const m = (id: string, role: Membership['role'] = 'super'): Membership => ({
  project_id: id,
  role,
});

test('keeps a persisted id that is still among the memberships', () => {
  expect(resolveActiveProject('p-b', [m('p-a'), m('p-b')])).toBe('p-b');
});

test('discards a persisted id the user no longer belongs to', () => {
  // Kicked from p-old → deterministic default, not the stale choice.
  expect(resolveActiveProject('p-old', [m('p-b'), m('p-a')])).toBe('p-a');
});

test('defaults to the lowest project_id by string sort when nothing persisted', () => {
  expect(resolveActiveProject(null, [m('p-c'), m('p-a', 'sub'), m('p-b')])).toBe('p-a');
});

test('is stable regardless of membership order', () => {
  const forward = resolveActiveProject(null, [m('p-1'), m('p-2')]);
  const reversed = resolveActiveProject(null, [m('p-2'), m('p-1')]);
  expect(forward).toBe(reversed);
});

test('returns null with zero memberships, even with a persisted id', () => {
  expect(resolveActiveProject('p-a', [])).toBeNull();
  expect(resolveActiveProject(null, [])).toBeNull();
});
