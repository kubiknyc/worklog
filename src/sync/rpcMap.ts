/**
 * Pure mapping from a queued `MutationPayload` (src/sync/types.ts) to the
 * Postgres RPC call that pushes it (docs/architecture/06-sync-mappings.md
 * §A). No IO, no native or Supabase imports — consumed by both the native
 * push handler (Task 4's `rpcCallOf` caller) and the web repository
 * (`src/data/supabaseRepo.ts`), which is why the weather wire translation
 * lives here instead of duplicated in each path.
 */
import type { AmendmentSectionChange, Json, MutationPayload, SectionKind } from './types';

export interface RpcCall {
  readonly fn:
    'create_report' | 'update_section' | 'submit_report' | 'lock_report' | 'amend_report';
  readonly args: Readonly<Record<string, Json>>;
}

export type RpcName = RpcCall['fn'];

const HEX_CHARS = '0123456789abcdef';

/**
 * Base64 -> Postgres `bytea` hex literal (`\x` + lowercase hex pairs), for
 * the signature PNG carried in `submit_report`/`amend_report`. `atob` is
 * available in the runtimes this ships to: Hermes RN 0.81, Node >= 16 (the
 * Jest environment), and the DOM lib types picked up by tsconfig — no
 * polyfill needed.
 *
 * The `\x` prefix must be written in JS source as the two-character escape
 * `'\\x'` (a bare `\x` is an invalid escape sequence in a JS string
 * literal) — this is the one place that escaping is pinned.
 *
 * Exported (not module-private) because the web repo's direct RPC path
 * (`src/data/supabaseRepo.ts`) also needs this exact wire encoding — sharing
 * the function keeps the native push handler and the web repo from drifting
 * on how the signature bytes are hex-encoded.
 */
export function base64ToByteaHex(b64: string): string {
  const binary = atob(b64);
  const hexPairs: string[] = [];
  for (let i = 0; i < binary.length; i += 1) {
    const code = binary.charCodeAt(i);
    hexPairs.push(HEX_CHARS[(code >> 4) & 0xf] + HEX_CHARS[code & 0xf]);
  }
  return `\\x${hexPairs.join('')}`;
}

function isWeatherContentShape(
  content: Json,
): content is { readonly condition: string | null; readonly tempF: number | null } {
  if (content === null || typeof content !== 'object' || Array.isArray(content)) return false;
  const record = content as Readonly<Record<string, Json>>;
  const hasCondition =
    'condition' in record && (typeof record.condition === 'string' || record.condition === null);
  const hasTempF = 'tempF' in record && (typeof record.tempF === 'number' || record.tempF === null);
  return hasCondition && hasTempF;
}

/**
 * The server's weather handler reads `payload->>'condition'` and
 * `payload->>'temp_f'` (snake_case) on both the `update_section` weather
 * branch and `amend_report`. The app's local weather content is `tempF`
 * (camelCase, `WeatherOverrideContent` in types.ts) — this is the one place
 * that translation happens, shared by every RPC-building path.
 */
export function sectionWirePayload(section: SectionKind, content: Json): Json {
  if (section !== 'weather') return content;
  if (!isWeatherContentShape(content)) {
    throw new Error(
      'sectionWirePayload: weather content does not match { condition, tempF } shape',
    );
  }
  return { condition: content.condition, temp_f: content.tempF };
}

function amendmentChangesOf(
  changes: readonly AmendmentSectionChange[],
): Readonly<Record<string, Json>> {
  const result: Record<string, Json> = {};
  for (const change of changes) {
    if (Object.prototype.hasOwnProperty.call(result, change.section)) {
      throw new Error(`rpcCallOf: duplicate amendment section "${change.section}"`);
    }
    result[change.section] = { payload: sectionWirePayload(change.section, change.content) };
  }
  return result;
}

/** Builds the RPC call for a queued mutation. Photo kinds are M5 (not yet pushed via RPC). */
export function rpcCallOf(payload: MutationPayload): RpcCall {
  switch (payload.kind) {
    case 'create_report': {
      const { reportId, projectId, reportDate } = payload.data;
      return {
        fn: 'create_report',
        args: { p_project_id: projectId, p_report_date: reportDate, p_client_id: reportId },
      };
    }
    case 'update_section': {
      const { reportId, section, content, isComplete } = payload.data;
      return {
        fn: 'update_section',
        args: {
          p_report_id: reportId,
          p_section: section,
          p_payload: sectionWirePayload(section, content),
          p_is_complete: isComplete,
        },
      };
    }
    case 'submit_report': {
      const { reportId, signerTitle, signaturePngBase64 } = payload.data;
      return {
        fn: 'submit_report',
        args: {
          p_report_id: reportId,
          p_signer_title: signerTitle,
          p_signature_png: base64ToByteaHex(signaturePngBase64),
        },
      };
    }
    case 'lock_report': {
      return { fn: 'lock_report', args: { p_report_id: payload.data.reportId } };
    }
    case 'create_amendment': {
      const { reportId, amendmentId, reason, changes, signerTitle, signaturePngBase64 } =
        payload.data;
      return {
        fn: 'amend_report',
        args: {
          p_report_id: reportId,
          p_amendment_client_id: amendmentId,
          p_reason: reason,
          p_changes: amendmentChangesOf(changes),
          p_signer_title: signerTitle,
          p_signature_png:
            signaturePngBase64 === null ? null : base64ToByteaHex(signaturePngBase64),
        },
      };
    }
    case 'add_photo':
    case 'update_photo_meta':
    case 'remove_photo':
      throw new Error('photo kinds are M5');
  }
}
