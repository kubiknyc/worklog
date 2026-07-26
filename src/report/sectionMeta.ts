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
 * `collapsesWhenEmpty` mirrors PRD §7's "Collapses?" column: a section that
 * collapses shows the muted "None today — tap to add" affordance when empty;
 * one that never collapses (Weather, Crew, Work performed, Safety) always
 * shows its full row so the super can't miss it.
 */
import { Ionicons } from '@expo/vector-icons';

import type { SectionKind } from '../sync/types';

export interface SectionMeta {
  readonly kind: SectionKind;
  /** Row label (PRD §7 section names). */
  readonly label: string;
  /** Leading glyph on the report-detail row. */
  readonly icon: keyof typeof Ionicons.glyphMap;
  /** PRD §7 "Collapses?" — drives the empty-state copy, not visibility. */
  readonly collapsesWhenEmpty: boolean;
}

/**
 * The 11 sections in PRD §7 display order. Every {@link SectionKind} appears
 * exactly once; the exhaustiveness is guarded by the type of `SECTION_META`
 * plus {@link sectionMetaFor}'s total lookup.
 */
export const SECTION_META: readonly SectionMeta[] = [
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
] as const;

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

/** Report-detail rows in PRD §7 display order; crew+work_performed grouped. */
export const REPORT_ROWS: readonly ReportRow[] = [
  {
    id: 'weather',
    label: 'Weather',
    icon: 'partly-sunny-outline',
    kinds: ['weather'],
    mode: 'interactive',
  },
  {
    id: 'crew_work',
    label: 'Crew & work by trade',
    icon: 'people-outline',
    kinds: ['crew', 'work_performed'],
    mode: 'interactive',
  },
  {
    id: 'deliveries',
    label: 'Deliveries',
    icon: 'cube-outline',
    kinds: ['deliveries'],
    mode: 'interactive',
  },
  {
    id: 'equipment',
    label: 'Equipment',
    icon: 'build-outline',
    kinds: ['equipment'],
    mode: 'interactive',
  },
  {
    id: 'inspections',
    label: 'Inspections',
    icon: 'clipboard-outline',
    kinds: ['inspections'],
    mode: 'interactive',
  },
  {
    id: 'safety',
    label: 'Safety',
    icon: 'shield-checkmark-outline',
    kinds: ['safety'],
    mode: 'interactive',
  },
  {
    id: 'delays',
    label: 'Delays & impacts',
    icon: 'time-outline',
    kinds: ['delays'],
    mode: 'interactive',
  },
  {
    id: 'visitors',
    label: 'Visitors',
    icon: 'walk-outline',
    kinds: ['visitors'],
    mode: 'interactive',
  },
  {
    id: 'rfis',
    label: 'RFIs / issues',
    icon: 'help-circle-outline',
    kinds: ['rfis'],
    mode: 'interactive',
  },
  {
    id: 'general_notes',
    label: 'General notes',
    icon: 'document-text-outline',
    kinds: ['general_notes'],
    mode: 'interactive',
  },
] as const;
