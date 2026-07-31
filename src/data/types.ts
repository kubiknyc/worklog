/**
 * Repository seam types. `Repository` is the only data surface screens may
 * import (doc 02 §C). M2 extends it with the report reads + optimistic writes
 * the section-editing flows need; the native impl (sqliteRepo.native) writes
 * local rows + enqueues mutations, the web impl (supabaseRepo) calls RPCs.
 *
 * SectionKind/Json are re-exported from the sync layer so screens have one
 * import site for the section vocabulary (the dependency direction stays
 * data → sync — sync/types.ts owns SectionKind because it is fundamentally a
 * mutation-payload discriminator).
 */
import type { SyncEngineApi } from '../sync/engineApi';
import type { Json, Mutation, SectionKind } from '../sync/types';

export type { Json, SectionKind };

export interface ProjectRow {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
  /** IANA zone the report date is computed in (04 §A.0); null until geocoded. */
  readonly timezone: string | null;
  /** Site geo, used by the weather auto-fetch (M9) and the photo GPS guard. */
  readonly lat: number | null;
  readonly lng: number | null;
}

export interface DailyReportRow {
  readonly id: string;
  readonly project_id: string;
  readonly report_date: string; // YYYY-MM-DD
  readonly status: 'draft' | 'submitted' | 'locked';
}

/**
 * One `report_sections` row. `section` excludes 'weather' — the 11th SectionKind
 * lives in its own 1:1 table (WeatherRow) server-side and locally, so a section
 * list never mixes the two shapes. `payload` is the opaque per-section content
 * (sectionContent.ts owns the concrete shapes).
 */
export interface ReportSectionRow {
  readonly report_id: string;
  readonly section: Exclude<SectionKind, 'weather'>;
  readonly payload: Json;
  readonly is_complete: boolean;
  readonly updated_at: string | null;
}

/**
 * The 1:1 `report_weather` row (mirrors report_weather, db/schema.ts). Auto_*
 * columns are edge-function-written (pull-only on device); override_* carry the
 * offline-capable manual override an `update_section` with section='weather'
 * writes. `weather_source` is 'none' | 'auto' | 'manual'.
 */
export interface WeatherRow {
  readonly report_id: string;
  readonly weather_source: string;
  readonly auto_condition: string | null;
  readonly auto_temp_f: number | null;
  readonly override_condition: string | null;
  readonly override_temp_f: number | null;
}

/**
 * A project member for the members surface + the PDF signature block. Joined
 * from project_members ⋈ profiles, with the optional PM/super display `title`
 * left-joined from report_member_prefs. `role` is the project_role enum.
 */
export interface MemberRow {
  readonly user_id: string;
  readonly full_name: string;
  readonly email: string | null;
  readonly role: 'super' | 'sub';
  readonly title: string | null;
}

/**
 * What a platform repository factory returns. `engine` feeds the sync status
 * hub (via `attachEngine`) and the `SyncActionsContext`; the provider (not the
 * factory) attaches/starts it, under its lifecycle guard, so a stale build can
 * never install late. Web is online-only — no queue, no engine, `engine` is
 * null.
 */
export interface PlatformRepoBundle {
  readonly repo: Repository;
  readonly engine: SyncEngineApi | null;
}

export interface Repository {
  // ── Reads ────────────────────────────────────────────────────────────────
  listProjects(): Promise<readonly ProjectRow[]>;
  getReportByDate(projectId: string, reportDate: string): Promise<DailyReportRow | null>;
  getProject(projectId: string): Promise<ProjectRow | null>;
  getReport(reportId: string): Promise<DailyReportRow | null>;
  /** All non-weather section rows for a report, ordered by section. */
  listSections(reportId: string): Promise<readonly ReportSectionRow[]>;
  getWeather(reportId: string): Promise<WeatherRow | null>;
  listMembers(projectId: string): Promise<readonly MemberRow[]>;
  /**
   * Every queued mutation (Task 8's retry/discard surface), newest first.
   * Native delegates to the store's `all()`; web is online-only and has no
   * local queue, so it always returns `[]`.
   */
  listMutations(): Promise<readonly Mutation[]>;

  // ── Writes (optimistic; native enqueues, web calls RPCs) ───────────────────
  /**
   * Get-or-create the draft report for (projectId, reportDate). Native reads
   * the local row first — no double-create — then inserts + enqueues
   * create_report atomically; web calls the get-or-create RPC. Returns the row.
   */
  createReport(projectId: string, reportDate: string): Promise<DailyReportRow>;
  /**
   * Full-replacement write of a section's content (LWW by the section row's
   * server updated_at). Native writes the local row (+ explodes relational
   * child rows) and coalesces an update_section mutation; web calls the RPC.
   * `section='weather'` routes to report_weather.override_*.
   */
  updateSection(
    reportId: string,
    section: SectionKind,
    content: Json,
    isComplete: boolean,
  ): Promise<void>;
  /**
   * Record which project the user is currently looking at (Task 11's
   * active-project bridge, `sync_meta.active_project_id`) so the pull
   * orchestrator (`pull.native.ts`) can scope its per-report pull to it.
   * Native upserts + nudges the engine; web is online-only and has no local
   * pull cursor to bias, so it's a no-op.
   */
  setActiveProject(projectId: string): Promise<void>;
}
