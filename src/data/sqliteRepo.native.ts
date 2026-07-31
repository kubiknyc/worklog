/**
 * SQLite implementation of Repository (native, offline-first). Reads serve the
 * local mirror; writes are optimistic — they land in the local tables and
 * enqueue a mutation for the sync engine to push (M3 wires a real `nudge`; until
 * then it is a no-op and the queue drains on the next engine tick).
 *
 * `Db` is the minimal query surface this repo needs — a `Pick` off expo-sqlite's
 * `SQLiteDatabase`, satisfied both by the real device database and by a
 * lightweight in-memory test fake. This module never opens or migrates the
 * database; platformRepo.native.ts does that and injects the open handle, the
 * mutation store, and the nudge.
 */
import { tx } from '../db/rows.native';
import { uuidv4 } from '../lib/uuid';
import { newMutation } from '../sync/mutationQueue';
import type { Mutation, MutationStore } from '../sync/types';
import { asRecord, explodeSection, num, str, type Db } from './sectionExplode.native';
import { isRelationalSection } from './sectionContent';
import type {
  DailyReportRow,
  Json,
  MemberRow,
  ProjectRow,
  ReportSectionRow,
  Repository,
  SectionKind,
  WeatherRow,
} from './types';

export type { Db };

const noop = (): void => {};

// ── Raw row shapes as SQLite returns them (JSON as TEXT, booleans as 0/1) ─────

interface SectionRowRaw {
  report_id: string;
  section: string;
  payload: string;
  is_complete: number;
  updated_at: string | null;
}

export function createSqliteRepo(
  db: Db,
  mutations: MutationStore,
  nudge: () => void = noop,
): Repository {
  // Serializes get-or-create per (project, date). The existence SELECT and the
  // INSERT in createReport must be atomic against a concurrent createReport for
  // the same day (a double-tap before the UI disables), or both pass the check
  // and insert duplicate rows. The local schema has no UNIQUE(project_id,
  // report_date) by design (the collision/reparent path needs loser+winner to
  // coexist briefly — see schema.ts), so the guard lives here, in-process,
  // which is exactly the race's scope: one JS runtime interleaving at awaits.
  const createReportLocks = new Map<string, Promise<DailyReportRow>>();

  /** The unserialized get-or-create body; callers reach it only through the
   * per-(project, date) lock in the createReport method above. */
  async function getOrCreateReport(projectId: string, reportDate: string): Promise<DailyReportRow> {
    // A local hit short-circuits with no INSERT and no enqueue.
    const existing = await db.getFirstAsync<DailyReportRow>(
      `SELECT id, project_id, report_date, status FROM daily_reports
         WHERE project_id = ? AND report_date = ?`,
      [projectId, reportDate],
    );
    if (existing) return existing;

    const reportId = uuidv4(); // client uuid = final server id (and the mutation's clientId)
    const row: DailyReportRow = {
      id: reportId,
      project_id: projectId,
      report_date: reportDate,
      status: 'draft',
    };

    // One transaction: the local row, its 1:1 weather seed (mirrors the RPC),
    // and the queued create_report mutation commit atomically — a kill mid-way
    // can never leave a row without its mutation (a lost write) or vice versa.
    await tx(db, async () => {
      await db.runAsync(
        `INSERT INTO daily_reports (id, project_id, report_date, status, _dirty)
           VALUES (?, ?, ?, 'draft', 1)`,
        [reportId, projectId, reportDate],
      );
      await db.runAsync(
        `INSERT OR IGNORE INTO report_weather (report_id, weather_source) VALUES (?, 'none')`,
        [reportId],
      );
      await mutations.enqueue(
        newMutation(
          reportId,
          {
            kind: 'create_report',
            data: { reportId, projectId, reportDate, carryForwardSourceReportId: null },
          },
          new Date().toISOString(),
        ),
      );
    });
    nudge();
    return row;
  }

  return {
    // ── Reads ───────────────────────────────────────────────────────────────
    async listProjects(): Promise<readonly ProjectRow[]> {
      return db.getAllAsync<ProjectRow>(
        'SELECT id, name, address, timezone, lat, lng FROM projects ORDER BY name',
      );
    },

    async getReportByDate(projectId: string, reportDate: string): Promise<DailyReportRow | null> {
      return db.getFirstAsync<DailyReportRow>(
        `SELECT id, project_id, report_date, status FROM daily_reports
         WHERE project_id = ? AND report_date = ?`,
        [projectId, reportDate],
      );
    },

    async getProject(projectId: string): Promise<ProjectRow | null> {
      return db.getFirstAsync<ProjectRow>(
        'SELECT id, name, address, timezone, lat, lng FROM projects WHERE id = ?',
        [projectId],
      );
    },

    async getReport(reportId: string): Promise<DailyReportRow | null> {
      return db.getFirstAsync<DailyReportRow>(
        'SELECT id, project_id, report_date, status FROM daily_reports WHERE id = ?',
        [reportId],
      );
    },

    async listSections(reportId: string): Promise<readonly ReportSectionRow[]> {
      const raw = await db.getAllAsync<SectionRowRaw>(
        `SELECT report_id, section, payload, is_complete, updated_at
         FROM report_sections WHERE report_id = ? ORDER BY section`,
        [reportId],
      );
      return raw.map((r) => ({
        report_id: r.report_id,
        section: r.section as ReportSectionRow['section'],
        payload: safeParse(r.payload),
        is_complete: r.is_complete === 1,
        updated_at: r.updated_at,
      }));
    },

    async getWeather(reportId: string): Promise<WeatherRow | null> {
      return db.getFirstAsync<WeatherRow>(
        `SELECT report_id, weather_source, auto_condition, auto_temp_f, override_condition, override_temp_f
         FROM report_weather WHERE report_id = ?`,
        [reportId],
      );
    },

    async listMutations(): Promise<readonly Mutation[]> {
      // Task 8's queue screen; `all()` is already newest-first (ORDER BY seq DESC).
      return mutations.all();
    },

    async listMembers(projectId: string): Promise<readonly MemberRow[]> {
      // project_members ⋈ profiles for identity + role; report_member_prefs is
      // left-joined for the optional PM/super display title (may be absent).
      return db.getAllAsync<MemberRow>(
        `SELECT pm.user_id AS user_id, p.full_name AS full_name, p.email AS email,
                pm.role AS role, rmp.title AS title
         FROM project_members pm
         JOIN profiles p ON p.id = pm.user_id
         LEFT JOIN report_member_prefs rmp
           ON rmp.project_id = pm.project_id AND rmp.user_id = pm.user_id
         WHERE pm.project_id = ?
         ORDER BY p.full_name`,
        [projectId],
      );
    },

    // ── Writes ──────────────────────────────────────────────────────────────
    async createReport(projectId: string, reportDate: string): Promise<DailyReportRow> {
      // Get-or-create, serialized per (project, date): a concurrent call for the
      // same day waits for the in-flight one so its SELECT observes that INSERT,
      // instead of both passing the check and inserting duplicate rows.
      const key = `${projectId}\n${reportDate}`;
      const prior = createReportLocks.get(key);
      const run = (async (): Promise<DailyReportRow> => {
        // A failed prior create must not block ours — swallow and attempt anew.
        if (prior) {
          try {
            await prior;
          } catch {
            /* prior create failed; fall through and try our own */
          }
        }
        return getOrCreateReport(projectId, reportDate);
      })();
      createReportLocks.set(key, run);
      try {
        return await run;
      } finally {
        // Clear only if still the tail, so a newer queued create isn't dropped.
        if (createReportLocks.get(key) === run) createReportLocks.delete(key);
      }
    },

    async updateSection(
      reportId: string,
      section: SectionKind,
      content: Json,
      isComplete: boolean,
    ): Promise<void> {
      await tx(db, async () => {
        if (section === 'weather') {
          // R3: weather is section-shaped but writes report_weather.override_*.
          const rec = asRecord(content);
          await db.runAsync(
            `INSERT INTO report_weather (report_id, weather_source, override_condition, override_temp_f, _dirty)
             VALUES (?, 'manual', ?, ?, 1)
             ON CONFLICT (report_id) DO UPDATE SET
               weather_source     = 'manual',
               override_condition = excluded.override_condition,
               override_temp_f    = excluded.override_temp_f,
               _dirty             = 1`,
            [reportId, str(rec.condition), num(rec.tempF)],
          );
        } else {
          await db.runAsync(
            `INSERT INTO report_sections (report_id, section, payload, is_complete, _dirty)
             VALUES (?, ?, ?, ?, 1)
             ON CONFLICT (report_id, section) DO UPDATE SET
               payload     = excluded.payload,
               is_complete = excluded.is_complete,
               _dirty      = 1`,
            [reportId, section, JSON.stringify(content), isComplete ? 1 : 0],
          );
          if (isRelationalSection(section)) {
            await explodeSection(db, reportId, section, content);
          }
        }
        // Coalesce per (reportId, section): a fresh edit supersedes any parked
        // mutation's payload and re-pends it (doc 06 §A). clientId is the
        // composite key since sections have no single minted uuid.
        await mutations.enqueueCoalescing(
          newMutation(
            `${reportId}:${section}`,
            { kind: 'update_section', data: { reportId, section, content, isComplete } },
            new Date().toISOString(),
          ),
        );
      });
      nudge();
    },

    async setActiveProject(projectId: string): Promise<void> {
      await db.runAsync(
        `INSERT INTO sync_meta (key, value) VALUES ('active_project_id', ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
        [projectId],
      );
      nudge();
    },
  };
}

/** Parse a stored payload TEXT; a corrupt row degrades to `{}` rather than throwing. */
function safeParse(text: string): Json {
  try {
    return JSON.parse(text) as Json;
  } catch {
    return {};
  }
}
