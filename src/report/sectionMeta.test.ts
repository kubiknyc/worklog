import { SECTION_KINDS } from '../sync/types';
import { REPORT_ROWS, SECTION_META, sectionMetaFor } from './sectionMeta';

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

/**
 * These three existed before #22 and all passed while `REPORT_ROWS` was a
 * hand-maintained SECOND copy of `SECTION_META`'s labels, icons and order —
 * they only ever checked kind coverage, never the display strings. Renaming a
 * label in `SECTION_META` (the file the header calls "the ONE place") changed
 * nothing on screen and broke no test. The block below is what makes the
 * derivation real.
 */
describe('REPORT_ROWS derives from SECTION_META', () => {
  test('single-kind rows take their label and icon from SECTION_META', () => {
    for (const row of REPORT_ROWS) {
      if (row.kinds.length !== 1) continue;
      const meta = sectionMetaFor(row.kinds[0]);
      expect(row.label).toBe(meta.label);
      expect(row.icon).toBe(meta.icon);
      expect(row.id).toBe(meta.kind);
    }
  });

  test('row order follows SECTION_META order, with a group at its first member', () => {
    // PRD §7 frequency order — Weather first, General notes last. Deriving the
    // order is the point: two lists could drift, one cannot.
    const firstKindOf = REPORT_ROWS.map((r) => r.kinds[0]);
    const expected = SECTION_META.map((m) => m.kind).filter(
      (kind) => kind !== 'work_performed', // folded into the crew_work row
    );
    expect(firstKindOf).toEqual(expected);
  });

  test('the grouped row keeps its own label, which is neither members label', () => {
    const row = REPORT_ROWS.find((r) => r.id === 'crew_work');
    expect(row?.label).toBe('Crew & work by trade');
    expect(row?.label).not.toBe(sectionMetaFor('crew').label);
    expect(row?.label).not.toBe(sectionMetaFor('work_performed').label);
  });

  test('every SECTION_META entry is reachable through sectionMetaFor', () => {
    // `META_BY_KIND` is built with a cast; `_AllKindsCovered` is what makes it
    // sound. This is the runtime half of that guarantee.
    for (const kind of SECTION_KINDS) {
      expect(sectionMetaFor(kind)).toBeDefined();
      expect(sectionMetaFor(kind).kind).toBe(kind);
    }
  });
});
