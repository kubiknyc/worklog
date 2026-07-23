/**
 * Store behaviour against an in-memory Db fake (no real SQLite — jest-expo can't
 * open a device database). The fake emulates only the handful of statements the
 * store issues, including `ON CONFLICT` upsert semantics, which is exactly what
 * the new `enqueueCoalescing` path depends on.
 */
import { createCursorStore, createMutationStore } from './store.native';
import { newMutation } from './mutationQueue';
import type { Mutation, MutationPayload } from './types';

interface Row {
  seq: number;
  client_id: string;
  kind: string;
  payload: string;
  created_at: string;
  attempts: number;
  status: string;
  last_error: string | null;
}

/** Minimal SQLite stand-in: recognizes the store's statements by pattern. */
function fakeDb() {
  const rows: Row[] = [];
  const cursors = new Map<string, string>();
  let seq = 0;

  return {
    rows,
    cursors,
    async runAsync(sql: string, params: readonly unknown[] = []): Promise<void> {
      if (/INSERT OR IGNORE INTO sync_mutations/i.test(sql)) {
        const [client_id, kind, payload, created_at, attempts, status, last_error] =
          params as never[];
        if (rows.some((r) => r.client_id === client_id)) return; // OR IGNORE
        rows.push({
          seq: ++seq,
          client_id,
          kind,
          payload,
          created_at,
          attempts,
          status,
          last_error,
        });
        return;
      }
      if (/INSERT INTO sync_mutations[\s\S]*ON CONFLICT \(client_id\) DO UPDATE/i.test(sql)) {
        const [client_id, kind, payload, created_at, attempts, status, last_error] =
          params as never[];
        const existing = rows.find((r) => r.client_id === client_id);
        if (existing) {
          // DO UPDATE SET payload=excluded, status='pending', attempts=0, last_error=NULL
          existing.payload = payload;
          existing.status = 'pending';
          existing.attempts = 0;
          existing.last_error = null;
          return;
        }
        rows.push({
          seq: ++seq,
          client_id,
          kind,
          payload,
          created_at,
          attempts,
          status,
          last_error,
        });
        return;
      }
      if (
        /UPDATE sync_mutations SET status = 'pending', attempts = 0, last_error = NULL/i.test(sql)
      ) {
        const [client_id] = params as string[];
        const r = rows.find((x) => x.client_id === client_id);
        if (r) {
          r.status = 'pending';
          r.attempts = 0;
          r.last_error = null;
        }
        return;
      }
      if (/UPDATE sync_mutations SET attempts/i.test(sql)) {
        const [attempts, status, last_error, client_id] = params as never[];
        const r = rows.find((x) => x.client_id === client_id);
        if (r) {
          r.attempts = attempts;
          r.status = status;
          r.last_error = last_error;
        }
        return;
      }
      if (/DELETE FROM sync_mutations WHERE client_id/i.test(sql)) {
        const [client_id] = params as string[];
        const i = rows.findIndex((x) => x.client_id === client_id);
        if (i >= 0) rows.splice(i, 1);
        return;
      }
      if (/INSERT INTO sync_cursors/i.test(sql)) {
        const [scope, value] = params as string[];
        cursors.set(scope, value);
        return;
      }
    },
    async getAllAsync<T>(sql: string): Promise<T[]> {
      let out = [...rows];
      if (/status = 'pending'/i.test(sql)) out = out.filter((r) => r.status === 'pending');
      out.sort((a, b) => (/seq DESC/i.test(sql) ? b.seq - a.seq : a.seq - b.seq));
      return out as unknown as T[];
    },
    async getFirstAsync<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
      if (/FROM sync_cursors/i.test(sql)) {
        const [scope] = params as string[];
        const v = cursors.get(scope);
        return v === undefined ? null : ({ value: v } as unknown as T);
      }
      return null;
    },
  };
}

function updateSection(reportId: string, section: string, tag: string): Mutation {
  const payload = {
    kind: 'update_section',
    data: { reportId, section, content: { entries: [tag] }, isComplete: false },
  } as unknown as MutationPayload;
  return newMutation(`${reportId}:${section}`, payload, '2026-07-19T00:00:00.000Z');
}

describe('store.native mutation store', () => {
  it('enqueue is idempotent on clientId (OR IGNORE)', async () => {
    const db = fakeDb();
    const store = createMutationStore(db as never);
    await store.enqueue(updateSection('r1', 'crew', 'a'));
    await store.enqueue(updateSection('r1', 'crew', 'b')); // same clientId → ignored
    expect(db.rows).toHaveLength(1);
    expect(JSON.parse(db.rows[0].payload).data.content.entries).toEqual(['a']);
  });

  it('enqueueCoalescing replaces payload and re-pends, keeping ONE row', async () => {
    const db = fakeDb();
    const store = createMutationStore(db as never);
    // First edit, then it parks (simulate a permanent failure via replace).
    await store.enqueueCoalescing(updateSection('r1', 'crew', 'first'));
    await store.replace({
      ...updateSection('r1', 'crew', 'first'),
      attempts: 5,
      status: 'parked',
      lastError: 'boom',
    });
    // A fresh user edit must supersede the parked mutation.
    await store.enqueueCoalescing(updateSection('r1', 'crew', 'second'));

    expect(db.rows).toHaveLength(1);
    const row = db.rows[0];
    expect(row.status).toBe('pending'); // re-pended
    expect(row.attempts).toBe(0); // fresh retry ceiling
    expect(row.last_error).toBeNull();
    expect(JSON.parse(row.payload).data.content.entries).toEqual(['second']); // latest payload
    expect(row.seq).toBe(1); // original queue position preserved
  });

  it('pending returns only pending rows, oldest-first', async () => {
    const db = fakeDb();
    const store = createMutationStore(db as never);
    await store.enqueue(updateSection('r1', 'crew', 'a'));
    await store.enqueue(updateSection('r1', 'safety', 'b'));
    await store.replace({
      ...updateSection('r1', 'crew', 'a'),
      attempts: 1,
      status: 'parked',
      lastError: 'x',
    });
    const pending = await store.pending();
    expect(pending.map((m) => m.clientId)).toEqual(['r1:safety']);
  });

  it('unpark flips a parked mutation back to pending with a fresh ceiling', async () => {
    const db = fakeDb();
    const store = createMutationStore(db as never);
    await store.enqueue(updateSection('r1', 'crew', 'a'));
    await store.replace({
      ...updateSection('r1', 'crew', 'a'),
      attempts: 5,
      status: 'parked',
      lastError: 'x',
    });
    await store.unpark('r1:crew');
    expect(db.rows[0].status).toBe('pending');
    expect(db.rows[0].attempts).toBe(0);
    expect(db.rows[0].last_error).toBeNull();
  });

  it('remove deletes the row', async () => {
    const db = fakeDb();
    const store = createMutationStore(db as never);
    await store.enqueue(updateSection('r1', 'crew', 'a'));
    await store.remove('r1:crew');
    expect(db.rows).toHaveLength(0);
  });
});

describe('store.native cursor store', () => {
  it('get returns null then the last set value', async () => {
    const db = fakeDb();
    const cursors = createCursorStore(db as never);
    expect(await cursors.get('reports:p1')).toBeNull();
    await cursors.set('reports:p1', '2026-07-19');
    await cursors.set('reports:p1', '2026-07-20'); // upsert
    expect(await cursors.get('reports:p1')).toBe('2026-07-20');
  });
});
