import { base64ToByteaHex, rpcCallOf } from './push';
import type { MutationPayload } from './types';

describe('base64ToByteaHex', () => {
  it('converts base64 to \\x-prefixed lowercase hex', () => {
    // 'AQID' is base64 for bytes 0x01 0x02 0x03
    expect(base64ToByteaHex('AQID')).toBe('\\x010203');
  });
  it('handles empty input', () => {
    expect(base64ToByteaHex('')).toBe('\\x');
  });
});

describe('rpcCallOf', () => {
  it('maps create_report', () => {
    const p: MutationPayload = {
      kind: 'create_report',
      data: {
        reportId: 'r1',
        projectId: 'p1',
        reportDate: '2026-07-28',
        carryForwardSourceReportId: null,
      },
    };
    expect(rpcCallOf(p)).toEqual({
      fn: 'create_report',
      args: { p_project_id: 'p1', p_report_date: '2026-07-28', p_client_id: 'r1' },
    });
  });

  it('maps update_section (weather rides the same RPC)', () => {
    const p: MutationPayload = {
      kind: 'update_section',
      data: {
        reportId: 'r1',
        section: 'weather',
        content: { condition: 'Rain', tempF: 61 },
        isComplete: true,
      },
    };
    expect(rpcCallOf(p)).toEqual({
      fn: 'update_section',
      args: {
        p_report_id: 'r1',
        p_section: 'weather',
        p_payload: { condition: 'Rain', tempF: 61 },
        p_is_complete: true,
      },
    });
  });

  it('maps submit_report — signature as bytea hex, signerName never sent', () => {
    const p: MutationPayload = {
      kind: 'submit_report',
      data: { reportId: 'r1', signaturePngBase64: 'AQID', signerName: 'Pat', signerTitle: 'Super' },
    };
    expect(rpcCallOf(p)).toEqual({
      fn: 'submit_report',
      args: { p_report_id: 'r1', p_signer_title: 'Super', p_signature_png: '\\x010203' },
    });
  });

  it('maps lock_report', () => {
    const p: MutationPayload = { kind: 'lock_report', data: { reportId: 'r1' } };
    expect(rpcCallOf(p)).toEqual({ fn: 'lock_report', args: { p_report_id: 'r1' } });
  });

  it('maps create_amendment with null signature passing null bytea', () => {
    const p: MutationPayload = {
      kind: 'create_amendment',
      data: {
        amendmentId: 'a1',
        reportId: 'r1',
        reason: 'wrong crew count',
        changes: [{ section: 'crew', content: { rows: [] } }],
        signaturePngBase64: null,
        signerTitle: null,
      },
    };
    expect(rpcCallOf(p)).toEqual({
      fn: 'amend_report',
      args: {
        p_report_id: 'r1',
        p_amendment_client_id: 'a1',
        p_reason: 'wrong crew count',
        p_changes: [{ section: 'crew', content: { rows: [] } }],
        p_signer_title: null,
        p_signature_png: null,
      },
    });
  });

  it('throws on photo kinds (M5)', () => {
    const p: MutationPayload = {
      kind: 'remove_photo',
      data: { photoId: 'ph1', reportId: 'r1', storagePath: 'p1/r1/ph1.jpg' },
    };
    expect(() => rpcCallOf(p)).toThrow(/photo kinds are M5/);
  });
});
