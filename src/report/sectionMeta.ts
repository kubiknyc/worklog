/**
 * Section display metadata — the ONE place the report-detail list learns each
 * section's label, icon, and display order. Pure and native-free: it names
 * sections, it does not read them (that is {@link ./summarize}).
 *
 * Order is PRD §7's frequency order (Weather first, General notes last), which
 * is the order sections render on the report detail screen and the PDF. It is
 * deliberately NOT `SECTION_KINDS` order (that array is the sync-payload
 * discriminator's own ordering, doc 06 drain order — a different concern).
 *
 * `collapsesWhenEmpty` mirrors PRD §7's "Collapses?" column, but has no reader
 * yet — see the field's own note.
 *
 * "ONE place" is now literal: `REPORT_ROWS` (what the screen actually renders)
 * is derived from `SECTION_META`, and every kind is guaranteed an entry by a
 * compile-time check. Both were previously claims this file did not keep.
 */
import { Ionicons } from '@expo/vector-icons';

import type { SectionKind } from '../sync/types';

export interface SectionMeta {
  readonly kind: SectionKind;
  /** Row label (PRD §7 section names). */
  readonly label: string;
  /** Leading glyph on the report-detail row. */
  readonly icon: keyof typeof Ionicons.glyphMap;
  /**
   * PRD §7 "Collapses?" — intended to drive the empty-state copy, not
   * visibility: a collapsing section shows "None today — tap to add" when
   * empty, a non-collapsing one always shows its full row.
   *
   * **NOT IMPLEMENTED.** Nothing reads this field, so the distinction does not
   * exist on screen yet (#22). It is kept because the PRD column is real; wire
   * it into the report-detail row before treating it as behaviour.
   */
  readonly collapsesWhenEmpty: boolean;
}

/**
 * The 11 sections in PRD §7 display order. Every {@link SectionKind} appears
 * exactly once — enforced by `_AllKindsCovered` below, which is a real compile
 * error rather than the annotation this used to claim as a guard. (A
 * `readonly SectionMeta[]` annotation accepts a SHORT array, so adding a 12th
 * kind type-checked fine while `sectionMetaFor` returned `undefined` typed as
 * `SectionMeta`.)
 */
export const SECTION_META = [
  { kind: 'weather', label: 'Weather', icon: 'partly-sunny-outline', collapsesWhenEmpty: false },
  { kind: 'crew', label: 'Crew by trade', icon: 'people-outline', collapsesWhenEmpty: false },
  {
    kind: 'work_performed',
    label: 'Work performed',
    icon: 'construct-outline',
    collapsesWhenEmpty: false,
  },
  { kind: 'deliveries', label: 'Deliveries', icon: 'cube-outline', collapsesWhenEmpty: true },
  { kind: 'equipment', label: 'Equipment', icon: 'build-outline', collapsesWhenEmpty: true },
  {
    kind: 'inspections',
    label: 'Inspections',
    icon: 'clipboard-outline',
    collapsesWhenEmpty: true,
  },
  { kind: 'safety', label: 'Safety', icon: 'shield-checkmark-outline', collapsesWhenEmpty: false },
  { kind: 'delays', label: 'Delays & impacts', icon: 'time-outline', collapsesWhenEmpty: true },
  { kind: 'visitors', label: 'Visitors', icon: 'walk-outline', collapsesWhenEmpty: true },
  { kind: 'rfis', label: 'RFIs / issues', icon: 'help-circle-outline', collapsesWhenEmpty: true },
  {
    kind: 'general_notes',
    label: 'General notes',
    icon: 'document-text-outline',
    collapsesWhenEmpty: true,
  },
] as const satisfies readonly SectionMeta[];

type AssertTrue<T extends true> = T;
/**
 * Compile error the moment a `SectionKind` has no `SECTION_META` entry. The
 * tuple wrapper matters: a bare `Exclude<…> extends never` is vacuously true,
 * because `never` is assignable to everything.
 */
type _AllKindsCovered = AssertTrue<
  [Exclude<SectionKind, (typeof SECTION_META)[number]['kind']>] extends [never] ? true : false
>;

// Sound because of `_AllKindsCovered`: every kind has exactly one entry, so
// the lookup is total and the cast is not papering over a gap.
const META_BY_KIND: Readonly<Record<SectionKind, SectionMeta>> = Object.fromEntries(
  SECTION_META.map((meta) => [meta.kind, meta]),
) as Record<SectionKind, SectionMeta>;

/** Metadata for one section kind (total — every kind has an entry). */
export function sectionMetaFor(kind: SectionKind): SectionMeta {
  return META_BY_KIND[kind];
}

export type DisplayMode = 'interactive' | 'pending';

export interface ReportRow {
  readonly id: string;
  readonly label: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly kinds: readonly SectionKind[];
  readonly mode: DisplayMode;
}

/**
 * The only rows that merge several kinds. Everything not named here becomes a
 * one-kind row derived straight from its {@link SECTION_META} entry.
 *
 * A group carries its own label because the merged row is not either member:
 * "Crew & work by trade" is neither "Crew by trade" nor "Work performed".
 */
const GROUPED_ROWS = [
  {
    id: 'crew_work',
    label: 'Crew & work by trade',
    icon: 'people-outline',
    kinds: ['crew', 'work_performed'],
  },
] as const satisfies readonly {
  readonly id: string;
  readonly label: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly kinds: readonly SectionKind[];
}[];

/**
 * Report-detail rows in PRD §7 display order; crew+work_performed grouped.
 *
 * DERIVED from {@link SECTION_META} rather than hand-maintained. It used to be
 * a second copy of the same labels, icons and order, while this file's header
 * pointed you at `SECTION_META` as "the ONE place" — so renaming a label there
 * changed nothing on screen, and `sectionMeta.test.ts` passed because it only
 * checked `REPORT_ROWS` against `SECTION_KINDS` (#22).
 */
export const REPORT_ROWS: readonly ReportRow[] = (() => {
  const groupByKind = new Map<SectionKind, (typeof GROUPED_ROWS)[number]>();
  for (const group of GROUPED_ROWS) for (const kind of group.kinds) groupByKind.set(kind, group);

  const rows: ReportRow[] = [];
  const emitted = new Set<string>();
  // Walk SECTION_META so display order has exactly one source. A group takes
  // the position of its FIRST member kind.
  for (const meta of SECTION_META) {
    const group = groupByKind.get(meta.kind);
    if (!group) {
      rows.push({
        id: meta.kind,
        label: meta.label,
        icon: meta.icon,
        kinds: [meta.kind],
        mode: 'interactive',
      });
      continue;
    }
    if (emitted.has(group.id)) continue; // later members fold into the emitted row
    emitted.add(group.id);
    rows.push({ ...group, mode: 'interactive' });
  }
  return rows;
})();
