/**
 * createPusher against a mocked RpcRunner and a mocked reparentReport — no real
 * Supabase client or SQLite database (reparentReport's own transaction is
 * exercised in reparent.native.test.ts).
 */
import { createPusher } from './push.native';
import type { RpcRunner } from './push.native';
import { newMutation } from './mutationQueue';
import { reparentReport } from './reparent.native';
import type { Db } from '../db/rows.native';
import type { Mutation } from './types';

jest.mock('./reparent.native', () => ({
  reparentReport: jest.fn(),
}));

const mockReparentReport = reparentReport as jest.MockedFunction<typeof reparentReport>;

const FAKE_DB = {} as Db;

function updateSectionMutation(): Mutation {
  return newMutation(
    'report-1:crew',
    {
      kind: 'update_section',
      data: { reportId: 'report-1', section: 'crew', content: {}, isComplete: false },
    },
    '2026-07-28T00:00:00.000Z',
  );
}

function createReportMutation(reportId: string): Mutation {
  return newMutation(
    reportId,
    {
      kind: 'create_report',
      data: {
        reportId,
        projectId: 'project-1',
        reportDate: '2026-07-28',
        carryForwardSourceReportId: null,
      },
    },
    '2026-07-28T00:00:00.000Z',
  );
}

beforeEach(() => {
  mockReparentReport.mockReset();
});

describe('createPusher', () => {
  test('success: returns ok:true and calls rpc with the mapped fn/args', async () => {
    const rpc: jest.MockedFunction<RpcRunner> = jest.fn().mockResolvedValue({
      data: null,
      error: null,
      status: 200,
    });
    const pusher = createPusher(rpc, FAKE_DB);

    const outcome = await pusher(updateSectionMutation());

    expect(outcome).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('update_section', {
      p_report_id: 'report-1',
      p_section: 'crew',
      p_payload: {},
      p_is_complete: false,
    });
  });

  test('error object: merges status into the spread error, preserving code/message', async () => {
    const rpc: jest.MockedFunction<RpcRunner> = jest.fn().mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'permission denied' },
      status: 403,
    });
    const pusher = createPusher(rpc, FAKE_DB);

    const outcome = await pusher(updateSectionMutation());

    expect(outcome).toEqual({
      ok: false,
      error: { code: '42501', message: 'permission denied', status: 403 },
    });
  });

  test('thrown exception: rpc rejecting is caught and reported as ok:false', async () => {
    const thrown = new TypeError('Network request failed');
    const rpc: jest.MockedFunction<RpcRunner> = jest.fn().mockRejectedValue(thrown);
    const pusher = createPusher(rpc, FAKE_DB);

    const outcome = await pusher(updateSectionMutation());

    expect(outcome).toEqual({ ok: false, error: thrown });
    expect(mockReparentReport).not.toHaveBeenCalled();
  });

  test('create_report same id: no reparent, plain ok:true', async () => {
    const reportId = 'report-abc';
    const rpc: jest.MockedFunction<RpcRunner> = jest.fn().mockResolvedValue({
      data: [{ report_id: reportId }],
      error: null,
      status: 200,
    });
    const pusher = createPusher(rpc, FAKE_DB);

    const outcome = await pusher(createReportMutation(reportId));

    expect(outcome).toEqual({ ok: true });
    expect(mockReparentReport).not.toHaveBeenCalled();
  });

  test('create_report collision: reparents loser onto winner and reports reparentedTo', async () => {
    const loserId = 'report-loser';
    const winnerId = 'report-winner';
    const rpc: jest.MockedFunction<RpcRunner> = jest.fn().mockResolvedValue({
      data: [{ report_id: winnerId }],
      error: null,
      status: 200,
    });
    mockReparentReport.mockResolvedValue(undefined);
    const pusher = createPusher(rpc, FAKE_DB);

    const outcome = await pusher(createReportMutation(loserId));

    expect(mockReparentReport).toHaveBeenCalledWith(FAKE_DB, loserId, winnerId);
    expect(outcome).toEqual({ ok: true, reparentedTo: winnerId });
  });

  test('reparent throws: reported as ok:false with the thrown error, no reparentedTo', async () => {
    const loserId = 'report-loser';
    const winnerId = 'report-winner';
    const rpc: jest.MockedFunction<RpcRunner> = jest.fn().mockResolvedValue({
      data: [{ report_id: winnerId }],
      error: null,
      status: 200,
    });
    const reparentError = new Error('reparent transaction failed');
    mockReparentReport.mockRejectedValue(reparentError);
    const pusher = createPusher(rpc, FAKE_DB);

    const outcome = await pusher(createReportMutation(loserId));

    expect(outcome).toEqual({ ok: false, error: reparentError });
  });
});
