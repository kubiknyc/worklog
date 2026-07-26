import { SECTION_KINDS } from '../sync/types';
import { REPORT_ROWS } from './sectionMeta';

test('REPORT_ROWS covers every SectionKind exactly once', () => {
  const kinds = REPORT_ROWS.flatMap((r) => r.kinds);
  expect([...kinds].sort()).toEqual([...SECTION_KINDS].sort());
});

test('crew and work_performed share one row', () => {
  const row = REPORT_ROWS.find((r) => r.kinds.includes('crew'));
  expect(row?.kinds).toEqual(['crew', 'work_performed']);
});

test('row ids are unique', () => {
  const ids = REPORT_ROWS.map((r) => r.id);
  expect(new Set(ids).size).toBe(ids.length);
});
