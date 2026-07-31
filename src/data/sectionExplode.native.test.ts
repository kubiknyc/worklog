import {
  asRecord,
  boolInt,
  explodeSection,
  num,
  parseSectionKind,
  rowId,
  str,
  type Db,
} from './sectionExplode.native';
import { SECTION_KINDS } from '../sync/types';

// ── In-memory Db fake ─────────────────────────────────────────────────────────
// Records every runAsync call (sql + params) in order, so tests can assert
// delete-before-insert ordering as well as the resulting row shapes.
type Row = Record<string, unknown>;

function fakeDb(seedDailyReport?: Row) {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const tables: Record<string, Row[]> = {
    report_crew: [],
    report_equipment: [],
    report_work_performed: [],
    report_delays: [],
    report_safety_observations: [],
    daily_reports: seedDailyReport ? [seedDailyReport] : [],
  };

  async function runAsync(sql: string, params: readonly unknown[] = []): Promise<void> {
    calls.push({ sql, params });
    if (/^\s*DELETE FROM (\w+) WHERE report_id/i.test(sql)) {
      const table = (sql.match(/DELETE FROM (\w+)/i) as RegExpMatchArray)[1];
      const [report_id] = params as string[];
      tables[table] = tables[table].filter((r) => r.report_id !== report_id);
    } else if (/INSERT INTO report_crew/i.test(sql)) {
      const [id, report_id, trade, headcount, hours, is_carried_forward] = params as unknown[];
      tables.report_crew.push({ id, report_id, trade, headcount, hours, is_carried_forward });
    } else if (/INSERT INTO report_equipment/i.test(sql)) {
      const [id, report_id, name, status, on_site] = params as unknown[];
      tables.report_equipment.push({ id, report_id, name, status, on_site });
    } else if (/INSERT INTO report_work_performed/i.test(sql)) {
      const [id, report_id, trade, area, note] = params as unknown[];
      tables.report_work_performed.push({ id, report_id, trade, area, note });
    } else if (/INSERT INTO report_delays/i.test(sql)) {
      const [id, report_id, cause, responsible_party, duration_hours, is_ongoing, note] =
        params as unknown[];
      tables.report_delays.push({
        id,
        report_id,
        cause,
        responsible_party,
        duration_hours,
        is_ongoing,
        note,
      });
    } else if (/INSERT INTO report_safety_observations/i.test(sql)) {
      const [id, report_id, obs_type, description, is_incident] = params as unknown[];
      tables.report_safety_observations.push({ id, report_id, obs_type, description, is_incident });
    } else if (/UPDATE daily_reports[\s\S]*has_delay/i.test(sql)) {
      const [reportId] = params as string[];
      const dr = tables.daily_reports.find((r) => r.id === reportId);
      if (dr) dr.has_delay = tables.report_delays.some((r) => r.report_id === reportId) ? 1 : 0;
    } else if (/UPDATE daily_reports[\s\S]*has_incident/i.test(sql)) {
      const [reportId] = params as string[];
      const dr = tables.daily_reports.find((r) => r.id === reportId);
      if (dr)
        dr.has_incident = tables.report_safety_observations.some(
          (r) => r.report_id === reportId && r.is_incident === 1,
        )
          ? 1
          : 0;
    }
  }

  return {
    calls,
    tables,
    getAllAsync: async (): Promise<Row[]> => [],
    getFirstAsync: async (): Promise<Row | null> => null,
    runAsync,
    withTransactionAsync: async (fn: () => Promise<void>): Promise<void> => fn(),
  };
}

describe('explodeSection', () => {
  it('explodes a relational section (crew) into child rows', async () => {
    const db = fakeDb();
    await explodeSection(db as unknown as Db, 'r1', 'crew', {
      rows: [{ id: 'c1', trade: 'Electrician', headcount: 3, hours: 8, is_carried_forward: false }],
    });
    expect(db.tables.report_crew).toEqual([
      {
        id: 'c1',
        report_id: 'r1',
        trade: 'Electrician',
        headcount: 3,
        hours: 8,
        is_carried_forward: 0,
      },
    ]);
  });

  it('recomputes has_delay from the exploded delay rows', async () => {
    const db = fakeDb({ id: 'r1', has_delay: 0 });
    await explodeSection(db as unknown as Db, 'r1', 'delays', {
      rows: [{ id: 'd1', cause: 'Weather', is_ongoing: false }],
    });
    expect(db.tables.daily_reports[0].has_delay).toBe(1);
  });

  it('recomputes has_incident only when an exploded safety row is itself an incident', async () => {
    const db = fakeDb({ id: 'r1', has_incident: 0 });
    await explodeSection(db as unknown as Db, 'r1', 'safety', {
      rows: [{ id: 's1', obs_type: 'incident', is_incident: true }],
    });
    expect(db.tables.daily_reports[0].has_incident).toBe(1);
  });

  it('deletes before inserting (replace, never append)', async () => {
    const db = fakeDb();
    await explodeSection(db as unknown as Db, 'r1', 'equipment', {
      rows: [{ id: 'e1', name: 'Crane', status: 'active', on_site: true }],
    });
    const kinds = db.calls.map((c) => (/^DELETE/i.test(c.sql) ? 'delete' : 'insert'));
    expect(kinds[0]).toBe('delete');
    expect(kinds.slice(1).every((k) => k === 'insert')).toBe(true);
  });

  it('is a no-op for a non-relational section (general_notes)', async () => {
    const db = fakeDb();
    await explodeSection(db as unknown as Db, 'r1', 'general_notes', { text: 'hello' });
    expect(db.calls).toHaveLength(0);
  });

  it('is a no-op for weather (routed to report_weather elsewhere, never exploded)', async () => {
    const db = fakeDb();
    await explodeSection(db as unknown as Db, 'r1', 'weather', { condition: 'Rain', tempF: 55 });
    expect(db.calls).toHaveLength(0);
  });
});

describe('parseSectionKind', () => {
  it('accepts every canonical section kind except weather', () => {
    for (const kind of SECTION_KINDS) {
      if (kind === 'weather') continue;
      expect(parseSectionKind(kind)).toBe(kind);
    }
  });

  it('rejects weather (routes to report_weather, never report_sections)', () => {
    expect(parseSectionKind('weather')).toBeNull();
  });

  it('rejects an unknown section string', () => {
    expect(parseSectionKind('not_a_real_section')).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(parseSectionKind(42)).toBeNull();
    expect(parseSectionKind(null)).toBeNull();
    expect(parseSectionKind(undefined)).toBeNull();
    expect(parseSectionKind({ section: 'crew' })).toBeNull();
  });
});

describe('coercers accept unknown inputs', () => {
  it('asRecord: object passes through, everything else degrades to {}', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord('not-an-object')).toEqual({});
  });

  it('str: string passes through, everything else is null', () => {
    expect(str('hello')).toBe('hello');
    expect(str(42)).toBeNull();
  });

  it('num: number passes through, everything else is null', () => {
    expect(num(42)).toBe(42);
    expect(num('42')).toBeNull();
  });

  it('boolInt: only literal true becomes 1', () => {
    expect(boolInt(true)).toBe(1);
    expect(boolInt('true')).toBe(0);
  });

  it('rowId: uses a present non-empty client id, mints a fresh one otherwise', () => {
    expect(rowId({ id: 'client-id' })).toBe('client-id');
    expect(rowId({ id: '' })).not.toBe('');
    expect(typeof rowId({})).toBe('string');
  });
});
