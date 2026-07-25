/**
 * Section summaries — the one-line preview each report-detail row shows under
 * its label ("3 trades · 26 on site", "None today", "Tap to add"). Pure and
 * native-free so it is unit-testable without a device and reusable by the PDF
 * renderer later.
 *
 * Input is the opaque section `payload` (sectionContent.ts owns the concrete
 * shapes) plus `isComplete` (the "None today" affirmation flag). Payloads reach
 * here straight off the queue/DB, so every reader defends against missing,
 * null, or malformed content — a bad payload summarizes as empty, never throws.
 *
 * The three states drive the row's tint:
 *  - `filled`  — has entries; `text` describes them.
 *  - `none`    — deliberately empty (isComplete && no entries); a legally
 *                stronger "None today" than a blank (PRD §7 Safety).
 *  - `empty`   — untouched; "Tap to add".
 */
import type { WeatherRow } from '../data/types';
import type { Json, SectionKind } from '../sync/types';

export type SectionState = 'filled' | 'none' | 'empty';

export interface SectionSummary {
  readonly text: string;
  readonly state: SectionState;
}

/** `1 trade` / `3 trades`. */
function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

/** Safe array read of a keyed sub-list (`rows` / `entries`) off an opaque payload. */
function listAt(payload: Json, key: 'rows' | 'entries'): readonly Json[] {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const value = (payload as { readonly [k: string]: Json })[key];
  return Array.isArray(value) ? value : [];
}

/** Safe field read off an opaque row object. */
function fieldOf(row: Json, key: string): Json {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return null;
  return (row as { readonly [k: string]: Json })[key];
}

function numberOf(row: Json, key: string): number {
  const value = fieldOf(row, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function boolOf(row: Json, key: string): boolean {
  return fieldOf(row, key) === true;
}

function textOf(payload: Json, key: string): string {
  const value = fieldOf(payload, key);
  return typeof value === 'string' ? value : '';
}

/** Wrap a resolved list into the empty/none/filled tri-state. */
function fromCount(count: number, isComplete: boolean, describe: () => string): SectionSummary {
  if (count > 0) return { text: describe(), state: 'filled' };
  if (isComplete) return { text: 'None today', state: 'none' };
  return { text: 'Tap to add', state: 'empty' };
}

/**
 * Summarize one non-weather section from its payload + completeness flag.
 * Weather has its own row shape — use {@link summarizeWeather}.
 */
export function summarizeSection(
  kind: Exclude<SectionKind, 'weather'>,
  payload: Json,
  isComplete: boolean,
): SectionSummary {
  switch (kind) {
    case 'crew': {
      const rows = listAt(payload, 'rows');
      const heads = rows.reduce<number>((sum, row) => sum + numberOf(row, 'headcount'), 0);
      return fromCount(
        rows.length,
        isComplete,
        () => `${plural(rows.length, 'trade')} · ${heads} on site`,
      );
    }
    case 'work_performed': {
      const rows = listAt(payload, 'rows');
      return fromCount(rows.length, isComplete, () => plural(rows.length, 'item'));
    }
    case 'safety': {
      const rows = listAt(payload, 'rows');
      const incidents = rows.filter((row) => boolOf(row, 'is_incident')).length;
      return fromCount(rows.length, isComplete, () => {
        const base = plural(rows.length, 'observation');
        return incidents > 0 ? `${base} · ${plural(incidents, 'incident')}` : base;
      });
    }
    case 'delays': {
      const rows = listAt(payload, 'rows');
      const ongoing = rows.filter((row) => boolOf(row, 'is_ongoing')).length;
      return fromCount(rows.length, isComplete, () => {
        const base = plural(rows.length, 'delay');
        return ongoing > 0 ? `${base} · ${ongoing} ongoing` : base;
      });
    }
    case 'equipment': {
      const rows = listAt(payload, 'rows');
      const onSite = rows.filter((row) => boolOf(row, 'on_site')).length;
      return fromCount(onSite, isComplete, () => `${plural(onSite, 'item')} on site`);
    }
    case 'deliveries': {
      const entries = listAt(payload, 'entries');
      return fromCount(entries.length, isComplete, () =>
        plural(entries.length, 'delivery', 'deliveries'),
      );
    }
    case 'inspections': {
      const entries = listAt(payload, 'entries');
      const failed = entries.filter((e) => fieldOf(e, 'result') === 'failed').length;
      return fromCount(entries.length, isComplete, () => {
        const base = plural(entries.length, 'inspection');
        return failed > 0 ? `${base} · ${failed} failed` : base;
      });
    }
    case 'visitors': {
      const entries = listAt(payload, 'entries');
      return fromCount(entries.length, isComplete, () => plural(entries.length, 'visitor'));
    }
    case 'rfis': {
      const entries = listAt(payload, 'entries');
      return fromCount(entries.length, isComplete, () => plural(entries.length, 'item'));
    }
    case 'general_notes': {
      const text = textOf(payload, 'text').trim();
      return fromCount(text.length, isComplete, () =>
        text.length > 48 ? `${text.slice(0, 48).trimEnd()}…` : text,
      );
    }
  }
}

/**
 * Summarize the 1:1 weather row. Prefers the manual override, then the
 * auto-fetched snapshot; a bare condition or temperature alone still counts as
 * filled. `null` (no row yet) reads as empty.
 */
export function summarizeWeather(weather: WeatherRow | null): SectionSummary {
  const condition = weather?.override_condition ?? weather?.auto_condition ?? null;
  const tempF = weather?.override_temp_f ?? weather?.auto_temp_f ?? null;

  const parts: string[] = [];
  if (condition && condition.trim().length > 0) parts.push(condition.trim());
  if (typeof tempF === 'number' && Number.isFinite(tempF)) parts.push(`${Math.round(tempF)}°F`);

  if (parts.length > 0) return { text: parts.join(' · '), state: 'filled' };
  return { text: 'Will fill when online', state: 'empty' };
}
