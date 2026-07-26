/**
 * Static pick lists for the section-input sheets (PRD §7). These are the
 * standard/company-agnostic defaults; project- and company-level customisation
 * (extra trades, presets) layers on top in a later milestone.
 *
 * Convention: a plain `readonly string[]` when the display label is the value
 * itself; a `readonly ChipOption[]` ({ value, label }) when the stored value
 * differs from what the user reads (slug/code vs. sentence). Option arrays drop
 * straight into <ChipRow options={...} />.
 */
import type { ChipOption } from '../ChipRow';

/**
 * Standard trades. Ported verbatim from PunchLog's CreateItemSheet.tsx `TRADES`
 * (src/components/CreateItemSheet.tsx) so the two apps share one baseline list.
 * Label === value, so this stays a plain string array.
 */
export const TRADES: readonly string[] = [
  'Electrical',
  'Plumbing',
  'Drywall',
  'Tile',
  'Paint',
  'HVAC',
  'Framing',
  'Flooring',
  'Glazing',
  'Masonry',
] as const;

/** Delivery quantity units (PRD §7 Deliveries: loads/pallets/pcs/CY). */
export const DELIVERY_UNITS: readonly ChipOption[] = [
  { value: 'loads', label: 'Loads' },
  { value: 'pallets', label: 'Pallets' },
  { value: 'pcs', label: 'Pieces' },
  { value: 'CY', label: 'CY' },
] as const;

/** Delay / impact causes (PRD §7 Delays & impacts). */
export const DELAY_CAUSES: readonly ChipOption[] = [
  { value: 'weather', label: 'Weather' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'material_delivery', label: 'Material delivery' },
  { value: 'trade_coordination', label: 'Trade coordination' },
  { value: 'owner_design_change', label: 'Owner / design change' },
  { value: 'other', label: 'Other' },
] as const;

/** Visitor roles (PRD §7 Visitors: owner/architect/engineer/inspector/other). */
export const VISITOR_ROLES: readonly ChipOption[] = [
  { value: 'owner', label: 'Owner' },
  { value: 'architect', label: 'Architect' },
  { value: 'engineer', label: 'Engineer' },
  { value: 'inspector', label: 'Inspector' },
  { value: 'other', label: 'Other' },
] as const;

/** Inspection agencies (PRD §7 Inspections: DOB/FDNY/utility/third-party). */
export const INSPECTION_AGENCIES: readonly ChipOption[] = [
  { value: 'DOB', label: 'DOB' },
  { value: 'FDNY', label: 'FDNY' },
  { value: 'utility', label: 'Utility' },
  { value: 'third_party', label: 'Third-party' },
] as const;

/** Safety observation / incident types (PRD §7 Safety). */
export const SAFETY_TYPES: readonly ChipOption[] = [
  { value: 'near_miss', label: 'Near miss' },
  { value: 'first_aid', label: 'First aid' },
  { value: 'recordable', label: 'Recordable' },
  { value: 'observation', label: 'Observation' },
] as const;

/** Inspection results — the three big chips (PRD §7 Inspections). */
export const INSPECTION_RESULTS: readonly ChipOption[] = [
  { value: 'passed', label: 'Passed' },
  { value: 'failed', label: 'Failed' },
  { value: 'partial', label: 'Partial' },
] as const;

/** Equipment on-site status (PRD §7 Equipment: idle/active). */
export const EQUIPMENT_STATUS: readonly ChipOption[] = [
  { value: 'active', label: 'Active' },
  { value: 'idle', label: 'Idle' },
] as const;

/** Weather condition chips for the manual override (PRD §7 Weather). */
export const WEATHER_CONDITIONS: readonly ChipOption[] = [
  { value: 'clear', label: 'Clear' },
  { value: 'cloudy', label: 'Cloudy' },
  { value: 'rain', label: 'Rain' },
  { value: 'snow', label: 'Snow' },
  { value: 'windy', label: 'Windy' },
  { value: 'fog', label: 'Fog' },
] as const;
