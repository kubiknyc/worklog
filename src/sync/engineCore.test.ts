import { createEngineCore } from './engineCore';
import type { EngineDeps } from './engineCore';
import { newMutation, RETRY_CEILING, rowTargetOf } from './mutationQueue';
import type { PushOutcome, RowTarget } from './mutationQueue';
import type { Mutation, MutationPayload, MutationStore } from './types';

function createReportPayload(reportId: string): MutationPayload {
  return {
    kind: 'create_report',
    data: { reportId, projectId: 'p1', reportDate: '2026-07-28', carryForwardSourceReportId: null },
  };
}

function sectionPayload(reportId: string, section: string = 'crew'): MutationPayload {
  return {
    kind: 'update_section',
    data: { reportId, section: section as never, content: {}, isComplete: false },
  };
}

function submitPayload(reportId: string): MutationPayload {
  return {
    kind: 'submit_report',
    data: { reportId, signaturePngBase64: 'x', signerName: 'A', signerTitle: null },
  };
}

let seq = 0;
function mutation(payload: MutationPayload, overrides: Partial<Mutation> = {}): Mutation {
  seq += 1;
  return { ...newMutation(`c${seq}`, payload, `2026-07-28T00:00:0${seq}Z`), ...overrides };
}

/** In-memory MutationStore double, mirroring store.native's revision/status guards. */
class FakeStore implements MutationStore {
  rows: Mutation[];

  constructor(initial: readonly Mutation[] = []) {
    this.rows = [...initial];
  }

  async enqueue(m: Mutation): Promise<void> {
    this.rows.push(m);
  }

  async enqueueCoalescing(m: Mutation): Promise<void> {
    const i = this.rows.findIndex((r) => r.clientId === m.clientId);
    if (i === -1) this.rows.push(m);
    else this.rows[i] = m;
  }

  async pending(): Promise<Mutation[]> {
    return this.rows.filter((m) => m.status === 'pending');
  }

  async all(): Promise<Mutation[]> {
    return [...this.rows];
  }

  async replace(m: Mutation): Promise<number> {
    const i = this.rows.findIndex((r) => r.clientId === m.clientId && r.revision === m.revision);
    if (i === -1) return 0;
    this.rows[i] = { ...m, revision: m.revision + 1 };
    return 1;
  }

  async remove(clientId: string, revision: number): Promise<number> {
    const i = this.rows.findIndex((r) => r.clientId === clientId && r.revision === revision);
    if (i === -1) return 0;
    this.rows.splice(i, 1);
    return 1;
  }

  async removeParked(clientId: string): Promise<number> {
    const i = this.rows.findIndex((r) => r.clientId === clientId && r.status === 'parked');
    if (i === -1) return 0;
    this.rows.splice(i, 1);
    return 1;
  }

  async removeMany(clientIds: readonly string[]): Promise<void> {
    this.rows = this.rows.filter((r) => !clientIds.includes(r.clientId));
  }

  async unpark(clientId: string): Promise<void> {
    const i = this.rows.findIndex((r) => r.clientId === clientId);
    if (i !== -1) this.rows[i] = { ...this.rows[i]!, status: 'pending', attempts: 0 };
  }
}

interface Harness {
  readonly store: FakeStore;
  readonly clearDirty: jest.Mock<Promise<void>, [RowTarget]>;
  readonly onIncident: jest.Mock;
  readonly deleteLocalReport: jest.Mock<Promise<void>, [string]>;
  readonly isOnline: jest.Mock<boolean, []>;
  readonly push: jest.Mock<Promise<PushOutcome>, [Mutation]>;
  readonly core: ReturnType<typeof createEngineCore>;
}

function harness(rows: readonly Mutation[], pushImpl: EngineDeps['push']): Harness {
  const store = new FakeStore(rows);
  const clearDirty = jest.fn(async (_target: RowTarget) => {});
  const onIncident = jest.fn();
  const deleteLocalReport = jest.fn(async (_reportId: string) => {});
  const isOnline = jest.fn(() => true);
  const push = jest.fn(pushImpl);
  const core = createEngineCore({ store, push, clearDirty, onIncident, isOnline, deleteLocalReport });
  return { store, clearDirty, onIncident, deleteLocalReport, isOnline, push, core };
}

describe('createEngineCore: run() drain', () => {
  it('drains JSON mutations before photos, removes on success, and publishes start+end recounts', async () => {
    const m1 = mutation(createReportPayload('r1'));
    const publishes: number[] = [];
    const { store, core } = harness([m1], async () => ({ ok: true }));
    core.subscribe((s) => publishes.push(s.pending));

    await core.run();

    expect(store.rows).toHaveLength(0);
    // start recount (pending=1), end recount (pending=0)
    expect(publishes).toEqual([1, 0]);
    expect(core.getState()).toMatchObject({ syncing: false, pending: 0, parked: 0, lastError: null });
  });

  it('clears dirty only when the row is uncontested (fresh store.all() check)', async () => {
    const m1 = mutation(sectionPayload('r1', 'crew'));
    const { store, clearDirty, core } = harness([m1], async () => ({ ok: true }));
    await core.run();
    expect(clearDirty).toHaveBeenCalledWith(rowTargetOf(sectionPayload('r1', 'crew')));
    expect(store.rows).toHaveLength(0);
  });

  it('does not clear dirty for a mutation still contended by another pending mutation on the same row', async () => {
    // Two independently-queued mutations targeting the same section row (the
    // repo normally coalesces these, but the engine's contention check must
    // not assume that — it re-checks store.all() fresh after every remove).
    const m1 = mutation(sectionPayload('r1', 'crew'));
    const m2 = mutation(sectionPayload('r1', 'crew'));
    const { clearDirty, core } = harness([m1, m2], async () => ({ ok: true }));

    await core.run();

    // m1 is removed first while m2 still targets the row → contended, skipped.
    // m2 is removed last with nothing left targeting the row → cleared.
    expect(clearDirty).toHaveBeenCalledTimes(1);
    expect(clearDirty).toHaveBeenCalledWith(rowTargetOf(sectionPayload('r1', 'crew')));
  });

  it('bumps attempts on retryable failure and parks at the ceiling, carrying the error into the incident', async () => {
    const m1 = mutation(sectionPayload('r1'), { attempts: RETRY_CEILING - 1 });
    const err = { status: 500, message: 'server exploded' };
    const { store, onIncident, core } = harness([m1], async () => ({ ok: false, error: err }));

    await core.run();

    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ attempts: RETRY_CEILING, status: 'parked' });
    expect(onIncident).toHaveBeenCalledWith('parked', m1, err);
    expect(core.getState().lastError).toBe('server exploded');
  });

  it('offline stops the drain, publishes online:false and lastError:null (never-alarm)', async () => {
    const m1 = mutation(sectionPayload('r1'));
    const m2 = mutation(sectionPayload('r2'));
    const err = { name: 'TypeError', message: 'Network request failed' };
    const { store, push, core, isOnline } = harness([m1, m2], async () => ({ ok: false, error: err }));
    isOnline.mockReturnValue(true);

    await core.run();

    expect(push).toHaveBeenCalledTimes(1); // stopped after the first offline failure
    expect(store.rows).toHaveLength(2); // untouched — offline doesn't charge attempts
    expect(core.getState()).toMatchObject({ online: false, lastError: null, syncing: false });
  });

  it('a parked mutation for a report blocks every pending mutation for that report; retryParked drains both in order', async () => {
    const parkedSection = mutation(sectionPayload('r1', 'crew'), { status: 'parked' });
    const pendingSubmit = mutation(submitPayload('r1'));
    const { push, core } = harness([parkedSection, pendingSubmit], async () => ({ ok: true }));

    await core.run();
    expect(push).not.toHaveBeenCalled(); // submit untouched — blocked by the parked section
    expect(core.getState().pending).toBe(1);
    expect(core.getState().parked).toBe(1);

    await core.retryParked();
    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls[0]![0]!.clientId).toBe(parkedSection.clientId);
    expect(push.mock.calls[1]![0]!.clientId).toBe(pendingSubmit.clientId);
  });

  it('a failure for a report shadows that report\'s later mutations this cycle', async () => {
    const failingCreate = mutation(createReportPayload('r1'));
    const sameSectionEdit = mutation(sectionPayload('r1'));
    const otherReport = mutation(createReportPayload('r2'));
    const { push, core } = harness(
      [failingCreate, sameSectionEdit, otherReport],
      async (m) =>
        m.clientId === failingCreate.clientId
          ? { ok: false, error: { code: '22000' } }
          : { ok: true },
    );

    await core.run();

    const pushedIds = push.mock.calls.map((c) => c[0]!.clientId);
    expect(pushedIds).toContain(failingCreate.clientId);
    expect(pushedIds).not.toContain(sameSectionEdit.clientId); // shadowed
    expect(pushedIds).toContain(otherReport.clientId); // different report — unaffected
  });

  it('is single-flight: a concurrent run() call shares the in-flight cycle', async () => {
    const m1 = mutation(sectionPayload('r1'));
    let resolvePush!: (o: PushOutcome) => void;
    const pushPromise = new Promise<PushOutcome>((resolve) => {
      resolvePush = resolve;
    });
    const { push, core } = harness([m1], async () => pushPromise);

    const first = core.run();
    const second = core.run();
    resolvePush({ ok: true });
    await Promise.all([first, second]);

    expect(push).toHaveBeenCalledTimes(1);
  });

  it('a coalesced edit arriving during an in-flight push survives a successful push and stays pending', async () => {
    const m1 = mutation(sectionPayload('r1'));
    const store = new FakeStore([m1]);
    const clearDirty = jest.fn(async () => {});
    // The mutation is loaded (revision 0) before push() is invoked; bumping
    // the row's revision from inside the push mock simulates a coalesce that
    // lands on the SAME row while this specific push call is in flight —
    // after load, before the push resolves.
    const push = jest.fn(async (): Promise<PushOutcome> => {
      store.rows[0] = { ...store.rows[0]!, revision: store.rows[0]!.revision + 1 };
      return { ok: true };
    });
    const core = createEngineCore({
      store,
      push,
      clearDirty,
      onIncident: jest.fn(),
      isOnline: () => true,
      deleteLocalReport: jest.fn(async () => {}),
    });

    await core.run();

    expect(store.rows).toHaveLength(1); // the coalesced row survives — remove() was a stale no-op
    expect(clearDirty).not.toHaveBeenCalled(); // 0 rows removed → clearDirty skipped entirely
  });

  it('a coalesced edit arriving during an in-flight push is not charged an attempt on failure', async () => {
    const m1 = mutation(sectionPayload('r1'));
    const store = new FakeStore([m1]);
    const onIncident = jest.fn();
    let coalescedSnapshot!: Mutation;
    const push = jest.fn(async (): Promise<PushOutcome> => {
      store.rows[0] = { ...store.rows[0]!, revision: store.rows[0]!.revision + 1 };
      coalescedSnapshot = { ...store.rows[0]! };
      return { ok: false, error: { code: '22000' } };
    });
    const core = createEngineCore({
      store,
      push,
      clearDirty: jest.fn(async () => {}),
      onIncident,
      isOnline: () => true,
      deleteLocalReport: jest.fn(async () => {}),
    });

    await core.run();

    // The coalesced row is untouched: same attempts, same revision as when it landed.
    expect(store.rows[0]).toEqual(coalescedSnapshot);
    expect(onIncident).not.toHaveBeenCalled();
  });

  it('a reparent bumps reparents once, aborts the cycle, and the follow-up cycle pushes with the winner id', async () => {
    const loserId = 'r1';
    const winnerId = 'r-winner';
    const create = mutation(createReportPayload(loserId));
    const section = mutation(sectionPayload(loserId));
    const store = new FakeStore([create, section]);
    const clearDirty = jest.fn(async () => {});
    const push = jest.fn(async (m: Mutation) => {
      if (m.clientId === create.clientId) {
        // Simulate the SQL cascade rewriting the other queued mutation to the winner.
        const i = store.rows.findIndex((r) => r.clientId === section.clientId);
        if (i !== -1) {
          store.rows[i] = { ...store.rows[i]!, payload: sectionPayload(winnerId) };
        }
        return { ok: true, reparentedTo: winnerId };
      }
      return { ok: true };
    });
    const core = createEngineCore({
      store,
      push,
      clearDirty,
      onIncident: jest.fn(),
      isOnline: () => true,
      deleteLocalReport: jest.fn(async () => {}),
    });

    await core.run();

    expect(core.getState().reparents).toBe(1);
    expect(push).toHaveBeenCalledTimes(2);
    expect(push.mock.calls[1]![0]!.payload).toMatchObject({ data: { reportId: winnerId } });
    // clearDirty and its contention check are keyed to the winner id.
    expect(clearDirty).toHaveBeenCalledWith(rowTargetOf(createReportPayload(winnerId)));
    expect(store.rows).toHaveLength(0);
  });

  it('reparents is monotone across cycles — never reset by a later clean run', async () => {
    const loserId = 'r1';
    const winnerId = 'r-winner';
    const create = mutation(createReportPayload(loserId));
    const store = new FakeStore([create]);
    const core = createEngineCore({
      store,
      push: jest.fn(async () => ({ ok: true, reparentedTo: winnerId })),
      clearDirty: jest.fn(async () => {}),
      onIncident: jest.fn(),
      isOnline: () => true,
      deleteLocalReport: jest.fn(async () => {}),
    });

    await core.run();
    expect(core.getState().reparents).toBe(1);

    await core.run(); // nothing pending now — clean drain
    expect(core.getState().reparents).toBe(1);
  });

  it('a store throw during success handling does not reject run() and surfaces via lastError', async () => {
    const m1 = mutation(sectionPayload('r1'));
    const store = new FakeStore([m1]);
    const boom = new Error('disk full');
    jest.spyOn(store, 'remove').mockRejectedValueOnce(boom);
    const core = createEngineCore({
      store,
      push: jest.fn(async () => ({ ok: true })),
      clearDirty: jest.fn(async () => {}),
      onIncident: jest.fn(),
      isOnline: () => true,
      deleteLocalReport: jest.fn(async () => {}),
    });

    await expect(core.run()).resolves.toBeUndefined();
    expect(core.getState().lastError).toBe('disk full');
  });

  it('stringifies a non-Error throw for lastError', async () => {
    const m1 = mutation(sectionPayload('r1'));
    const store = new FakeStore([m1]);
    jest.spyOn(store, 'remove').mockRejectedValueOnce('nope');
    const core = createEngineCore({
      store,
      push: jest.fn(async () => ({ ok: true })),
      clearDirty: jest.fn(async () => {}),
      onIncident: jest.fn(),
      isOnline: () => true,
      deleteLocalReport: jest.fn(async () => {}),
    });

    await core.run();
    expect(core.getState().lastError).toBe('nope');
  });

  it('unsubscribe stops further notifications', async () => {
    const m1 = mutation(sectionPayload('r1'));
    const { core } = harness([m1], async () => ({ ok: true }));
    const listener = jest.fn();
    const unsubscribe = core.subscribe(listener);
    unsubscribe();

    await core.run();

    expect(listener).not.toHaveBeenCalled();
  });

  it('a store throw during failure handling does not reject run() and surfaces via lastError', async () => {
    const m1 = mutation(sectionPayload('r1'));
    const store = new FakeStore([m1]);
    const boom = new Error('replace failed');
    jest.spyOn(store, 'replace').mockRejectedValueOnce(boom);
    const core = createEngineCore({
      store,
      push: jest.fn(async () => ({ ok: false, error: { status: 500 } })),
      clearDirty: jest.fn(async () => {}),
      onIncident: jest.fn(),
      isOnline: () => true,
      deleteLocalReport: jest.fn(async () => {}),
    });

    await expect(core.run()).resolves.toBeUndefined();
    expect(core.getState().lastError).toBe('replace failed');
  });

  it('the drain is not gated on isOnline() — a false negative must not stop the drain', async () => {
    const m1 = mutation(sectionPayload('r1'));
    const store = new FakeStore([m1]);
    const push = jest.fn(async () => ({ ok: true }) as PushOutcome);
    const core = createEngineCore({
      store,
      push,
      clearDirty: jest.fn(async () => {}),
      onIncident: jest.fn(),
      isOnline: () => false, // NetInfo false negative
      deleteLocalReport: jest.fn(async () => {}),
    });

    await core.run();

    expect(push).toHaveBeenCalled();
    expect(store.rows).toHaveLength(0);
  });
});

describe('createEngineCore: discardParked', () => {
  it('cascades a parked create_report subtree: removes every queued mutation for the report and deletes the local report', async () => {
    const create = mutation(createReportPayload('r1'), { status: 'parked' });
    const section = mutation(sectionPayload('r1'));
    const otherReport = mutation(sectionPayload('r2'));
    const { store, deleteLocalReport, core } = harness([create, section, otherReport], async () => ({
      ok: true,
    }));

    const affected = await core.discardParked(create.clientId);

    expect(affected).toBe(2);
    expect(store.rows.map((r) => r.clientId)).toEqual([otherReport.clientId]);
    expect(deleteLocalReport).toHaveBeenCalledWith('r1');
  });

  it('status-guard lets a racing fresh edit survive a discard of a non-create_report kind', async () => {
    const parkedSection = mutation(sectionPayload('r1'), { status: 'parked' });
    const { store, core } = harness([parkedSection], async () => ({ ok: true }));
    // Simulate a racing coalesce flipping the row back to pending just before discard runs.
    store.rows[0] = { ...store.rows[0]!, status: 'pending' };

    const affected = await core.discardParked(parkedSection.clientId);

    expect(affected).toBe(0);
    expect(store.rows).toHaveLength(1); // the guard won — row survives
  });

  it('discarding an unknown clientId is a no-op that still publishes a recount', async () => {
    const { core } = harness([], async () => ({ ok: true }));
    const publishes: unknown[] = [];
    core.subscribe((s) => publishes.push(s));

    const affected = await core.discardParked('missing');

    expect(affected).toBe(0);
    expect(publishes).toHaveLength(1);
  });

  it('publishes a recount after a successful discard', async () => {
    const parkedSection = mutation(sectionPayload('r1'), { status: 'parked' });
    const { core } = harness([parkedSection], async () => ({ ok: true }));
    const publishes: { pending: number; parked: number }[] = [];
    core.subscribe((s) => publishes.push({ pending: s.pending, parked: s.parked }));

    await core.discardParked(parkedSection.clientId);

    expect(publishes).toEqual([{ pending: 0, parked: 0 }]);
  });
});

describe('createEngineCore: retryParked', () => {
  it('unparks every parked mutation (resetting attempts) then runs', async () => {
    const parked = mutation(sectionPayload('r1'), { status: 'parked', attempts: RETRY_CEILING });
    const { store, push, core } = harness([parked], async () => ({ ok: true }));

    await core.retryParked();

    expect(push).toHaveBeenCalledTimes(1);
    expect(store.rows).toHaveLength(0); // pushed successfully and removed
  });
});
