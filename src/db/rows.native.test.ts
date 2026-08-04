/**
 * `tx()` is the global transaction serializer every device write funnels
 * through, and it was doubly invisible: no test file, and the
 * `!src/**` + `/*.native.ts` exclusion removes it from the coverage
 * denominator, so it did not even appear in the report (#24).
 *
 * The case that matters is the last line of the module. `txQueue` is chained
 * with `turn.catch(() => {})`; writing `txQueue = turn` instead wedges every
 * subsequent write on the device forever, silently — the next call chains off
 * a rejected promise, so its `then` handler never runs and the callback is
 * never invoked. Nothing surfaces; writes simply stop. A rolled-back
 * transaction is an ordinary occurrence, so this is reachable in normal use.
 *
 * The module-level `txQueue` is shared across tests in this file. That is safe
 * only because `tx` never leaves the queue rejected — if a test here ever
 * hangs, that invariant is what broke.
 */
import { all, first, run, tx } from './rows.native';
import type { Db } from './rows.native';

type TxFn = () => Promise<void>;

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let queued microtasks drain so an in-flight turn can advance. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Records every `withTransactionAsync` ENTRY and exit. Entry order is the
 * observable that distinguishes serialized from interleaved — a call count
 * taken after everything settles cannot tell them apart.
 */
function fakeDb() {
  const entered: string[] = [];
  const exited: string[] = [];
  let nextLabel = 0;
  const db = {
    getAllAsync: jest.fn(async (_sql: string, _params?: unknown) => [{ id: 'a' }]),
    getFirstAsync: jest.fn(async (_sql: string, _params?: unknown) => ({ id: 'a' })),
    runAsync: jest.fn(async (_sql: string, _params?: unknown) => ({
      changes: 1,
      lastInsertRowId: 7,
    })),
    withTransactionAsync: jest.fn(async (fn: TxFn) => {
      const label = `t${(nextLabel += 1)}`;
      entered.push(label);
      try {
        await fn();
      } finally {
        exited.push(label);
      }
    }),
  };
  return { db: db as unknown as Db, entered, exited };
}

describe('query wrappers pass SQL and params straight through', () => {
  it('all() forwards sql and params and returns the rows', async () => {
    const { db } = fakeDb();

    await expect(
      all<{ id: string }>(db, 'SELECT * FROM projects WHERE id = ?', ['p1']),
    ).resolves.toEqual([{ id: 'a' }]);
    expect(db.getAllAsync).toHaveBeenCalledWith('SELECT * FROM projects WHERE id = ?', ['p1']);
  });

  it('first() forwards sql and params and returns the row', async () => {
    const { db } = fakeDb();

    await expect(first(db, 'SELECT 1', [])).resolves.toEqual({ id: 'a' });
    expect(db.getFirstAsync).toHaveBeenCalledWith('SELECT 1', []);
  });

  it('run() returns the write result', async () => {
    const { db } = fakeDb();

    await expect(run(db, 'DELETE FROM x WHERE id = ?', ['1'])).resolves.toEqual({
      changes: 1,
      lastInsertRowId: 7,
    });
  });

  it('params default to an empty array rather than undefined', async () => {
    const { db } = fakeDb();

    // expo-sqlite treats a missing params argument differently from `[]`;
    // defaulting here is what lets call sites omit it safely.
    await all(db, 'SELECT 1');
    await first(db, 'SELECT 1');
    await run(db, 'SELECT 1');

    expect(db.getAllAsync).toHaveBeenCalledWith('SELECT 1', []);
    expect(db.getFirstAsync).toHaveBeenCalledWith('SELECT 1', []);
    expect(db.runAsync).toHaveBeenCalledWith('SELECT 1', []);
  });
});

describe('tx serializes transactions', () => {
  it('does not enter the second transaction until the first resolves', async () => {
    const { db, entered } = fakeDb();
    const gate = deferred();

    const firstTx = tx(db, () => gate.promise);
    const secondTx = tx(db, async () => {});
    await flush();

    // The whole point: expo-sqlite's withTransactionAsync is NOT exclusive, so
    // without this queue both would sit inside an open transaction at once and
    // a user write landing mid-pull would be absorbed into the pull's
    // rollback — or fail outright on a nested BEGIN.
    expect(entered).toEqual(['t1']);

    gate.resolve();
    await firstTx;
    await secondTx;

    expect(entered).toEqual(['t1', 't2']);
  });

  it('the first transaction fully exits before the second is entered', async () => {
    const { db, entered, exited } = fakeDb();
    const gate = deferred();

    const firstTx = tx(db, () => gate.promise);
    const secondTx = tx(db, async () => {});
    gate.resolve();
    await firstTx;
    await secondTx;

    expect(entered).toEqual(['t1', 't2']);
    expect(exited).toEqual(['t1', 't2']);
  });

  it('preserves submission order across several transactions', async () => {
    const { db, entered } = fakeDb();

    await Promise.all([tx(db, async () => {}), tx(db, async () => {}), tx(db, async () => {})]);

    expect(entered).toEqual(['t1', 't2', 't3']);
  });
});

describe('tx failure handling', () => {
  it('propagates the rollback error to its own caller', async () => {
    const { db } = fakeDb();

    // The caller must still learn the write failed — the internal `.catch` is
    // for the QUEUE, not for swallowing the error.
    await expect(
      tx(db, async () => Promise.reject(new Error('constraint failed'))),
    ).rejects.toThrow('constraint failed');
  });

  it('a rejected transaction does not wedge the queue', async () => {
    const { db, entered } = fakeDb();

    await expect(tx(db, async () => Promise.reject(new Error('rolled back')))).rejects.toThrow(
      'rolled back',
    );

    const after = jest.fn(async () => {});
    // The device-bricking case. With `txQueue = turn` instead of
    // `turn.catch(() => {})`, this call chains off a rejected promise: its
    // `then` handler never runs, the callback is never invoked, and every
    // subsequent write on the device fails the same way, forever.
    await expect(tx(db, after)).resolves.toBeUndefined();
    expect(after).toHaveBeenCalledTimes(1);
    expect(entered).toEqual(['t1', 't2']);
  });

  it('survives several consecutive failures', async () => {
    const { db } = fakeDb();

    for (const message of ['first', 'second', 'third']) {
      await expect(tx(db, async () => Promise.reject(new Error(message)))).rejects.toThrow(message);
    }

    const after = jest.fn(async () => {});
    await tx(db, after);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('a later transaction still runs when the one ahead of it fails', async () => {
    const { db, entered } = fakeDb();
    const gate = deferred();

    const failing = tx(db, () => gate.promise);
    const following = tx(db, async () => {});

    gate.reject(new Error('rolled back'));
    await expect(failing).rejects.toThrow('rolled back');
    await expect(following).resolves.toBeUndefined();

    // Queued-behind work must not become collateral damage of the failure
    // ahead of it — that is a user's next write, not a retry of the failed one.
    expect(entered).toEqual(['t1', 't2']);
  });
});
