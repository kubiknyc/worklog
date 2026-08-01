import {
  isServerNewer,
  mergeItem,
  resolveItem,
  resolveReport,
  type MergeableItem,
  type ReportLike,
} from './conflict';

/** Stand-in for a generic synced row (e.g. a `report_sections` row keyed by
 * the Task 4 composite id `${reportId}:${section}`) — content is opaque to
 * conflict.ts, which only ever looks at `updated_at`. */
interface TestRow extends MergeableItem {
  readonly content: string;
}

const local: TestRow = {
  updated_at: '2026-06-28T10:00:00Z',
  content: 'local content',
};
const server: TestRow = {
  updated_at: '2026-06-28T09:00:00Z',
  content: 'server content',
};

describe('isServerNewer', () => {
  it('server wins on a strictly newer timestamp', () => {
    expect(isServerNewer('2026-06-28T09:00:00Z', '2026-06-28T10:00:00Z')).toBe(true);
  });
  it('server wins on a tie', () => {
    expect(isServerNewer('2026-06-28T10:00:00Z', '2026-06-28T10:00:00Z')).toBe(true);
  });
  it('local wins when strictly newer', () => {
    expect(isServerNewer('2026-06-28T10:00:00Z', '2026-06-28T09:00:00Z')).toBe(false);
  });
  it('server wins when local has no timestamp', () => {
    expect(isServerNewer(null, '2026-06-28T09:00:00Z')).toBe(true);
  });
  it('local wins when server has no timestamp', () => {
    expect(isServerNewer('2026-06-28T10:00:00Z', null)).toBe(false);
  });
});

describe('mergeItem', () => {
  it('takes the server row verbatim when local is not dirty', () => {
    expect(mergeItem(local, server, false)).toBe(server);
  });

  it('takes the server row when it is newer, even if local is dirty', () => {
    const newerServer = { ...server, updated_at: '2026-06-28T11:00:00Z' };
    expect(mergeItem(local, newerServer, true)).toBe(newerServer);
  });

  it('keeps the local row verbatim when it is dirty and newer', () => {
    const merged = mergeItem(local, server, true);
    expect(merged).toBe(local);
    expect(merged.content).toBe('local content');
  });
});

describe('resolveItem (H2 — dirty flag must clear when the server wins)', () => {
  it('takes the server row and clears dirty when local is not dirty', () => {
    const r = resolveItem(local, server, false);
    expect(r.item).toBe(server);
    expect(r.dirty).toBe(0);
  });

  it('clears dirty when the server wins the merge (server newer/tie)', () => {
    // server.updated_at <= local.updated_at would let local win, so use a tie:
    // offline writes never bump updated_at, so this is the dominant real case.
    const tie = { ...server, updated_at: local.updated_at };
    const r = resolveItem(local, tie, true);
    expect(r.item).toBe(tie); // server-side row wins the tie
    expect(r.dirty).toBe(0); // the bug: previously stayed 1 forever
  });

  it('keeps dirty when the local row genuinely survives LWW', () => {
    const r = resolveItem(local, server, true); // local strictly newer
    expect(r.item).toBe(local);
    expect(r.dirty).toBe(1);
  });

  it('clears dirty when there is no local row at all', () => {
    const r = resolveItem(null, server, true);
    expect(r.item).toBe(server);
    expect(r.dirty).toBe(0);
  });
});

/** Stand-in for `daily_reports` — deliberately carries a timestamp-shaped field
 * so tests can prove `resolveReport` ignores it (unlike `resolveItem`'s LWW). */
interface TestReport extends ReportLike {
  readonly updated_at: string;
  readonly content: string;
}

describe('resolveReport (absolute dirty shield — status is server-governed)', () => {
  const localReport: TestReport = {
    status: 'draft',
    updated_at: '2026-06-28T10:00:00Z',
    content: 'local content',
  };
  const serverNewer: TestReport = {
    status: 'submitted',
    updated_at: '2026-06-28T11:00:00Z',
    content: 'server content',
  };
  const serverOlder: TestReport = {
    status: 'submitted',
    updated_at: '2026-06-28T09:00:00Z',
    content: 'server content',
  };

  it('takes the server row and clears dirty when there is no local row', () => {
    const r = resolveReport(null, serverNewer, true);
    expect(r.item).toBe(serverNewer);
    expect(r.dirty).toBe(0);
  });

  it('takes the server row verbatim and clears dirty when local is clean, server newer', () => {
    const r = resolveReport(localReport, serverNewer, false);
    expect(r.item).toBe(serverNewer);
    expect(r.dirty).toBe(0);
  });

  it('takes the server row verbatim and clears dirty when local is clean, server older', () => {
    // Timestamps must not matter for clean rows: an offline device's local
    // updated_at is meaningless, so even an "older" server row wins verbatim.
    const r = resolveReport(localReport, serverOlder, false);
    expect(r.item).toBe(serverOlder);
    expect(r.dirty).toBe(0);
  });

  it('shields local content but adopts server status when dirty, server newer', () => {
    const r = resolveReport(localReport, serverNewer, true);
    expect(r.dirty).toBe(1);
    expect(r.item).toEqual({
      status: 'submitted',
      updated_at: '2026-06-28T10:00:00Z',
      content: 'local content',
    });
  });

  it('shields local content but adopts server status when dirty, server older', () => {
    // Again: timestamp ordering must not matter for the dirty-shield branch.
    const r = resolveReport(localReport, serverOlder, true);
    expect(r.dirty).toBe(1);
    expect(r.item).toEqual({
      status: 'submitted',
      updated_at: '2026-06-28T10:00:00Z',
      content: 'local content',
    });
  });

  it('adopts server status even when local and server statuses already match, dirty', () => {
    const sameStatusServer: TestReport = { ...serverNewer, status: localReport.status };
    const r = resolveReport(localReport, sameStatusServer, true);
    expect(r.dirty).toBe(1);
    expect(r.item).toEqual({
      status: 'draft',
      updated_at: '2026-06-28T10:00:00Z',
      content: 'local content',
    });
  });

  it('lifecycleHeld keeps the optimistic local status on a clean row (server content still adopted)', () => {
    const local = { status: 'submitted', note: 'local' };
    const server = { status: 'draft', note: 'server' };
    expect(resolveReport(local, server, false, true)).toEqual({
      item: { status: 'submitted', note: 'server' },
      dirty: 0,
    });
  });

  it('lifecycleHeld keeps the optimistic local status on a dirty row (local content already shielded)', () => {
    const local = { status: 'submitted', note: 'local' };
    const server = { status: 'draft', note: 'server' };
    expect(resolveReport(local, server, true, true)).toEqual({
      item: { status: 'submitted', note: 'local' },
      dirty: 1,
    });
  });

  it('lifecycleHeld with no local row is a plain server adoption', () => {
    const server = { status: 'draft' };
    expect(resolveReport(null, server, false, true)).toEqual({ item: server, dirty: 0 });
  });

  it('defaulted lifecycleHeld leaves the existing contract untouched', () => {
    const local = { status: 'draft', note: 'local' };
    const server = { status: 'submitted', note: 'server' };
    expect(resolveReport(local, server, true)).toEqual({
      item: { status: 'submitted', note: 'local' },
      dirty: 1,
    });
  });
});
