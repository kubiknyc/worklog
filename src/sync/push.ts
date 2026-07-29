/**
 * Pure payload → RPC mapping for the five lifecycle kinds (doc 06 §A).
 * Photo kinds are storage + direct table ops and land in M5; mapping them
 * here would be dead code the drain order can't reach yet.
 */
import type { Json, MutationPayload } from './types';

export interface RpcCall {
  readonly fn:
    'create_report' | 'update_section' | 'submit_report' | 'lock_report' | 'amend_report';
  readonly args: Readonly<Record<string, Json>>;
}

/**
 * PostgREST decodes `bytea` params from `\x`-prefixed hex, not base64.
 * atob is available in Hermes and Node ≥ 16 (jest) alike.
 */
export function base64ToByteaHex(b64: string): string {
  const bytes = atob(b64);
  let hex = '\\x';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return hex;
}

export function rpcCallOf(payload: MutationPayload): RpcCall {
  switch (payload.kind) {
    case 'create_report':
      return {
        fn: 'create_report',
        args: {
          p_project_id: payload.data.projectId,
          p_report_date: payload.data.reportDate,
          p_client_id: payload.data.reportId,
        },
      };
    case 'update_section':
      return {
        fn: 'update_section',
        args: {
          p_report_id: payload.data.reportId,
          p_section: payload.data.section,
          p_payload: payload.data.content,
          p_is_complete: payload.data.isComplete,
        },
      };
    case 'submit_report':
      // signerName is display-only local state; the server derives the signer
      // from auth.uid() — sending it would just be an unused (and spoofable) arg.
      return {
        fn: 'submit_report',
        args: {
          p_report_id: payload.data.reportId,
          p_signer_title: payload.data.signerTitle,
          p_signature_png: base64ToByteaHex(payload.data.signaturePngBase64),
        },
      };
    case 'lock_report':
      return { fn: 'lock_report', args: { p_report_id: payload.data.reportId } };
    case 'create_amendment':
      return {
        fn: 'amend_report',
        args: {
          p_report_id: payload.data.reportId,
          p_amendment_client_id: payload.data.amendmentId,
          p_reason: payload.data.reason,
          p_changes: payload.data.changes as unknown as Json,
          p_signer_title: payload.data.signerTitle,
          p_signature_png:
            payload.data.signaturePngBase64 === null
              ? null
              : base64ToByteaHex(payload.data.signaturePngBase64),
        },
      };
    case 'add_photo':
    case 'update_photo_meta':
    case 'remove_photo':
      throw new Error(`photo kinds are M5 — no RPC mapping for '${payload.kind}'`);
  }
}
