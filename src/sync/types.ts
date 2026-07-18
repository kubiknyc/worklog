/**
 * Shared sync types. Pure — safe to import from both the Jest-tested logic
 * modules and the native adapters. No native or Supabase imports here.
 *
 * Unlike PunchLog (which imports its domain literals from `../data/types`),
 * the small literal unions the payloads need are defined here: `SectionKind`
 * is fundamentally a sync-level discriminator (mutation payload + the
 * `report_sections.section` check constraint), so the sync layer owns it and
 * the data layer re-exports — the dependency direction stays data → sync.
 */

/**
 * The 11 report sections. `weather` is section-shaped for sync purposes [R3]:
 * an `update_section` with section='weather' targets `report_weather`'s
 * override_* columns server-side, not a `report_sections` row — but it rides
 * the queue as an ordinary section edit so the kind list stays stable and the
 * manual override is offline-capable.
 */
export const SECTION_KINDS = [
  'crew',
  'work_performed',
  'deliveries',
  'equipment',
  'inspections',
  'safety',
  'delays',
  'visitors',
  'rfis',
  'general_notes',
  'weather',
] as const;

export type SectionKind = (typeof SECTION_KINDS)[number];

/** Drives the "Taken vs Added" provenance rendering on the PDF photo sheet. */
export type PhotoSource = 'camera' | 'library';

/**
 * JSON-safe value — what a persisted mutation payload's `content` may hold.
 * Section content is authored by the section editor sheets; its per-section
 * shape is a data-layer concern, so the queue stores it opaquely.
 */
export type Json = string | number | boolean | null | { readonly [key: string]: Json } | readonly Json[];

/**
 * The `content` shape when `UpdateSectionPayload.section === 'weather'`:
 * the push handler writes these into `report_weather.override_condition` /
 * `override_temp_f` (and the server stamps override_at/override_by, flipping
 * `weather_source` to 'manual'). Deliberately a type alias, not an interface,
 * so it stays assignable to `Json`.
 */
export type WeatherOverrideContent = {
  readonly condition: string | null;
  readonly tempF: number | null;
};

/**
 * `pending` mutations drain on the next sync; `parked` ones hit the retry ceiling
 * or a permanent error and wait for an explicit user retry (surfaced in the UI).
 */
export type MutationStatus = 'pending' | 'parked';

export interface CreateReportPayload {
  /**
   * Client UUID = final server id — with the ONE handled exception: on a
   * same-day UNIQUE(project_id, report_date) collision the get-or-create RPC
   * returns the EXISTING report's id, and the push handler re-parents every
   * local row and queued mutation from this id onto the winner (02 §C).
   */
  readonly reportId: string;
  readonly projectId: string;
  /** `YYYY-MM-DD`, computed in the PROJECT's timezone (`reportDate.ts`), never the device's. */
  readonly reportDate: string;
  /** Source report when the draft was seeded by carry-forward; null for a blank draft. */
  readonly carryForwardSourceReportId: string | null;
}

export interface UpdateSectionPayload {
  readonly reportId: string;
  /**
   * With reportId, this IS the row identity [R2] — sections have a composite
   * PK (report_id, section), no minted sectionId. Repeated edits to the same
   * (reportId, section) coalesce into one queued mutation.
   */
  readonly section: SectionKind;
  /**
   * Full replacement content for the section (LWW by the section row's server
   * `updated_at`, invariant 8 — no client timestamp, no from-guard). For
   * relational sections the server re-explodes child rows from this in the
   * same transaction. For section='weather' this is `WeatherOverrideContent`.
   */
  readonly content: Json;
  /** "None today" affirmation / skip state carried on the section row. */
  readonly isComplete: boolean;
}

export interface SubmitReportPayload {
  readonly reportId: string;
  /** Signature PNG captured at submit; persisted server-side in the same transaction as the transition. */
  readonly signaturePngBase64: string;
  readonly signerName: string;
  /** Display title from report_member_prefs (PM/Superintendent) — label only, never authorization. */
  readonly signerTitle: string | null;
}

export interface LockReportPayload {
  /**
   * Explicit "Lock now" only — the grace-window auto-lock is a server-side
   * scheduled job calling the same RPC, never a client mutation.
   */
  readonly reportId: string;
}

/** One amended section's proposed replacement content (the "after" side; the server snapshots "before"). */
export interface AmendmentSectionChange {
  readonly section: SectionKind;
  readonly content: Json;
}

export interface CreateAmendmentPayload {
  readonly amendmentId: string; // client UUID = final server id — the amend_report RPC's idempotency key
  readonly reportId: string;
  readonly reason: string;
  readonly changes: readonly AmendmentSectionChange[];
  /** Optional per company customization (admin-toggleable, default required). */
  readonly signaturePngBase64: string | null;
  /** Signer's display title (report_member_prefs) — printed in the PDF amendment
   * appendix; the amend_report RPC accepts it alongside the signature. */
  readonly signerTitle: string | null;
}

/**
 * A captured photo riding the one shared queue. Carries the durable outbox
 * file's URI — never bytes, which stay on disk until the push reads them.
 * `storagePath` is fully known at capture (client UUIDs are the final server
 * ids): `<projectId>/<reportId>/<photoId>.jpg` in the worklog-photos bucket.
 */
export interface AddPhotoPayload {
  readonly photoId: string; // client UUID = final server id (and the outbox file name)
  readonly reportId: string;
  readonly projectId: string;
  readonly storagePath: string;
  /** Durable outbox file URI (app-document dir, not the purgeable OS cache). */
  readonly localUri: string;
  readonly width: number;
  readonly height: number;
  /** Shutter clock (with offset) / EXIF time for library imports; null when neither exists. */
  readonly capturedAt: string | null;
  /** Verbatim EXIF DateTimeOriginal string — corroboration only, never the system of record. */
  readonly exifDateTimeOriginal: string | null;
  /** Location-at-shutter via expo-location; all three null when permission was denied or the fix timed out. */
  readonly gpsLat: number | null;
  readonly gpsLng: number | null;
  /** Meters. */
  readonly gpsAccuracy: number | null;
  readonly source: PhotoSource;
  /** Tags/caption authored at capture; travel inside the photo INSERT. */
  readonly tradeTag: string | null;
  readonly locationTag: string | null;
  readonly caption: string | null;
}

/**
 * [R1] Caption/tag edit on an ALREADY-SYNCED photo (draft window only —
 * post-submit corrections go through amendments). Full replacement of the
 * meta trio, coalesced per photoId like update_section. An edit while the
 * photo is still `_pending` never enqueues this kind — the repository
 * rewrites the queued add_photo payload in place instead, which is what keeps
 * "no JSON mutation depends on a photo" true for the drain order.
 */
export interface UpdatePhotoMetaPayload {
  readonly photoId: string;
  readonly reportId: string;
  readonly caption: string | null;
  readonly tradeTag: string | null;
  readonly locationTag: string | null;
}

/**
 * [R5] Soft delete of an ALREADY-SYNCED photo (draft window only). An
 * unsynced (`_pending = 1`) photo is removed by a pure local cancel in
 * `photoDelete.ts` — dequeue add_photo, delete local row + outbox file, no
 * network — so this kind can never precede its own add_photo by construction.
 */
export interface RemovePhotoPayload {
  readonly photoId: string;
  readonly reportId: string;
  /** Needed to hard-delete the storage object under the draft-only DELETE policy. */
  readonly storagePath: string;
}

/**
 * Every payload carries `reportId` so the per-report conflict/park surfaces
 * can group mutations across tables without a join (02 §C).
 */
export type MutationPayload =
  | { readonly kind: 'create_report'; readonly data: CreateReportPayload }
  | { readonly kind: 'update_section'; readonly data: UpdateSectionPayload }
  | { readonly kind: 'submit_report'; readonly data: SubmitReportPayload }
  | { readonly kind: 'lock_report'; readonly data: LockReportPayload }
  | { readonly kind: 'create_amendment'; readonly data: CreateAmendmentPayload }
  | { readonly kind: 'add_photo'; readonly data: AddPhotoPayload }
  | { readonly kind: 'update_photo_meta'; readonly data: UpdatePhotoMetaPayload }
  | { readonly kind: 'remove_photo'; readonly data: RemovePhotoPayload };

export interface Mutation {
  /** Idempotency key — the client UUID of the durable artifact this produces. */
  readonly clientId: string;
  readonly payload: MutationPayload;
  readonly createdAt: string;
  readonly attempts: number;
  readonly status: MutationStatus;
  readonly lastError: string | null;
}

/**
 * How a failed push attempt is categorized — drives retry vs park vs evict.
 * `offline` is transport-level (no connectivity): retried like `retryable` but
 * never counted toward the retry ceiling, so being off-grid can't park a write.
 */
export type ErrorClass = 'retryable' | 'permanent' | 'evict' | 'offline';

/** Persistence seam for the queue. Implemented by `store.native`; never in Jest. */
export interface MutationStore {
  enqueue(m: Mutation): Promise<void>;
  /** Oldest-first, `pending` only. */
  pending(): Promise<Mutation[]>;
  /** All mutations (for the sync-status UI), newest issue first. */
  all(): Promise<Mutation[]>;
  replace(m: Mutation): Promise<void>;
  remove(clientId: string): Promise<void>;
  /** Flip a parked mutation back to pending for an explicit user retry. */
  unpark(clientId: string): Promise<void>;
}

/** Persistence seam for pull cursors. Implemented by `store.native`. */
export interface CursorStore {
  get(scope: string): Promise<string | null>;
  set(scope: string, value: string): Promise<void>;
}
