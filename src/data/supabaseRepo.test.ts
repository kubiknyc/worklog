/**
 * Focused test for `updateSection`'s weather wire translation. The rest of
 * `SupabaseRepository` is exercised indirectly elsewhere; this test exists to
 * pin the web push path through the shared `sectionWirePayload` helper
 * (rpcMap.ts) so native and web can't drift on the condition/temp_f rename.
 */
import { supabaseRepository } from './supabaseRepo';

const mockRpc = jest.fn(
  (..._args: unknown[]): Promise<{ data: null; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
);

jest.mock('../supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

beforeEach(() => {
  mockRpc.mockClear();
  mockRpc.mockImplementation(() => Promise.resolve({ data: null, error: null }));
});

describe('SupabaseRepository.updateSection', () => {
  it('sends weather content translated to snake_case temp_f via the shared wire helper', async () => {
    await supabaseRepository.updateSection(
      'report-1',
      'weather',
      { condition: 'Sunny', tempF: 72 },
      false,
    );

    expect(mockRpc).toHaveBeenCalledWith('update_section', {
      p_report_id: 'report-1',
      p_section: 'weather',
      p_payload: { condition: 'Sunny', temp_f: 72 },
      p_is_complete: false,
    });
  });

  it('passes non-weather section content through unchanged', async () => {
    await supabaseRepository.updateSection('report-1', 'crew', { headcount: 3 }, true);

    expect(mockRpc).toHaveBeenCalledWith('update_section', {
      p_report_id: 'report-1',
      p_section: 'crew',
      p_payload: { headcount: 3 },
      p_is_complete: true,
    });
  });
});

describe('SupabaseRepository.setActiveProject', () => {
  it('is a no-op on web — online-only, no local pull cursor to bias', async () => {
    await expect(supabaseRepository.setActiveProject('p1')).resolves.toBeUndefined();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe('SupabaseRepository.submitReport', () => {
  it('calls submit_report with the hex-encoded signature', async () => {
    await supabaseRepository.submitReport('report-1', {
      signerName: 'Sam Super',
      signerTitle: 'PM',
      signaturePngBase64: 'UE5H',
    });

    expect(mockRpc).toHaveBeenCalledWith('submit_report', {
      p_report_id: 'report-1',
      p_signer_title: 'PM',
      p_signature_png: '\\x504e47',
    });
  });

  it('surfaces an RPC error as the generic thrown message', async () => {
    mockRpc.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: { message: 'boom' } }),
    );

    await expect(
      supabaseRepository.submitReport('report-1', {
        signerName: 'Sam Super',
        signerTitle: null,
        signaturePngBase64: 'UE5H',
      }),
    ).rejects.toThrow('Unable to load data. Please try again.');
  });
});

describe('SupabaseRepository.lockReport', () => {
  it('calls lock_report with the report id', async () => {
    await supabaseRepository.lockReport('report-1');

    expect(mockRpc).toHaveBeenCalledWith('lock_report', { p_report_id: 'report-1' });
  });

  it('surfaces an RPC error as the generic thrown message', async () => {
    mockRpc.mockImplementationOnce(() =>
      Promise.resolve({ data: null, error: { message: 'boom' } }),
    );

    await expect(supabaseRepository.lockReport('report-1')).rejects.toThrow(
      'Unable to load data. Please try again.',
    );
  });
});
