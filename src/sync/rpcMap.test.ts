import { base64ToByteaHex, rpcCallOf, sectionWirePayload } from './rpcMap';
import type { MutationPayload } from './types';

describe('base64ToByteaHex', () => {
  it('converts a base64 PNG-like payload to a Postgres bytea hex literal', () => {
    // 'PNG' -> bytes [0x50, 0x4e, 0x47] -> base64 'UE5H'
    expect(base64ToByteaHex('UE5H')).toBe('\\x504e47');
  });

  it('returns the bare bytea hex prefix for an empty string', () => {
    expect(base64ToByteaHex('')).toBe('\\x');
  });

  it('exports base64ToByteaHex for the web repo path', () => {
    expect(base64ToByteaHex('AAAA')).toMatch(/^\\x/);
  });

  it('pins the backslash-x escaping (a bare \\x is invalid JS source)', () => {
    // In JS source, the literal prefix must be written as '\\x' — a single
    // backslash followed by x is what ends up in the runtime string.
    const result = base64ToByteaHex('');
    expect(result).toBe('\\x');
    expect(result.length).toBe(2);
    expect(result.charCodeAt(0)).toBe(92); // backslash
    expect(result.charCodeAt(1)).toBe(120); // 'x'
  });
});

describe('sectionWirePayload', () => {
  it('translates weather content to snake_case condition/temp_f', () => {
    const result = sectionWirePayload('weather', { condition: 'Sunny', tempF: 72 });
    expect(result).toEqual({ condition: 'Sunny', temp_f: 72 });
  });

  it('translates weather content with null fields', () => {
    const result = sectionWirePayload('weather', { condition: null, tempF: null });
    expect(result).toEqual({ condition: null, temp_f: null });
  });

  it('throws on weather content that does not match the expected shape', () => {
    expect(() => sectionWirePayload('weather', { condition: 'Sunny' })).toThrow();
    expect(() => sectionWirePayload('weather', 'not an object')).toThrow();
    expect(() => sectionWirePayload('weather', null)).toThrow();
  });

  it('passes non-weather section content through unchanged', () => {
    const content = { headcount: 5, notes: 'ok' };
    expect(sectionWirePayload('crew', content)).toBe(content);
  });
});

describe('rpcCallOf', () => {
  it('maps create_report', () => {
    const payload: MutationPayload = {
      kind: 'create_report',
      data: {
        reportId: 'report-1',
        projectId: 'project-1',
        reportDate: '2026-07-29',
        carryForwardSourceReportId: null,
      },
    };
    expect(rpcCallOf(payload)).toEqual({
      fn: 'create_report',
      args: { p_project_id: 'project-1', p_report_date: '2026-07-29', p_client_id: 'report-1' },
    });
  });

  it('maps update_section (non-weather)', () => {
    const payload: MutationPayload = {
      kind: 'update_section',
      data: {
        reportId: 'report-1',
        section: 'crew',
        content: { headcount: 3 },
        isComplete: true,
      },
    };
    expect(rpcCallOf(payload)).toEqual({
      fn: 'update_section',
      args: {
        p_report_id: 'report-1',
        p_section: 'crew',
        p_payload: { headcount: 3 },
        p_is_complete: true,
      },
    });
  });

  it('maps update_section for weather, translating content to snake_case p_payload', () => {
    const payload: MutationPayload = {
      kind: 'update_section',
      data: {
        reportId: 'report-1',
        section: 'weather',
        content: { condition: 'Rain', tempF: 55 },
        isComplete: false,
      },
    };
    expect(rpcCallOf(payload)).toEqual({
      fn: 'update_section',
      args: {
        p_report_id: 'report-1',
        p_section: 'weather',
        p_payload: { condition: 'Rain', temp_f: 55 },
        p_is_complete: false,
      },
    });
  });

  it('maps submit_report, hex-encoding the signature and never sending signerName', () => {
    const payload: MutationPayload = {
      kind: 'submit_report',
      data: {
        reportId: 'report-1',
        signaturePngBase64: 'UE5H',
        signerName: 'Jane Doe',
        signerTitle: 'Superintendent',
      },
    };
    const call = rpcCallOf(payload);
    expect(call.fn).toBe('submit_report');
    expect(call.args).toEqual({
      p_report_id: 'report-1',
      p_signer_title: 'Superintendent',
      p_signature_png: '\\x504e47',
    });
    expect(call.args).not.toHaveProperty('p_signer_name');
    expect(Object.values(call.args)).not.toContain('Jane Doe');
  });

  it('maps lock_report', () => {
    const payload: MutationPayload = {
      kind: 'lock_report',
      data: { reportId: 'report-1' },
    };
    expect(rpcCallOf(payload)).toEqual({
      fn: 'lock_report',
      args: { p_report_id: 'report-1' },
    });
  });

  it('maps create_amendment to amend_report, translating weather content in p_changes', () => {
    const payload: MutationPayload = {
      kind: 'create_amendment',
      data: {
        amendmentId: 'amend-1',
        reportId: 'report-1',
        reason: 'correction',
        changes: [
          { section: 'crew', content: { headcount: 4 } },
          { section: 'weather', content: { condition: 'Cloudy', tempF: 60 } },
        ],
        signaturePngBase64: 'UE5H',
        signerTitle: 'PM',
      },
    };
    expect(rpcCallOf(payload)).toEqual({
      fn: 'amend_report',
      args: {
        p_report_id: 'report-1',
        p_amendment_client_id: 'amend-1',
        p_reason: 'correction',
        p_changes: {
          crew: { payload: { headcount: 4 } },
          weather: { payload: { condition: 'Cloudy', temp_f: 60 } },
        },
        p_signer_title: 'PM',
        p_signature_png: '\\x504e47',
      },
    });
  });

  it('maps create_amendment with a null signature to a null p_signature_png (no hex encoding)', () => {
    const payload: MutationPayload = {
      kind: 'create_amendment',
      data: {
        amendmentId: 'amend-1',
        reportId: 'report-1',
        reason: 'correction',
        changes: [{ section: 'crew', content: { headcount: 4 } }],
        signaturePngBase64: null,
        signerTitle: null,
      },
    };
    expect(rpcCallOf(payload)).toEqual({
      fn: 'amend_report',
      args: {
        p_report_id: 'report-1',
        p_amendment_client_id: 'amend-1',
        p_reason: 'correction',
        p_changes: { crew: { payload: { headcount: 4 } } },
        p_signer_title: null,
        p_signature_png: null,
      },
    });
  });

  it('throws on a create_amendment with duplicate section keys in changes', () => {
    const payload: MutationPayload = {
      kind: 'create_amendment',
      data: {
        amendmentId: 'amend-1',
        reportId: 'report-1',
        reason: 'correction',
        changes: [
          { section: 'crew', content: { headcount: 4 } },
          { section: 'crew', content: { headcount: 5 } },
        ],
        signaturePngBase64: null,
        signerTitle: null,
      },
    };
    expect(() => rpcCallOf(payload)).toThrow();
  });

  it('throws for photo kinds (M5)', () => {
    const addPhoto: MutationPayload = {
      kind: 'add_photo',
      data: {
        photoId: 'photo-1',
        reportId: 'report-1',
        projectId: 'project-1',
        storagePath: 'project-1/report-1/photo-1.jpg',
        localUri: 'file:///tmp/photo-1.jpg',
        width: 100,
        height: 100,
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
    expect(() => rpcCallOf(addPhoto)).toThrow('photo kinds are M5');

    const updateMeta: MutationPayload = {
      kind: 'update_photo_meta',
      data: {
        photoId: 'photo-1',
        reportId: 'report-1',
        caption: null,
        tradeTag: null,
        locationTag: null,
      },
    };
    expect(() => rpcCallOf(updateMeta)).toThrow('photo kinds are M5');

    const removePhoto: MutationPayload = {
      kind: 'remove_photo',
      data: { photoId: 'photo-1', reportId: 'report-1', storagePath: 'x' },
    };
    expect(() => rpcCallOf(removePhoto)).toThrow('photo kinds are M5');
  });
});
