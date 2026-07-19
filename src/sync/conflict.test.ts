import { isServerNewer, mergeItem, resolveItem, type MergeableItem } from './conflict';

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
