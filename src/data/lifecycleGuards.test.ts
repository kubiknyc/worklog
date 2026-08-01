import { SECTION_KINDS } from '../sync/types';
import { canEditSection, canLock, canSubmit } from './lifecycleGuards';

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
