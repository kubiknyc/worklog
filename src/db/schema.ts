/**
 * Local SQLite schema — mirrors the Postgres tables the repository reads, plus
 * sync bookkeeping. Pure strings only (no native imports) so Jest can assert
 * column parity with `jobsight-backend/supabase/migrations/*` without opening
 * a database.
 *
 * Conventions vs Postgres:
 * - uuid/text/date/timestamptz → TEXT; int → INTEGER; real/numeric → REAL;
 *   boolean → INTEGER (0/1).
 * - jsonb (`payload`, `auto_raw_response`, `before_payload`, `after_payload`)
 *   → TEXT holding JSON.
 * - Local-only columns are prefixed `_` — `_dirty` (has an unpushed local
 *   edit), `_pending` (photo captured locally, upload not yet confirmed) —
 *   plus the unprefixed device-file pointers `local_uri`/`local_thumb_uri`.
 *   All of them are excluded from DOMAIN_COLUMNS (the parity map lists server
 *   columns only), exactly like PunchLog's `_dirty`/`_provisional`/`local_uri`.
 */

/** Bump when DDL changes; `open.native` migrates forward by PRAGMA user_version. */
export const SCHEMA_VERSION = 2;

/**
 * Columns of each mirrored domain table, by name. The parity test checks these
 * against the Postgres source (both directions, name presence only) so the two
 * schemas can't silently drift. `sync_mutations`/`sync_cursors`/`sync_meta`
 * are local-only by design and deliberately absent.
 */
export const DOMAIN_COLUMNS = {
  profiles: [
    'id',
    'full_name',
    'email',
    'phone',
    'company',
    'trade',
    'avatar_url',
    'expo_push_token',
    'created_at',
  ],
  // Shared suite table: PunchLog's columns (company_id, code_prefix) are
  // mirrored for full-table parity even though WorkLog never reads them;
  // timezone/lat/lng/geocode_source/geocoded_at are the WorkLog-additive
  // columns (04-data-model §A.0) that report_date, weather, and the GPS
  // photo guard depend on.
  projects: [
    'id',
    'name',
    'address',
    'created_by',
    'created_at',
    'company_id',
    'code_prefix',
    'timezone',
    'lat',
    'lng',
    'geocode_source',
    'geocoded_at',
  ],
  project_members: ['project_id', 'user_id', 'role', 'created_at'],
  // PM/super display title (PRD §10) — mirrored so the PDF signature block
  // and roles.ts label resolution work offline; pulled with Tier-1 reference
  // data (snapshot, no cursor — the table has no updated_at).
  report_member_prefs: ['project_id', 'user_id', 'title'],
  daily_reports: [
    'id',
    'project_id',
    'report_date',
    'status',
    'has_incident',
    'has_delay',
    'created_by',
    'created_at',
    'submitted_by',
    'submitted_at',
    'locked_by',
    'locked_at',
    'updated_at',
  ],
  report_sections: ['report_id', 'section', 'payload', 'is_complete', 'updated_at', 'updated_by'],
  report_crew: ['id', 'report_id', 'trade', 'headcount', 'hours', 'is_carried_forward'],
  report_equipment: ['id', 'report_id', 'name', 'status', 'on_site'],
  report_work_performed: ['id', 'report_id', 'trade', 'area', 'note'],
  report_delays: [
    'id',
    'report_id',
    'cause',
    'responsible_party',
    'duration_hours',
    'is_ongoing',
    'note',
  ],
  report_safety_observations: ['id', 'report_id', 'obs_type', 'description', 'is_incident'],
  report_weather: [
    'report_id',
    'weather_source',
    'auto_condition',
    'auto_temp_f',
    'auto_fetched_at',
    'auto_raw_response',
    'override_condition',
    'override_temp_f',
    'override_at',
    'override_by',
    'updated_at',
  ],
  report_photos: [
    'id',
    'report_id',
    'project_id',
    'storage_path',
    'trade_tag',
    'location_tag',
    'caption',
    'source',
    'captured_at',
    'exif_datetime_original',
    'added_at',
    'gps_lat',
    'gps_lng',
    'gps_accuracy',
    'width',
    'height',
    'created_by',
    'created_at',
    'updated_at',
    'deleted_at',
  ],
  report_amendments: [
    'id',
    'report_id',
    'amendment_number',
    'reason',
    'created_by',
    'created_at',
    'signature_id',
  ],
  report_amendment_changes: ['id', 'amendment_id', 'section', 'before_payload', 'after_payload'],
} as const;

/**
 * DDL executed at version 0 → 1. Order matters only for readability — there
 * are no FK constraints locally (the server is the integrity authority; we
 * just cache rows and reconcile).
 *
 * NOT pulled and therefore NOT mirrored: `report_signatures` (write-only via
 * the submit/amend RPC payloads), `daily_report_audit_log` (server-only),
 * `companies`/`company_members`/`company_branding`/`report_customization`/
 * `report_distribution_lists` (online-only account data — same rule PunchLog
 * applies to companies; the AsyncStorage account cache covers offline restore).
 */
export const SCHEMA_V1: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS profiles (
     id TEXT PRIMARY KEY, full_name TEXT NOT NULL DEFAULT '', email TEXT, phone TEXT,
     company TEXT, trade TEXT, avatar_url TEXT, expo_push_token TEXT, created_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS projects (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT, created_by TEXT, created_at TEXT,
     company_id TEXT, code_prefix TEXT,
     timezone TEXT, lat REAL, lng REAL, geocode_source TEXT, geocoded_at TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS project_members (
     project_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT,
     PRIMARY KEY (project_id, user_id)
   )`,
  `CREATE TABLE IF NOT EXISTS report_member_prefs (
     project_id TEXT NOT NULL, user_id TEXT NOT NULL, title TEXT,
     PRIMARY KEY (project_id, user_id)
   )`,
  // `status` is server-governed (never LWW — conflict.ts protects it exactly
  // like PunchLog protects items.status). The Postgres natural key
  // UNIQUE(project_id, report_date) is deliberately NOT unique locally: the
  // create_report collision path can leave a loser row and the winner row
  // coexisting for one transaction while reparentReport rewrites children.
  `CREATE TABLE IF NOT EXISTS daily_reports (
     id TEXT PRIMARY KEY, project_id TEXT NOT NULL, report_date TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'draft',
     has_incident INTEGER NOT NULL DEFAULT 0, has_delay INTEGER NOT NULL DEFAULT 0,
     created_by TEXT, created_at TEXT,
     submitted_by TEXT, submitted_at TEXT, locked_by TEXT, locked_at TEXT,
     updated_at TEXT,
     _dirty INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS daily_reports_project_date ON daily_reports (project_id, report_date DESC)`,
  `CREATE INDEX IF NOT EXISTS daily_reports_project_status ON daily_reports (project_id, status)`,
  // One LWW row per section [R2]: composite PK (report_id, section), no
  // sectionId uuid — the tuple IS the identity that update_section payloads
  // and rowTargetOf carry. `section` is one of the 10 non-weather kinds
  // (weather lives in report_weather, below).
  `CREATE TABLE IF NOT EXISTS report_sections (
     report_id TEXT NOT NULL, section TEXT NOT NULL,
     payload TEXT NOT NULL DEFAULT '{}', is_complete INTEGER NOT NULL DEFAULT 0,
     updated_at TEXT, updated_by TEXT,
     _dirty INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (report_id, section)
   )`,
  // Relational child tables (rollups need rows, not jsonb — PRD §11 item 6).
  // No local-only columns here: children are exploded from the parent section
  // row's payload (push and pull explode identically, in the same transaction
  // that writes the section row), so the parent's `_dirty` is their shield —
  // a pull never replaces children of a dirty section row.
  `CREATE TABLE IF NOT EXISTS report_crew (
     id TEXT PRIMARY KEY, report_id TEXT NOT NULL, trade TEXT NOT NULL,
     headcount INTEGER NOT NULL DEFAULT 0, hours REAL NOT NULL DEFAULT 0,
     is_carried_forward INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS report_crew_report ON report_crew (report_id)`,
  `CREATE TABLE IF NOT EXISTS report_equipment (
     id TEXT PRIMARY KEY, report_id TEXT NOT NULL, name TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'active', on_site INTEGER NOT NULL DEFAULT 1
   )`,
  `CREATE INDEX IF NOT EXISTS report_equipment_report ON report_equipment (report_id)`,
  `CREATE TABLE IF NOT EXISTS report_work_performed (
     id TEXT PRIMARY KEY, report_id TEXT NOT NULL, trade TEXT NOT NULL,
     area TEXT NOT NULL, note TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE INDEX IF NOT EXISTS report_work_performed_report ON report_work_performed (report_id)`,
  `CREATE TABLE IF NOT EXISTS report_delays (
     id TEXT PRIMARY KEY, report_id TEXT NOT NULL, cause TEXT NOT NULL,
     responsible_party TEXT, duration_hours REAL, is_ongoing INTEGER NOT NULL DEFAULT 0,
     note TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS report_delays_report ON report_delays (report_id)`,
  `CREATE TABLE IF NOT EXISTS report_safety_observations (
     id TEXT PRIMARY KEY, report_id TEXT NOT NULL, obs_type TEXT NOT NULL,
     description TEXT, is_incident INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS report_safety_observations_report ON report_safety_observations (report_id)`,
  // Weather is the 11th SectionKind [R3] but its own 1:1 table (mirrors the
  // Postgres report_weather). `update_section` with section='weather' writes
  // the override_* columns server-side; the queued override dirties THIS row,
  // hence its own `_dirty` (unlike PunchLog, where only items/comments carry
  // one). auto_* columns are edge-function-written and pull-only on device.
  `CREATE TABLE IF NOT EXISTS report_weather (
     report_id TEXT PRIMARY KEY, weather_source TEXT NOT NULL DEFAULT 'none',
     auto_condition TEXT, auto_temp_f REAL, auto_fetched_at TEXT, auto_raw_response TEXT,
     override_condition TEXT, override_temp_f REAL, override_at TEXT, override_by TEXT,
     updated_at TEXT,
     _dirty INTEGER NOT NULL DEFAULT 0
   )`,
  // Photos: `_pending`/`local_uri` mirror PunchLog's photo columns verbatim
  // (capture inserts `_pending = 1` + the outbox URI; push success alone
  // clears them; pulls never touch them). `_dirty` is NEW vs PunchLog: the
  // queued update_photo_meta kind [R1] means an already-synced photo can hold
  // an unpushed caption/tag edit that a pull must not clobber.
  // `local_thumb_uri` is the device-local ~200px thumbnail cache (03 §A.6).
  // Non-null `deleted_at` is the remove_photo tombstone [R5].
  `CREATE TABLE IF NOT EXISTS report_photos (
     id TEXT PRIMARY KEY, report_id TEXT NOT NULL, project_id TEXT NOT NULL,
     storage_path TEXT NOT NULL,
     trade_tag TEXT, location_tag TEXT, caption TEXT,
     source TEXT NOT NULL DEFAULT 'camera',
     captured_at TEXT, exif_datetime_original TEXT, added_at TEXT,
     gps_lat REAL, gps_lng REAL, gps_accuracy REAL,
     width INTEGER, height INTEGER,
     created_by TEXT, created_at TEXT, updated_at TEXT, deleted_at TEXT,
     _dirty INTEGER NOT NULL DEFAULT 0, _pending INTEGER NOT NULL DEFAULT 0,
     local_uri TEXT, local_thumb_uri TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS report_photos_report ON report_photos (report_id)`,
  `CREATE INDEX IF NOT EXISTS report_photos_project ON report_photos (project_id)`,
  // `amendment_number` is server-assigned by the amend_report RPC, so it is
  // nullable locally: an offline-created amendment row carries NULL until the
  // pull backfills the authoritative number (same spirit as PunchLog's
  // provisional item codes). `_dirty = 1` shields the unpushed row from the
  // per-project reconcile sweep, mirroring how PunchLog shields local writes.
  `CREATE TABLE IF NOT EXISTS report_amendments (
     id TEXT PRIMARY KEY, report_id TEXT NOT NULL, amendment_number INTEGER,
     reason TEXT NOT NULL DEFAULT '', created_by TEXT, created_at TEXT, signature_id TEXT,
     _dirty INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS report_amendments_report ON report_amendments (report_id, created_at)`,
  // Before/after snapshots ride along with the report_amendments pull (no own
  // cursor). Written locally in the same transaction as their parent amendment
  // (optimistic, from local state); the pull overwrites with the server's
  // authoritative snapshot. Shielded from reconcile via the parent's `_dirty`.
  `CREATE TABLE IF NOT EXISTS report_amendment_changes (
     id TEXT PRIMARY KEY, amendment_id TEXT NOT NULL, section TEXT NOT NULL,
     before_payload TEXT NOT NULL DEFAULT '{}', after_payload TEXT NOT NULL DEFAULT '{}'
   )`,
  `CREATE INDEX IF NOT EXISTS report_amendment_changes_amendment ON report_amendment_changes (amendment_id)`,
  // Outbound mutation queue. `seq` gives a stable oldest-first drain order;
  // `client_id` (the row's client UUID, or a synthesized key) dedups enqueues.
  `CREATE TABLE IF NOT EXISTS sync_mutations (
     seq INTEGER PRIMARY KEY AUTOINCREMENT, client_id TEXT NOT NULL UNIQUE,
     kind TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL,
     attempts INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending',
     last_error TEXT
   )`,
  // Pull cursors keyed by scope (e.g. `reports:<projectId>`, `report_photos_v1:<projectId>`).
  `CREATE TABLE IF NOT EXISTS sync_cursors (scope TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  // Misc key/value (last reconcile stamp, multi-project pull-rotation bookkeeping, …).
  `CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

/**
 * Migrations indexed by target version. `MIGRATIONS[n]` upgrades (n-1) → n.
 *
 * MIGRATIONS[2] is the SOLE producer of `sync_mutations.revision` — SCHEMA_V1
 * stays byte-identical. `open.native.ts` applies every step above the stored
 * `user_version`, so a fresh device at version 0 runs MIGRATIONS[1] then
 * MIGRATIONS[2] in sequence. Adding the column to SCHEMA_V1 as well would
 * throw `duplicate column name` on that fresh-install path; editing SCHEMA_V1
 * alone would leave already-migrated devices (already at v1) with `no such
 * column` since they never re-run it.
 */
export const MIGRATIONS: Readonly<Record<number, readonly string[]>> = {
  1: SCHEMA_V1,
  2: ['ALTER TABLE sync_mutations ADD COLUMN revision INTEGER NOT NULL DEFAULT 0'],
};
