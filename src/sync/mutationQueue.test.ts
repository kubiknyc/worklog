import {
  applyOutcome,
  classifyError,
  isDuplicateUpload,
  newMutation,
  normalizeStorageError,
  orderForDrain,
  otherMutationTargetsRow,
  RETRY_CEILING,
  rowTargetOf,
} from './mutationQueue';
import type { Mutation, MutationPayload, SectionKind } from './types';

const payload: MutationPayload = {
  kind: 'update_section',
  data: { reportId: 'r1', section: 'crew', content: {}, isComplete: false },
};

const base = newMutation('h1', payload, '2026-06-28T00:00:00Z');

describe('classifyError', () => {
  it('treats RLS denial as evict', () => {
    expect(classifyError({ code: '42501' })).toBe('evict');
    expect(classifyError({ status: 403 })).toBe('evict');
  });

  it('treats an expired token (401) as retryable, not a denial', () => {
    // The Supabase client refreshes the session and the next sync retries; a
    // genuinely dead token just exhausts the ceiling. Evicting here would delete
    // a still-valid offline write.
    expect(classifyError({ status: 401 })).toBe('retryable');
  });

  it('treats 5xx / unknown as retryable', () => {
    expect(classifyError({ status: 503 })).toBe('retryable');
    expect(classifyError(new Error('whatever'))).toBe('retryable');
  });

  it('treats a transport failure (no HTTP status) as offline, not retryable', () => {
    // No response at all = no server verdict; must not burn the retry ceiling.
    expect(classifyError({ name: 'TypeError', message: 'Network request failed' })).toBe('offline');
    expect(classifyError({ message: 'fetch failed' })).toBe('offline');
    expect(classifyError({ message: 'request timeout' })).toBe('offline');
  });

  it('treats deterministic SQL rejections as permanent', () => {
    expect(classifyError({ code: '22000' })).toBe('permanent'); // illegal transition
    expect(classifyError({ code: '23514' })).toBe('permanent'); // check violation
    expect(classifyError({ code: 'P0002' })).toBe('permanent'); // not found
    expect(classifyError({ status: 400 })).toBe('permanent');
  });

  it('classifies PL/pgSQL P0-class and custom PL001 as permanent (M4)', () => {
    expect(classifyError({ code: 'P0001' })).toBe('permanent'); // raise exception
    expect(classifyError({ code: 'PL001' })).toBe('permanent'); // stale-replace guard
  });

  it('does NOT force every P* code permanent — PostgREST codes fall through (M4)', () => {
    // PGRST301 = expired JWT → retryable; a blanket startsWith('P') wrongly parked it.
    expect(classifyError({ code: 'PGRST301', status: 401 })).toBe('retryable');
    // PGRST116 with no status defaults to retryable rather than a hard park.
    expect(classifyError({ code: 'PGRST116' })).toBe('retryable');
  });
});

describe('applyOutcome', () => {
  it('removes the mutation on success', () => {
    expect(applyOutcome(base, { ok: true })).toEqual({ next: null, evict: false });
  });

  it('bumps attempts and stays pending on a retryable error', () => {
    const { next, evict } = applyOutcome(base, { ok: false, error: { status: 500 } });
    expect(evict).toBe(false);
    expect(next).toMatchObject({ attempts: 1, status: 'pending' });
    expect(next?.lastError).toBeTruthy();
  });

  it('parks once attempts reach the ceiling', () => {
    const aged = { ...base, attempts: RETRY_CEILING - 1 };
    const { next } = applyOutcome(aged, { ok: false, error: { status: 500 } });
    expect(next).toMatchObject({ attempts: RETRY_CEILING, status: 'parked' });
  });

  it('leaves attempts untouched on an offline failure — offline can never park (review #1)', () => {
    const offlineError = { name: 'TypeError', message: 'Network request failed' };
    const aged = { ...base, attempts: RETRY_CEILING - 1 };
    const { next, evict } = applyOutcome(aged, { ok: false, error: offlineError });
    expect(evict).toBe(false);
    expect(next).toMatchObject({ attempts: RETRY_CEILING - 1, status: 'pending' });
    expect(next?.lastError).toBeTruthy();
  });

  it('parks immediately on a permanent error', () => {
    const { next, evict } = applyOutcome(base, { ok: false, error: { code: '22000' } });
    expect(evict).toBe(false);
    expect(next).toMatchObject({ attempts: 1, status: 'parked' });
  });

  it('parks and signals eviction on an RLS denial', () => {
    const { next, evict } = applyOutcome(base, { ok: false, error: { code: '42501' } });
    expect(evict).toBe(true);
    expect(next).toMatchObject({ status: 'parked' });
  });
});

describe('normalizeStorageError (M6a [R2-6])', () => {
  it('maps a string statusCode to a numeric status so classifyError can judge it', () => {
    // StorageApiError carries statusCode as a STRING; unnormalized, "403" would
    // fall through every status check and an RLS denial would retry forever.
    expect(normalizeStorageError({ name: 'StorageApiError', message: 'denied', statusCode: '403' }))
      .toEqual({ name: 'StorageApiError', message: 'denied', code: undefined, status: 403 });
    expect(classifyError(normalizeStorageError({ statusCode: '403', message: 'denied' }))).toBe('evict');
    expect(classifyError(normalizeStorageError({ statusCode: '503', message: 'oops' }))).toBe('retryable');
  });

  it('prefers an already-numeric status when present', () => {
    expect(normalizeStorageError({ message: 'x', status: 500, statusCode: '503' }))
      .toMatchObject({ status: 500 });
  });

  it('passes a transport failure through unchanged so it still classifies offline', () => {
    const err = { name: 'StorageUnknownError', message: 'Network request failed' };
    expect(normalizeStorageError(err)).toBe(err);
    expect(classifyError(normalizeStorageError(err))).toBe('offline');
  });

  it('passes non-objects and unparseable codes through unchanged', () => {
    expect(normalizeStorageError('boom')).toBe('boom');
    expect(normalizeStorageError(null)).toBe(null);
    const weird = { message: 'x', statusCode: 'Duplicate' };
    expect(normalizeStorageError(weird)).toBe(weird);
  });
});

describe('isDuplicateUpload (M6a [R2-2])', () => {
  it('recognizes a 409 by string statusCode, numeric status, or Duplicate body', () => {
    expect(isDuplicateUpload({ statusCode: '409', message: 'The resource already exists' })).toBe(true);
    expect(isDuplicateUpload({ status: 409, message: 'Conflict' })).toBe(true);
    // Older storage-api releases: 400 + error 'Duplicate'.
    expect(isDuplicateUpload({ statusCode: '400', error: 'Duplicate', message: 'The resource already exists' })).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isDuplicateUpload({ statusCode: '403', message: 'denied' })).toBe(false);
    expect(isDuplicateUpload({ status: 500, message: 'oops' })).toBe(false);
    expect(isDuplicateUpload({ name: 'TypeError', message: 'Network request failed' })).toBe(false);
    expect(isDuplicateUpload(null)).toBe(false);
    expect(isDuplicateUpload('409')).toBe(false);
  });
});

describe('orderForDrain (M6a two-pass [R2-6])', () => {
  const photo = (clientId: string, reportId = 'r1') =>
    newMutation(clientId, {
      kind: 'add_photo',
      data: {
        photoId: clientId, reportId, projectId: 'p1',
        storagePath: `p1/${reportId}/${clientId}.jpg`,
        localUri: `file:///doc/photo-outbox/${clientId}.jpg`,
        width: 1280, height: 960,
        capturedAt: '2026-06-28T00:00:00Z', exifDateTimeOriginal: null,
        gpsLat: null, gpsLng: null, gpsAccuracy: null,
        source: 'camera', tradeTag: null, locationTag: null, caption: null,
      },
    }, '2026-06-28T00:00:00Z');
  const section = (clientId: string) =>
    newMutation(clientId, {
      kind: 'update_section',
      data: { reportId: 'r1', section: 'crew', content: {}, isComplete: false },
    }, '2026-06-28T00:00:00Z');

  it('drains JSON mutations first, add_photo last, both in original (seq) order', () => {
    const ordered = orderForDrain([photo('ph1'), section('h1'), photo('ph2'), section('h2')]);
    expect(ordered.map((m) => m.clientId)).toEqual(['h1', 'h2', 'ph1', 'ph2']);
  });

  it('is the identity for all-JSON and all-photo queues', () => {
    expect(orderForDrain([section('h1'), section('h2')]).map((m) => m.clientId)).toEqual(['h1', 'h2']);
    expect(orderForDrain([photo('ph1'), photo('ph2')]).map((m) => m.clientId)).toEqual(['ph1', 'ph2']);
    expect(orderForDrain([])).toEqual([]);
  });
});

describe('rowTargetOf / otherMutationTargetsRow (M1)', () => {
  const createReport = (clientId: string, reportId: string): Mutation =>
    newMutation(clientId, {
      kind: 'create_report',
      data: { reportId, projectId: 'p1', reportDate: '2026-07-18', carryForwardSourceReportId: null },
    }, '2026-06-28T00:00:00Z');

  const submitReport = (clientId: string, reportId: string): Mutation =>
    newMutation(clientId, {
      kind: 'submit_report',
      data: { reportId, signaturePngBase64: 'base64data', signerName: 'Jane Doe', signerTitle: 'Superintendent' },
    }, '2026-06-28T00:00:00Z');

  const lockReport = (clientId: string, reportId: string): Mutation =>
    newMutation(clientId, {
      kind: 'lock_report',
      data: { reportId },
    }, '2026-06-28T00:00:00Z');

  const updateSection = (clientId: string, reportId: string, section: SectionKind = 'crew'): Mutation =>
    newMutation(clientId, {
      kind: 'update_section',
      data: { reportId, section, content: {}, isComplete: false },
    }, '2026-06-28T00:00:00Z');

  const addPhoto = (clientId: string, reportId: string): Mutation =>
    newMutation(clientId, {
      kind: 'add_photo',
      data: {
        photoId: clientId, reportId, projectId: 'p1',
        storagePath: `p1/${reportId}/${clientId}.jpg`,
        localUri: `file:///doc/photo-outbox/${clientId}.jpg`,
        width: 1280, height: 960,
        capturedAt: '2026-06-28T00:00:00Z', exifDateTimeOriginal: null,
        gpsLat: null, gpsLng: null, gpsAccuracy: null,
        source: 'camera', tradeTag: null, locationTag: null, caption: null,
      },
    }, '2026-06-28T00:00:00Z');

  const updatePhotoMeta = (clientId: string, reportId: string, photoId: string): Mutation =>
    newMutation(clientId, {
      kind: 'update_photo_meta',
      data: { photoId, reportId, caption: 'updated caption', tradeTag: null, locationTag: null },
    }, '2026-06-28T00:00:00Z');

  const removePhoto = (clientId: string, reportId: string, photoId: string): Mutation =>
    newMutation(clientId, {
      kind: 'remove_photo',
      data: { photoId, reportId, storagePath: `p1/${reportId}/${photoId}.jpg` },
    }, '2026-06-28T00:00:00Z');

  const createAmendment = (clientId: string, reportId: string): Mutation =>
    newMutation(clientId, {
      kind: 'create_amendment',
      data: {
        amendmentId: clientId, reportId, reason: 'correction',
        changes: [{ section: 'crew', content: {} }],
        signaturePngBase64: null, signerTitle: null,
      },
    }, '2026-06-28T00:00:00Z');

  it('update_section targets the (reportId, section) tuple row', () => {
    const target = rowTargetOf({
      kind: 'update_section',
      data: { reportId: 'r1', section: 'crew', content: {}, isComplete: false },
    });
    expect(target).toEqual({ table: 'report_sections', id: 'r1:crew' });
  });

  it('create_report/submit_report/lock_report target the daily_reports row', () => {
    expect(rowTargetOf(createReport('h1', 'r1').payload)).toEqual({ table: 'daily_reports', id: 'r1' });
    expect(rowTargetOf(submitReport('h2', 'r1').payload)).toEqual({ table: 'daily_reports', id: 'r1' });
    expect(rowTargetOf(lockReport('h3', 'r1').payload)).toEqual({ table: 'daily_reports', id: 'r1' });
  });

  it('create_amendment targets its own report_amendments row', () => {
    expect(rowTargetOf(createAmendment('a1', 'r1').payload)).toEqual({ table: 'report_amendments', id: 'a1' });
  });

  it('add_photo, update_photo_meta, and remove_photo all target the same report_photos row by photoId', () => {
    expect(rowTargetOf(addPhoto('ph1', 'r1').payload)).toEqual({ table: 'report_photos', id: 'ph1' });
    expect(rowTargetOf(updatePhotoMeta('m1', 'r1', 'ph1').payload)).toEqual({ table: 'report_photos', id: 'ph1' });
    expect(rowTargetOf(removePhoto('rm1', 'r1', 'ph1').payload)).toEqual({ table: 'report_photos', id: 'ph1' });
  });

  it('add_photo targets its own report_photos row, never the parent report (M6a)', () => {
    // A queued photo must not block clearing the report's dirty flag or vice versa.
    const s = createReport('h1', 'r1');
    expect(otherMutationTargetsRow([s, addPhoto('ph1', 'r1')], s)).toBe(false);
    const p = addPhoto('ph1', 'r1');
    expect(otherMutationTargetsRow([p, createReport('h1', 'r1')], p)).toBe(false);
    expect(otherMutationTargetsRow([p, addPhoto('ph2', 'r1')], p)).toBe(false);
  });

  it('detects another queued mutation on the same daily_reports row, regardless of kind', () => {
    const m = createReport('h1', 'r1');
    expect(otherMutationTargetsRow([m, lockReport('h2', 'r1')], m)).toBe(true);
    expect(otherMutationTargetsRow([m, createReport('h3', 'r2')], m)).toBe(false);
  });

  it('ignores the mutation itself and unrelated rows', () => {
    const m = createReport('h1', 'r1');
    expect(otherMutationTargetsRow([m], m)).toBe(false);
    expect(otherMutationTargetsRow([], m)).toBe(false);
  });

  it('an update_section on the same report does NOT contend with the daily_reports row (and vice versa)', () => {
    const m = createReport('h1', 'r1');
    expect(otherMutationTargetsRow([m, updateSection('s1', 'r1')], m)).toBe(false);
    const s = updateSection('s1', 'r1');
    expect(otherMutationTargetsRow([s, createReport('h1', 'r1')], s)).toBe(false);
  });

  it('two update_section mutations only contend when they share the same (reportId, section) tuple', () => {
    const s = updateSection('s1', 'r1', 'crew');
    expect(otherMutationTargetsRow([s, updateSection('s2', 'r1', 'safety')], s)).toBe(false);
    expect(otherMutationTargetsRow([s, updateSection('s2', 'r2', 'crew')], s)).toBe(false);
    // A parked duplicate of the same row (e.g. a superseded retry) still counts.
    const dup = { ...updateSection('s1', 'r1', 'crew'), clientId: 'other', status: 'parked' as const };
    expect(otherMutationTargetsRow([s, dup], s)).toBe(true);
  });
});
