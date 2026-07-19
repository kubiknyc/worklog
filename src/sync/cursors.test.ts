import { nextCursor, overlapFloor, OVERLAP_MS, SCOPES } from './cursors';

describe('SCOPES', () => {
  it('names Tier 1 global reference-data scopes (06-sync-mappings.md §B)', () => {
    expect(SCOPES.projects()).toBe('projects');
    expect(SCOPES.projectMembers()).toBe('project_members');
    expect(SCOPES.profiles()).toBe('profiles');
  });

  it('names Tier 2 per-project report-domain scopes, keyed by projectId', () => {
    const projectId = 'proj-1';
    expect(SCOPES.reports(projectId)).toBe('reports:proj-1');
    expect(SCOPES.sections(projectId)).toBe('report_sections:proj-1');
    expect(SCOPES.amendments(projectId)).toBe('report_amendments:proj-1');
  });

  it('versions the photos scope as report_photos_v1 from day one', () => {
    // Deliberately `_v1`, not `photos`: §B mints a new key on any future
    // pull-semantics change instead of silently misreading a stale cursor
    // under new semantics [R1-2].
    expect(SCOPES.photos('proj-1')).toBe('report_photos_v1:proj-1');
  });
});

describe('nextCursor', () => {
  it('returns the current cursor for an empty batch', () => {
    expect(nextCursor('2026-06-28T10:00:00Z', [])).toBe('2026-06-28T10:00:00Z');
  });

  it('advances to the max timestamp in the batch', () => {
    const result = nextCursor('2026-06-28T10:00:00Z', [
      '2026-06-28T09:00:00Z',
      '2026-06-28T12:00:00Z',
      '2026-06-28T11:00:00Z',
    ]);
    expect(result).toBe('2026-06-28T12:00:00Z');
  });

  it('starts from the batch max when there is no cursor yet', () => {
    expect(nextCursor(null, ['2026-06-28T09:00:00Z', '2026-06-28T08:00:00Z'])).toBe(
      '2026-06-28T09:00:00Z',
    );
  });

  it('ignores null timestamps', () => {
    expect(nextCursor(null, [null, null])).toBeNull();
    expect(nextCursor('2026-06-28T10:00:00Z', [null])).toBe('2026-06-28T10:00:00Z');
  });

  it('never regresses below the current cursor', () => {
    expect(nextCursor('2026-06-28T12:00:00Z', ['2026-06-28T09:00:00Z'])).toBe(
      '2026-06-28T12:00:00Z',
    );
  });

  it('stays monotonic even when a pull re-fetched overlap-window rows below the cursor', () => {
    // Rows inside the overlap window carry timestamps behind the stored cursor;
    // folding them in must not move the cursor backwards.
    const cursor = '2026-06-28T12:00:00Z';
    expect(nextCursor(cursor, [overlapFloor(cursor)!, '2026-06-28T11:59:59Z'])).toBe(cursor);
  });
});

describe('overlapFloor', () => {
  it('is null for a null cursor (first pull has no floor)', () => {
    expect(overlapFloor(null)).toBeNull();
  });

  it('backs the cursor off by OVERLAP_MS (10s)', () => {
    expect(OVERLAP_MS).toBe(10_000);
    expect(overlapFloor('2026-07-02T10:00:10.000Z')).toBe('2026-07-02T10:00:00.000Z');
  });

  it('preserves fractional seconds', () => {
    expect(overlapFloor('2026-07-02T10:00:10.500Z')).toBe('2026-07-02T10:00:00.500Z');
  });

  it('handles timezone offsets, normalizing to UTC', () => {
    // 12:00:10+02:00 is 10:00:10Z; minus 10s → 10:00:00Z.
    expect(overlapFloor('2026-07-02T12:00:10+02:00')).toBe('2026-07-02T10:00:00.000Z');
  });

  it('crosses minute/hour/day boundaries via real date math, not string math', () => {
    expect(overlapFloor('2026-07-03T00:00:05.000Z')).toBe('2026-07-02T23:59:55.000Z');
  });

  it('accepts a custom overlap width', () => {
    expect(overlapFloor('2026-07-02T10:01:00.000Z', 60_000)).toBe('2026-07-02T10:00:00.000Z');
  });

  it('falls back to the exact cursor when it cannot be parsed', () => {
    expect(overlapFloor('not-a-timestamp')).toBe('not-a-timestamp');
  });
});
