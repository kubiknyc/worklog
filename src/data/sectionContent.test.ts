/**
 * sectionContent — empty shapes for all 11 sections, the relational/JSON-only
 * split, and defensive `rows` extraction for the explode path.
 */
import { SECTION_KINDS } from '../sync/types';
import type { Json } from '../sync/types';
import {
  RELATIONAL_SECTIONS,
  emptyContentFor,
  isRelationalSection,
  rowsOf,
} from './sectionContent';

/** Structural Json check — mirrors the queue's "must survive JSON round-trip". */
const isJsonSafe = (value: Json): boolean => {
  try {
    return JSON.stringify(value) === JSON.stringify(JSON.parse(JSON.stringify(value)));
  } catch {
    return false;
  }
};

describe('emptyContentFor', () => {
  it('returns a Json-safe empty shape for every section kind', () => {
    for (const section of SECTION_KINDS) {
      const empty = emptyContentFor(section);
      expect(isJsonSafe(empty)).toBe(true);
    }
  });

  it('gives relational sections an empty rows array', () => {
    for (const section of RELATIONAL_SECTIONS) {
      expect(emptyContentFor(section)).toEqual({ rows: [] });
    }
  });

  it('gives entry-list sections an empty entries array', () => {
    for (const section of ['deliveries', 'inspections', 'visitors', 'rfis'] as const) {
      expect(emptyContentFor(section)).toEqual({ entries: [] });
    }
  });

  it('gives general_notes empty text and weather the no-override pair', () => {
    expect(emptyContentFor('general_notes')).toEqual({ text: '' });
    expect(emptyContentFor('weather')).toEqual({ condition: null, tempF: null });
  });
});

describe('isRelationalSection', () => {
  it('accepts exactly the five child-table sections', () => {
    expect(SECTION_KINDS.filter(isRelationalSection)).toEqual([
      'crew',
      'work_performed',
      'equipment',
      'safety',
      'delays',
    ]);
  });

  it('rejects JSON-only sections and weather', () => {
    expect(isRelationalSection('general_notes')).toBe(false);
    expect(isRelationalSection('weather')).toBe(false);
    expect(isRelationalSection('deliveries')).toBe(false);
  });
});

describe('rowsOf', () => {
  it('returns the rows array when present', () => {
    const rows: readonly Json[] = [{ id: 'r1', trade: 'Electric', headcount: 4, hours: 8 }];
    expect(rowsOf({ rows })).toEqual(rows);
  });

  it('returns [] for a payload with no rows key', () => {
    expect(rowsOf({ entries: [] })).toEqual([]);
    expect(rowsOf({})).toEqual([]);
  });

  it('returns [] for null and non-object payloads', () => {
    expect(rowsOf(null)).toEqual([]);
    expect(rowsOf('rows')).toEqual([]);
    expect(rowsOf(7)).toEqual([]);
    expect(rowsOf(true)).toEqual([]);
  });

  it('returns [] when rows is not an array (including null and array payloads)', () => {
    expect(rowsOf({ rows: null })).toEqual([]);
    expect(rowsOf({ rows: 'not-an-array' })).toEqual([]);
    expect(rowsOf([{ rows: [] }])).toEqual([]);
  });
});
