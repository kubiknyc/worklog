import type { SyncState } from './engineApi';
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

function photoPayload(reportId: string, photoId: string): MutationPayload {
  return {
    kind: 'add_photo',
    data: {
      photoId,
      reportId,
      projectId: 'p1',
      storagePath: `p1/${reportId}/${photoId}.jpg`,
      localUri: 'file://x',
      width: 10,
      height: 10,
      capturedAt: null,
      exifDateTimeOriginal: null,
      gpsLat: null,
      gpsLng: null,
      gpsAccuracy: null,
      source: 'camera',
      tradeTag: null,
      locationTag: null,
      caption: null,
    },
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
  const core = createEngineCore({
    store,
    push,
    clearDirty,
    onIncident,
    isOnline,
    deleteLocalReport,
  });
  return { store, clearDirty, onIncident, deleteLocalReport, isOnline, push, core };
}

describe('createEngineCore: run() drain', () => {
  it('removes a successfully-pushed mutation and drains to empty', async () => {
    const m1 = mutation(createReportPayload('r1'));
    const { store, core } = harness([m1], async () => ({ ok: true }));

    await core.run();

    expect(store.rows).toHaveLength(0);
    expect(core.getState()).toMatchObject({
      syncing: false,
      pending: 0,
      parked: 0,
      lastError: null,
    });
  });

  it('drains via orderForDrain: JSON mutations push before photos regardless of queue order', async () => {
    // Queued photo-first, section-second — the drain must still push the
    // section first (orderForDrain moves add_photo to the tail).
    const photo = mutation(photoPayload('r1', 'photo1'));
    const section = mutation(sectionPayload('r1'));
    const { store, push, core } = harness([photo, section], async () => ({ ok: true }));

    await core.run();

    const pushedIds = push.mock.calls.map((c) => c[0]!.clientId);
    expect(pushedIds).toEqual([section.clientId, photo.clientId]);
    expect(store.rows).toHaveLength(0);
  });

  it('publishes the full start-of-cycle and end-of-cycle state shape (syncing flips, counts recount)', async () => {
    const m1 = mutation(createReportPayload('r1'));
    const publishes: SyncState[] = [];
    const { core } = harness([m1], async () => ({ ok: true }));
    core.subscribe((s) => publishes.push(s));

    await core.run();

    expect(publishes).toEqual([
      {
        online: true,
        syncing: true,
        pending: 1,
        parked: 0,
        lastError: null,
        reparents: 0,
        completedPulls: 0,
      },
      {
        online: true,
        syncing: false,
        pending: 0,
        parked: 0,
        lastError: null,
        reparents: 0,
        completedPulls: 0,
      },
    ]);
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
    const { store, push, core, isOnline } = harness([m1, m2], async () => ({
      ok: false,
      error: err,
    }));
    isOnline.mockReturnValue(true);

    await core.run();

    expect(push).toHaveBeenCalledTimes(1); // stopped after the first offline failure
    // store.replace still fires (guarded) — but offline's applyOutcome leaves
    // attempts untouched, so the persisted row is functionally the same.
    expect(store.rows).toHaveLength(2);
    expect(store.rows[0]).toMatchObject({ attempts: 0, status: 'pending' });
    expect(store.rows[1]).toMatchObject({ attempts: 0, status: 'pending' });
    expect(core.getState()).toMatchObject({ online: false, lastError: null, syncing: false });
  });

  it('onIncident fires "evicted" (not "parked") for an RLS-denial failure', async () => {
    const m1 = mutation(sectionPayload('r1'));
    const err = { status: 403 };
    const { store, onIncident, core } = harness([m1], async () => ({ ok: false, error: err }));

    await core.run();

    expect(onIncident).toHaveBeenCalledWith('evicted', m1, err);
    expect(store.rows[0]).toMatchObject({ status: 'parked' });
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

  it("a failure for a report shadows that report's later mutations this cycle", async () => {
    const failingCreate = mutation(createReportPayload('r1'));
    const sameSectionEdit = mutation(sectionPayload('r1'));
    const otherReport = mutation(createReportPayload('r2'));
    const { push, core } = harness([failingCreate, sameSectionEdit, otherReport], async (m) =>
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

  it('is single-flight: a concurrent run() call shares the in-flight cycle, and the trailing cycle recounts a late enqueue', async () => {
    const m1 = mutation(sectionPayload('r1'));
    const store = new FakeStore([m1]);
    let resolvePush!: (o: PushOutcome) => void;
    const pushPromise = new Promise<PushOutcome>((resolve) => {
      resolvePush = resolve;
    });
    const push = jest.fn(async (_m: Mutation): Promise<PushOutcome> => pushPromise);
    const core = createEngineCore({
      store,
      push,
      clearDirty: jest.fn(async () => {}),
      onIncident: jest.fn(),
      isOnline: () => true,
      deleteLocalReport: jest.fn(async () => {}),
    });

    const first = core.run();
    const second = core.run(); // in-flight → coalesced via `dirty`, shares `first`'s promise
    // A fresh mutation lands while the first push is still in flight — the
    // dirty-coalesce contract requires the trailing cycle to pick it up.
    const late = mutation(sectionPayload('r2'));
    await store.enqueue(late);
    resolvePush({ ok: true });
    await Promise.all([first, second]);

    expect(push).toHaveBeenCalledTimes(2); // m1 in cycle 1, `late` in the trailing cycle 2
    expect(push.mock.calls[1]![0]!.clientId).toBe(late.clientId);
    expect(core.getState()).toMatchObject({ pending: 0, parked: 0 });
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

  it('reparent contention check is keyed to the winner, not the loser — a winner-rewritten pending mutation blocks clearDirty', async () => {
    // Both `create` and `submit` target the SAME local row (daily_reports:reportId).
    // The reparent cascade (simulated here, real work is push.native.ts's SQL
    // transaction) rewrites `submit`'s payload to the winner id the moment
    // `create`'s push resolves. If the engine's contention check compares
    // against the LOSER id, it will find nothing else targeting the loser row
    // (submit already moved off it) and wrongly clear _dirty. Keyed to the
    // WINNER, it correctly sees `submit` still owns that row and skips.
    const loserId = 'r1';
    const winnerId = 'r-winner';
    const create = mutation(createReportPayload(loserId));
    const submit = mutation(submitPayload(loserId));
    const store = new FakeStore([create, submit]);
    const clearDirty = jest.fn(async () => {});
    const push = jest.fn(async (m: Mutation): Promise<PushOutcome> => {
      if (m.clientId === create.clientId) {
        const i = store.rows.findIndex((r) => r.clientId === submit.clientId);
        if (i !== -1) {
          store.rows[i] = { ...store.rows[i]!, payload: submitPayload(winnerId) };
        }
        return { ok: true, reparentedTo: winnerId };
      }
      // The follow-up cycle's submit push fails (retryable) — it must never
      // reach the success/clearDirty branch, so any clearDirty call observed
      // can only have come from the (buggy) loser-keyed check on `create`.
      return { ok: false, error: { status: 500 } };
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
    expect(push).toHaveBeenCalledTimes(2); // create (cycle 1), submit (follow-up cycle 2)
    expect(clearDirty).not.toHaveBeenCalled();
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

  it('a store.all() throw at cycle START does not reject and still surfaces via lastError (never-rejects is absolute, not per-mutation)', async () => {
    const m1 = mutation(sectionPayload('r1'));
    const store = new FakeStore([m1]);
    jest.spyOn(store, 'all').mockRejectedValueOnce(new Error('start recount boom'));
    const core = createEngineCore({
      store,
      push: jest.fn(async () => ({ ok: true })),
      clearDirty: jest.fn(async () => {}),
      onIncident: jest.fn(),
      isOnline: () => true,
      deleteLocalReport: jest.fn(async () => {}),
    });

    await expect(core.run()).resolves.toBeUndefined();
    expect(core.getState().lastError).toBe('start recount boom');
  });

  it('a store.all() throw at cycle END does not reject and still surfaces via lastError', async () => {
    const m1 = mutation(sectionPayload('r1'));
    const store = new FakeStore([m1]);
    const originalAll = store.all.bind(store);
    jest
      .spyOn(store, 'all')
      .mockImplementationOnce(originalAll) // cycle-start recount succeeds
      .mockRejectedValueOnce(new Error('end recount boom')); // cycle-end recount throws
    const core = createEngineCore({
      store,
      push: jest.fn(async () => ({ ok: false, error: { status: 500 } })),
      clearDirty: jest.fn(async () => {}),
      onIncident: jest.fn(),
      isOnline: () => true,
      deleteLocalReport: jest.fn(async () => {}),
    });

    await expect(core.run()).resolves.toBeUndefined();
    expect(core.getState().lastError).toBe('end recount boom');
  });

  it('offline never-alarm wins even when the end-of-cycle recount also throws', async () => {
    // Sequence: the drain aborts offline (stoppedOffline=true, thrown=null),
    // then the cycle-end store.all() recount itself throws. The offline
    // never-alarm contract must still publish lastError:null, not the
    // read-failure message.
    const m1 = mutation(sectionPayload('r1'));
    const store = new FakeStore([m1]);
    const originalAll = store.all.bind(store);
    const offlineErr = { name: 'TypeError', message: 'Network request failed' };
    jest
      .spyOn(store, 'all')
      .mockImplementationOnce(originalAll) // cycle-start recount succeeds
      .mockRejectedValueOnce(new Error('end recount boom')); // cycle-end recount throws
    const core = createEngineCore({
      store,
      push: jest.fn(async () => ({ ok: false, error: offlineErr })),
      clearDirty: jest.fn(async () => {}),
      onIncident: jest.fn(),
      isOnline: () => true,
      deleteLocalReport: jest.fn(async () => {}),
    });

    await expect(core.run()).resolves.toBeUndefined();
    expect(core.getState()).toMatchObject({ online: false, lastError: null, syncing: false });
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
    const { store, deleteLocalReport, core } = harness(
      [create, section, otherReport],
      async () => ({
        ok: true,
      }),
    );

    const affected = await core.discardParked(create.clientId);

    expect(affected).toBe(2);
    expect(store.rows.map((r) => r.clientId)).toEqual([otherReport.clientId]);
    expect(deleteLocalReport).toHaveBeenCalledWith('r1');
  });

  it('reports affected>0 even when deleteLocalReport throws after removeMany already succeeded', async () => {
    const create = mutation(createReportPayload('r1'), { status: 'parked' });
    const section = mutation(sectionPayload('r1'));
    const otherReport = mutation(sectionPayload('r2'));
    const { store, deleteLocalReport, onIncident, core } = harness(
      [create, section, otherReport],
      async () => ({ ok: true }),
    );
    const cascadeError = new Error('disk full');
    deleteLocalReport.mockRejectedValueOnce(cascadeError);

    const affected = await core.discardParked(create.clientId);

    // The queue side of the discard is real (removeMany already committed) —
    // this must never collapse to 0 just because the local-subtree delete
    // that runs after it also failed.
    expect(affected).toBe(2);
    expect(store.rows.map((r) => r.clientId)).toEqual([otherReport.clientId]);
    expect(onIncident).toHaveBeenCalledWith('evicted', create, cascadeError);
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

  it('does not reject when store.all() throws — returns 0 and still attempts a recount', async () => {
    const store = new FakeStore([]);
    jest.spyOn(store, 'all').mockRejectedValueOnce(new Error('boom'));
    const core = createEngineCore({
      store,
      push: jest.fn(async () => ({ ok: true })),
      clearDirty: jest.fn(async () => {}),
      onIncident: jest.fn(),
      isOnline: () => true,
      deleteLocalReport: jest.fn(async () => {}),
    });

    await expect(core.discardParked('anything')).resolves.toBe(0);
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

  it('does not reject when store.all() throws — still calls run() so anything already pending drains', async () => {
    const pending = mutation(sectionPayload('r1'));
    const store = new FakeStore([pending]);
    jest.spyOn(store, 'all').mockRejectedValueOnce(new Error('boom'));
    const push = jest.fn(async () => ({ ok: true }) as PushOutcome);
    const core = createEngineCore({
      store,
      push,
      clearDirty: jest.fn(async () => {}),
      onIncident: jest.fn(),
      isOnline: () => true,
      deleteLocalReport: jest.fn(async () => {}),
    });

    await expect(core.retryParked()).resolves.toBeUndefined();
    expect(push).toHaveBeenCalledTimes(1); // run() still executed and drained the pending row
  });
});
