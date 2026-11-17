import { SECTION_KINDS } from '../sync/types';
import { canEditSection, canLock, canSubmit, displayStatus } from './lifecycleGuards';

describe('lifecycleGuards', () => {
  it.each(SECTION_KINDS)('%s is editable only while draft', (_section) => {
    expect(canEditSection('draft')).toBe(true);
    expect(canEditSection('submitted')).toBe(false);
    expect(canEditSection('locked')).toBe(false);
  });

  it('canSubmit allows only draft → submitted', () => {
    expect(canSubmit('draft')).toBe(true);
    expect(canSubmit('submitted')).toBe(false);
    expect(canSubmit('locked')).toBe(false);
  });

  it('canLock allows only submitted → locked', () => {
    expect(canLock('submitted')).toBe(true);
    expect(canLock('draft')).toBe(false);
    expect(canLock('locked')).toBe(false);
  });
});

describe('displayStatus', () => {
  it.each([
    ['draft', 0, 'draft'],
    ['draft', 2, 'draft'],
    ['submitted', 0, 'submitted'],
    ['submitted', 1, 'submitted'],
    ['locked', 0, 'locked'],
    ['locked', 1, 'amended'],
    ['locked', 3, 'amended'],
  ] as const)('%s with %i amendments displays %s', (status, amendment_count, expected) => {
    expect(displayStatus({ status, amendment_count })).toBe(expected);
  });
});
