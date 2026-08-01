/**
 * Pure lifecycle guards (05-test-architecture §B.7). The server RPCs are the
 * authority (submit_report/lock_report enforce legal transitions with P0001);
 * these guards are the CLIENT's half: an edit attempt on a non-draft report is
 * never even enqueued, and the UI only offers transitions the server would
 * accept. Role gating (is_super) is deliberately NOT here — it is a UI concern
 * fed by membership data; these functions answer only "does the status allow
 * it".
 */
import type { DailyReportRow } from './types';

export type ReportStatus = DailyReportRow['status'];

/** Sections are editable only while the report is a draft — all 11 alike. */
export function canEditSection(status: ReportStatus): boolean {
  return status === 'draft';
}

/** draft → submitted is the only legal submit transition. */
export function canSubmit(status: ReportStatus): boolean {
  return status === 'draft';
}

/** submitted → locked is the only legal manual-lock transition. */
export function canLock(status: ReportStatus): boolean {
  return status === 'submitted';
}
