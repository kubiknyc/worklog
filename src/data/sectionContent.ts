/**
 * Per-section content shapes — the ONE place the section editor sheets and
 * the native SQLite explode agree on what `report_sections.payload` holds.
 *
 * The canonical contract is the backend's `worklog_apply_section`
 * (jobsight-backend migration 20260717000007): for the five RELATIONAL
 * sections the server re-explodes child rows from `payload->'rows'`, reading
 * exactly the field names below (snake_case, matching the child-table
 * columns); row `id`s are client uuids (blank → server-minted). The local
 * SQLite child tables (db/schema.ts) mirror the same columns, so one shape
 * drives both the server explode and the on-device one.
 *
 * Everything here is a `type` alias, not an interface, deliberately: the
 * queue stores content opaquely as `Json` (sync/types.ts), and interfaces
 * don't structurally satisfy Json's index-signature object arm — aliases do.
 * JSON-only sections (no child tables) get their shapes from PRD §7's
 * section-entry patterns; the server stores those payloads verbatim.
 */
import type { Json, SectionKind } from '../sync/types';

export type { WeatherOverrideContent } from '../sync/types';

// ── Relational row shapes (field names = worklog_apply_section / DDL) ──────

/** One `report_crew` row: a trade with headcount + hours steppers (PRD §7). */
export type CrewRowContent = {
  readonly id: string;
  readonly trade: string;
  readonly headcount: number;
  readonly hours: number;
  /** Seeded by carry-forward and tinted "from yesterday" until touched. */
  readonly is_carried_forward: boolean;
};

/** One `report_equipment` row: on-site toggle + optional idle/active status. */
export type EquipmentRowContent = {
  readonly id: string;
  readonly name: string;
  /** 'active' | 'idle' server default 'active' — kept open for admin presets. */
  readonly status: string;
  readonly on_site: boolean;
};

/** One `report_work_performed` row: trade chip + area chip + dictated line. */
export type WorkPerformedRowContent = {
  readonly id: string;
  readonly trade: string;
  readonly area: string;
  readonly note: string;
};

/** One `report_delays` row: cause chip + party + duration or "ongoing". */
export type DelayRowContent = {
  readonly id: string;
  readonly cause: string;
  readonly responsible_party: string | null;
  /** 0.5-day steps in the UI; null while the delay is marked ongoing. */
  readonly duration_hours: number | null;
  readonly is_ongoing: boolean;
  readonly note: string | null;
};

/** One `report_safety_observations` row; `is_incident` feeds has_incident. */
export type SafetyRowContent = {
  readonly id: string;
  readonly obs_type: string;
  readonly description: string | null;
  readonly is_incident: boolean;
};

// ── Section content: relational sections carry full-replacement `rows` ─────

export type CrewContent = { readonly rows: readonly CrewRowContent[] };
export type EquipmentContent = { readonly rows: readonly EquipmentRowContent[] };
export type WorkPerformedContent = { readonly rows: readonly WorkPerformedRowContent[] };
export type DelaysContent = { readonly rows: readonly DelayRowContent[] };
export type SafetyContent = { readonly rows: readonly SafetyRowContent[] };

// ── JSON-only sections (payload stored verbatim; shapes from PRD §7) ───────

export type DeliveryEntry = {
  readonly id: string;
  readonly supplier: string;
  readonly material: string;
  /** Quantity stepper + unit chips (loads / pallets / pcs / CY). */
  readonly quantity: number;
  readonly unit: string;
};
export type DeliveriesContent = { readonly entries: readonly DeliveryEntry[] };

export type InspectionEntry = {
  readonly id: string;
  /** Agency chips — DOB, FDNY, utility, third-party; recents pinned. */
  readonly agency: string;
  readonly inspector: string | null;
  /** The three big result chips. */
  readonly result: 'passed' | 'failed' | 'partial';
  readonly note: string | null;
};
export type InspectionsContent = { readonly entries: readonly InspectionEntry[] };

export type VisitorEntry = {
  readonly id: string;
  readonly name: string;
  /** Role chips: owner / architect / engineer / inspector / other. */
  readonly role: string;
  /** 15-min picker, `HH:MM` project-local; null when not recorded. */
  readonly time: string | null;
};
export type VisitorsContent = { readonly entries: readonly VisitorEntry[] };

export type RfiEntry = {
  readonly id: string;
  /** One-line title — "Questions and issues raised today", a log not a manager. */
  readonly title: string;
  readonly trade: string | null;
  readonly needs_answer_from: string | null;
};
export type RfisContent = { readonly entries: readonly RfiEntry[] };

/** Full-width dictated/typed notes; no formatting. */
export type GeneralNotesContent = { readonly text: string };

// ── Relational-section discrimination ──────────────────────────────────────

/**
 * The five sections whose payloads the server (and the local SQLite layer)
 * explode into child rows; every other section's payload is stored verbatim.
 */
export const RELATIONAL_SECTIONS = [
  'crew',
  'equipment',
  'work_performed',
  'delays',
  'safety',
] as const;

export type RelationalSection = (typeof RELATIONAL_SECTIONS)[number];

export function isRelationalSection(section: SectionKind): section is RelationalSection {
  return (RELATIONAL_SECTIONS as readonly SectionKind[]).includes(section);
}

// ── Empty shapes + safe row extraction ─────────────────────────────────────

/**
 * The empty content for a section — what a fresh (or "None today") section
 * row holds, and the seed the editor sheets open with. Weather's empty is
 * the no-override pair (sync/types.ts `WeatherOverrideContent`).
 */
export function emptyContentFor(section: SectionKind): Json {
  switch (section) {
    case 'crew':
    case 'equipment':
    case 'work_performed':
    case 'delays':
    case 'safety':
      return { rows: [] };
    case 'deliveries':
    case 'inspections':
    case 'visitors':
    case 'rfis':
      return { entries: [] };
    case 'general_notes':
      return { text: '' };
    case 'weather':
      return { condition: null, tempF: null };
  }
}

/**
 * Safe extraction of a relational payload's `rows`. Queue payloads are
 * opaque `Json` by design, so anything reaching the explode path could be
 * missing, null, or malformed — treat all of those as "no rows" rather
 * than crashing the sync drain.
 */
export function rowsOf(payload: Json): readonly Json[] {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const rows = (payload as { readonly [key: string]: Json }).rows;
  return Array.isArray(rows) ? rows : [];
}
